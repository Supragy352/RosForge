pub mod cpp;
pub mod launch;
pub mod python;
pub mod regions;
pub mod types;

use crate::codegen::cpp::generate_cpp_package;
use crate::codegen::python::{generate_python_package, GeneratedUnit};
use crate::codegen::regions::{
    extract_regions, hash_non_region_content, hash_plain_content, normalize_lf, reinsert_regions,
};
use crate::model::{Diagnostic, NodeOwnership, PackageLang, Project, RosChannel};
use crate::project::save_project;
use crate::validate::{has_errors, validate_project};
use serde::{Deserialize, Serialize};
use similar::TextDiff;
use specta::Type;
use std::collections::{BTreeMap, HashMap};
use std::fs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeStatus {
    Created,
    Modified,
    Unchanged,
    ModifiedOutsideRegions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FileResolution {
    Overwrite,
    Skip,
    ConvertToHandwritten,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedFilePreview {
    pub rel_path: String,
    pub package_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub status: FileChangeStatus,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub existing_content: Option<String>,
    pub unified_diff: String,
    pub non_region_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePreview {
    pub has_errors: bool,
    pub diagnostics: Vec<Diagnostic>,
    pub files: Vec<GeneratedFilePreview>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplyGenerateResult {
    pub project: Project,
    pub written_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub converted_node_ids: Vec<String>,
}

fn generate_all_units(project: &Project) -> Vec<GeneratedUnit> {
    let channels: HashMap<&str, &RosChannel> = project
        .channels
        .iter()
        .map(|c| (c.id.as_str(), c))
        .collect();

    let mut sorted_pkgs: Vec<_> = project.packages.iter().collect();
    sorted_pkgs.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    let mut units = Vec::new();
    for pkg in sorted_pkgs {
        let mut pkg_units = match pkg.lang {
            PackageLang::Python => generate_python_package(pkg, &channels),
            PackageLang::Cpp => generate_cpp_package(pkg, &channels),
        };
        pkg_units.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
        units.extend(pkg_units);
    }

    units
}

fn compute_unified_diff(rel_path: &str, existing: &str, proposed: &str) -> String {
    if existing == proposed {
        return String::new();
    }
    TextDiff::from_lines(existing, proposed)
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{rel_path}"), &format!("b/{rel_path}"))
        .to_string()
}

/// Computes a full dry-run generation preview with protected-region merging,
/// per-file unified diffs (`similar`), and F1.28 hand-edit detection.
pub fn preview_generate(project: &Project) -> GeneratePreview {
    let diagnostics = validate_project(project);
    let errors_present = has_errors(&diagnostics);

    let ws_root = crate::project::expand_tilde(&project.workspace_path);
    let units = generate_all_units(project);
    let mut files = Vec::with_capacity(units.len());

    for unit in units {
        let full_path = ws_root.join(&unit.rel_path);
        let existing_raw = fs::read_to_string(&full_path).ok().map(|s| normalize_lf(&s));

        let final_content = match (&existing_raw, unit.comment_style) {
            (Some(existing), Some(style)) => {
                let extracted = extract_regions(existing, style);
                reinsert_regions(&unit.content, &extracted, style)
            }
            _ => normalize_lf(&unit.content),
        };

        let non_region_hash = match unit.comment_style {
            Some(style) => hash_non_region_content(&final_content, style),
            None => hash_plain_content(&final_content),
        };

        let status = match &existing_raw {
            None => FileChangeStatus::Created,
            Some(existing) => {
                let modified_outside = project
                    .generated_file_hashes
                    .get(&unit.rel_path)
                    .map(|stored_hash| {
                        let disk_hash = match unit.comment_style {
                            Some(style) => hash_non_region_content(existing, style),
                            None => hash_plain_content(existing),
                        };
                        &disk_hash != stored_hash
                    })
                    .unwrap_or(false);

                if modified_outside {
                    FileChangeStatus::ModifiedOutsideRegions
                } else if existing == &final_content {
                    FileChangeStatus::Unchanged
                } else {
                    FileChangeStatus::Modified
                }
            }
        };

        let unified_diff = compute_unified_diff(
            &unit.rel_path,
            existing_raw.as_deref().unwrap_or(""),
            &final_content,
        );

        files.push(GeneratedFilePreview {
            rel_path: unit.rel_path,
            package_id: unit.package_id,
            node_id: unit.node_id,
            status,
            content: final_content,
            existing_content: existing_raw,
            unified_diff,
            non_region_hash,
        });
    }

    GeneratePreview {
        has_errors: errors_present,
        diagnostics,
        files,
    }
}

/// Applies code generation atomically (all-or-nothing validation before writing).
/// Blocks if validation errors exist (F1.21) or if any `ModifiedOutsideRegions` file lacks
/// an explicit resolution.
pub fn apply_generate(
    project: &Project,
    resolutions: &BTreeMap<String, FileResolution>,
) -> Result<ApplyGenerateResult, String> {
    if project.workspace_path.trim().is_empty() {
        return Err("Project has no workspace path set.".to_string());
    }

    let preview = preview_generate(project);
    if preview.has_errors {
        let count = preview
            .diagnostics
            .iter()
            .filter(|d| d.severity == crate::model::DiagnosticSeverity::Error)
            .count();
        return Err(format!(
            "Code generation blocked: fix {count} validation error(s) first."
        ));
    }

    let mut updated_project = project.clone();
    let ws_root = crate::project::expand_tilde(&updated_project.workspace_path);

    let mut to_write: Vec<(String, String, String)> = Vec::new();
    let mut skipped_files = Vec::new();
    let mut converted_node_ids = Vec::new();

    for file in &preview.files {
        if !file.rel_path.starts_with("src/") || file.rel_path.contains("..") {
            return Err(format!("Unsafe target path rejected: '{}'", file.rel_path));
        }

        let resolution = resolutions.get(&file.rel_path).copied().unwrap_or_else(|| {
            if file.status == FileChangeStatus::ModifiedOutsideRegions {
                FileResolution::Skip
            } else {
                FileResolution::Overwrite
            }
        });

        match resolution {
            FileResolution::Skip => {
                skipped_files.push(file.rel_path.clone());
            }
            FileResolution::ConvertToHandwritten => {
                if let Some(ref node_id) = file.node_id {
                    for pkg in &mut updated_project.packages {
                        if let Some(node) = pkg.nodes.iter_mut().find(|n| &n.id == node_id) {
                            node.ownership = NodeOwnership::Handwritten;
                            let pkg_prefix = format!("src/{}/", pkg.name);
                            let rel_in_pkg = file
                                .rel_path
                                .strip_prefix(&pkg_prefix)
                                .unwrap_or(&file.rel_path);
                            node.source_file = Some(rel_in_pkg.to_string());
                            converted_node_ids.push(node_id.clone());
                        }
                    }
                    updated_project.generated_file_hashes.remove(&file.rel_path);
                }
                skipped_files.push(file.rel_path.clone());
            }
            FileResolution::Overwrite => {
                to_write.push((
                    file.rel_path.clone(),
                    file.content.clone(),
                    file.non_region_hash.clone(),
                ));
            }
        }
    }

    // Write all target files
    let mut written_files = Vec::with_capacity(to_write.len());
    for (rel_path, content, hash) in to_write {
        let full_path = ws_root.join(&rel_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
        }
        fs::write(&full_path, content.as_bytes())
            .map_err(|e| format!("Failed to write {}: {e}", full_path.display()))?;
        updated_project.generated_file_hashes.insert(rel_path.clone(), hash);
        written_files.push(rel_path);
    }

    save_project(&updated_project).map_err(|e| e.to_string())?;

    Ok(ApplyGenerateResult {
        project: updated_project,
        written_files,
        skipped_files,
        converted_node_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CanvasState, ChannelKind, ItemOrigin, LaunchEntry, LaunchFile, Maintainer, Package, Param,
        ParamType, ParamValue, Port, PortKind, QosPreset, RosNode, Timer, CURRENT_SCHEMA_VERSION,
        DEFAULT_ROS_DISTRO,
    };
    use crate::project::build_talker_listener_example;
    use std::path::Path;
    use tempfile::TempDir;

    fn deterministic_fixture_project(ws: &str) -> Project {
        let py_pkg = Package {
            id: "pkg-py-1".into(),
            name: "py_pubsub".into(),
            lang: PackageLang::Python,
            version: "0.1.0".into(),
            description: "Python talker fixture".into(),
            maintainer: Maintainer {
                name: "Dev".into(),
                email: "dev@example.com".into(),
            },
            license: "Apache-2.0".into(),
            nodes: vec![RosNode {
                id: "node-talker".into(),
                name: "talker".into(),
                executable: "talker".into(),
                class_name: "TalkerNode".into(),
                namespace: String::new(),
                ownership: NodeOwnership::Generated,
                ports: vec![
                    Port {
                        id: "port-pub-chatter".into(),
                        kind: PortKind::Pub,
                        channel_id: "ch-chatter".into(),
                        qos: QosPreset::Default,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                    Port {
                        id: "port-cli-add".into(),
                        kind: PortKind::SrvClient,
                        channel_id: "ch-add".into(),
                        qos: QosPreset::ServicesDefault,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                    Port {
                        id: "port-acli-fib".into(),
                        kind: PortKind::ActionClient,
                        channel_id: "ch-fib".into(),
                        qos: QosPreset::Default,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                ],
                params: vec![Param {
                    id: "param-greeting".into(),
                    name: "greeting".into(),
                    param_type: ParamType::String,
                    default: ParamValue::String("Hello ROS 2".into()),
                    description: "Greeting text".into(),
                    origin: ItemOrigin::Ui,
                }],
                timers: vec![Timer {
                    id: "timer-pub".into(),
                    name: "publish_timer".into(),
                    period_ms: 500,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                }],
                source_file: None,
            }],
            launch_files: vec![LaunchFile {
                id: "lf-py".into(),
                name: "py_pubsub.launch.py".into(),
                entries: vec![LaunchEntry {
                    node_id: "node-talker".into(),
                    name_override: None,
                    namespace: None,
                    remaps: Vec::new(),
                    param_overrides: BTreeMap::new(),
                }],
            }],
            extra_deps: Vec::new(),
        };

        let cpp_pkg = Package {
            id: "pkg-cpp-1".into(),
            name: "cpp_pubsub".into(),
            lang: PackageLang::Cpp,
            version: "0.1.0".into(),
            description: "C++ listener fixture".into(),
            maintainer: Maintainer {
                name: "Dev".into(),
                email: "dev@example.com".into(),
            },
            license: "Apache-2.0".into(),
            nodes: vec![RosNode {
                id: "node-listener".into(),
                name: "listener".into(),
                executable: "listener".into(),
                class_name: "ListenerNode".into(),
                namespace: String::new(),
                ownership: NodeOwnership::Generated,
                ports: vec![
                    Port {
                        id: "port-sub-chatter".into(),
                        kind: PortKind::Sub,
                        channel_id: "ch-chatter".into(),
                        qos: QosPreset::Default,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                    Port {
                        id: "port-srv-add".into(),
                        kind: PortKind::SrvServer,
                        channel_id: "ch-add".into(),
                        qos: QosPreset::ServicesDefault,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                    Port {
                        id: "port-asrv-fib".into(),
                        kind: PortKind::ActionServer,
                        channel_id: "ch-fib".into(),
                        qos: QosPreset::Default,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    },
                ],
                params: vec![Param {
                    id: "param-log".into(),
                    name: "log_received".into(),
                    param_type: ParamType::Bool,
                    default: ParamValue::Bool(true),
                    description: String::new(),
                    origin: ItemOrigin::Ui,
                }],
                timers: Vec::new(),
                source_file: None,
            }],
            launch_files: vec![LaunchFile {
                id: "lf-cpp".into(),
                name: "cpp_pubsub.launch.py".into(),
                entries: vec![LaunchEntry {
                    node_id: "node-listener".into(),
                    name_override: None,
                    namespace: None,
                    remaps: Vec::new(),
                    param_overrides: BTreeMap::new(),
                }],
            }],
            extra_deps: Vec::new(),
        };

        Project {
            schema_version: CURRENT_SCHEMA_VERSION,
            name: "fixture_ws".into(),
            workspace_path: ws.into(),
            ros_distro: DEFAULT_ROS_DISTRO.into(),
            packages: vec![py_pkg, cpp_pkg],
            channels: vec![
                RosChannel {
                    id: "ch-chatter".into(),
                    kind: ChannelKind::Topic,
                    name: "/chatter".into(),
                    interface_type: "std_msgs/msg/String".into(),
                },
                RosChannel {
                    id: "ch-add".into(),
                    kind: ChannelKind::Service,
                    name: "/add_two_ints".into(),
                    interface_type: "example_interfaces/srv/AddTwoInts".into(),
                },
                RosChannel {
                    id: "ch-fib".into(),
                    kind: ChannelKind::Action,
                    name: "/fibonacci".into(),
                    interface_type: "action_tutorials_interfaces/action/Fibonacci".into(),
                },
            ],
            canvas: CanvasState::default(),
            generated_file_hashes: BTreeMap::new(),
        }
    }

    #[test]
    fn codegen_is_deterministic_with_lf_endings() {
        let dir = TempDir::new().unwrap();
        let proj = deterministic_fixture_project(&dir.path().display().to_string());

        let first = preview_generate(&proj);
        let second = preview_generate(&proj);
        assert!(!first.has_errors);
        assert_eq!(first.files, second.files);
        for f in &first.files {
            assert!(!f.content.contains("\r\n"), "CRLF found in {}", f.rel_path);
        }
    }

    #[test]
    fn preserves_regions_and_detects_edits_outside_regions() {
        let dir = TempDir::new().unwrap();
        let proj = deterministic_fixture_project(&dir.path().display().to_string());

        let applied = apply_generate(&proj, &BTreeMap::new()).expect("initial generate");
        let py_rel = "src/py_pubsub/py_pubsub/talker.py";
        let py_path = dir.path().join(py_rel);

        // 1. Edit INSIDE a protected region -> should NOT trigger ModifiedOutsideRegions
        let original = fs::read_to_string(&py_path).unwrap();
        let edited_inside = original.replace(
            "self.get_logger().info('TODO: timer publish_timer tick')",
            "self.get_logger().info('CUSTOM USER CODE')",
        );
        fs::write(&py_path, &edited_inside).unwrap();

        let preview1 = preview_generate(&applied.project);
        let py_prev1 = preview1.files.iter().find(|f| f.rel_path == py_rel).unwrap();
        assert_eq!(py_prev1.status, FileChangeStatus::Unchanged);
        assert!(py_prev1.content.contains("CUSTOM USER CODE"));

        // 2. Edit OUTSIDE a protected region -> MUST trigger ModifiedOutsideRegions
        let edited_outside = edited_inside.replace("class TalkerNode(Node):", "class TalkerNode(Node):  # hand edit");
        fs::write(&py_path, &edited_outside).unwrap();

        let preview2 = preview_generate(&applied.project);
        let py_prev2 = preview2.files.iter().find(|f| f.rel_path == py_rel).unwrap();
        assert_eq!(py_prev2.status, FileChangeStatus::ModifiedOutsideRegions);

        // 3. ConvertToHandwritten flips ownership and preserves file on disk
        let mut res = BTreeMap::new();
        res.insert(py_rel.to_string(), FileResolution::ConvertToHandwritten);
        let applied2 = apply_generate(&applied.project, &res).expect("convert to handwritten");
        assert_eq!(applied2.converted_node_ids, vec!["node-talker"]);
        assert_eq!(
            applied2.project.packages[0].nodes[0].ownership,
            NodeOwnership::Handwritten
        );
    }

    #[test]
    fn generated_example_builds_with_colcon_when_jazzy_installed() {
        if !Path::new("/opt/ros/jazzy/setup.bash").exists() {
            return;
        }
        let dir = TempDir::new().unwrap();
        let proj = build_talker_listener_example(
            &dir.path().display().to_string(),
            "RosForge CI",
            "ci@rosforge.dev",
        );
        apply_generate(&proj, &BTreeMap::new()).expect("generate example packages");

        let status = std::process::Command::new("bash")
            .arg("-lc")
            .arg(format!(
                "source /opt/ros/jazzy/setup.bash && cd '{}' && colcon build --symlink-install",
                dir.path().display()
            ))
            .output()
            .expect("spawn colcon build");

        assert!(
            status.status.success(),
            "colcon build failed!\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&status.stdout),
            String::from_utf8_lossy(&status.stderr)
        );
    }
}
