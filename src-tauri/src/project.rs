use crate::model::{
    new_id, CanvasPosition, CanvasState, ChannelKind, ItemOrigin, LaunchEntry, LaunchFile,
    Maintainer, NodeOwnership, Package, PackageLang, Param, ParamType, ParamValue, Port, PortKind,
    Project, QosPreset, RosChannel, RosNode, Timer, Viewport, CURRENT_SCHEMA_VERSION,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const PROJECT_FILE_NAME: &str = ".rosforge.json";
pub const MAX_RECENT_WORKSPACES: usize = 10;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("workspace path cannot be empty")]
    EmptyWorkspacePath,
    #[error("failed to create workspace directory '{path}': {source}")]
    CreateDirFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("project file not found at '{path}'")]
    NotFound { path: String },
    #[error("failed to read project file '{path}': {source}")]
    ReadFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse project JSON at '{path}': {source}")]
    ParseFailed {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("unsupported project schemaVersion {found} (max supported: {supported})")]
    UnsupportedSchemaVersion { found: u32, supported: u32 },
    #[error("failed to write project file '{path}': {source}")]
    WriteFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

pub fn project_file_path(workspace_path: &Path) -> PathBuf {
    workspace_path.join(PROJECT_FILE_NAME)
}

/// Schema migration hook for `.rosforge.json`.
/// Currently supports `schemaVersion: 1` and rejects unknown future versions.
pub fn migrate_project_json(mut value: serde_json::Value) -> Result<Project, ProjectError> {
    let version = value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(CURRENT_SCHEMA_VERSION);

    if version > CURRENT_SCHEMA_VERSION {
        return Err(ProjectError::UnsupportedSchemaVersion {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "schemaVersion".to_string(),
            serde_json::Value::from(CURRENT_SCHEMA_VERSION),
        );
    }

    serde_json::from_value(value).map_err(|source| ProjectError::ParseFailed {
        path: PROJECT_FILE_NAME.to_string(),
        source,
    })
}

/// Ensures `<workspace>/` and `<workspace>/src/` exist, then loads `<workspace>/.rosforge.json`
/// if present, or creates and saves a fresh project.
pub fn open_or_init_workspace(
    workspace_path: &Path,
    project_name: Option<&str>,
) -> Result<Project, ProjectError> {
    let ws_str = workspace_path.to_string_lossy();
    if ws_str.trim().is_empty() {
        return Err(ProjectError::EmptyWorkspacePath);
    }

    fs::create_dir_all(workspace_path).map_err(|source| ProjectError::CreateDirFailed {
        path: workspace_path.display().to_string(),
        source,
    })?;

    let src_dir = workspace_path.join("src");
    fs::create_dir_all(&src_dir).map_err(|source| ProjectError::CreateDirFailed {
        path: src_dir.display().to_string(),
        source,
    })?;

    let file_path = project_file_path(workspace_path);
    if file_path.exists() {
        let mut project = load_project(workspace_path)?;
        project.workspace_path = workspace_path.display().to_string();
        return Ok(project);
    }

    let derived_name = project_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            workspace_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_else(|| "rosforge_ws".to_string());

    let project = Project::new(derived_name, workspace_path.display().to_string());
    save_project(&project)?;
    Ok(project)
}

pub fn load_project(workspace_path: &Path) -> Result<Project, ProjectError> {
    let file_path = project_file_path(workspace_path);
    if !file_path.exists() {
        return Err(ProjectError::NotFound {
            path: file_path.display().to_string(),
        });
    }

    let raw = fs::read_to_string(&file_path).map_err(|source| ProjectError::ReadFailed {
        path: file_path.display().to_string(),
        source,
    })?;

    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|source| ProjectError::ParseFailed {
            path: file_path.display().to_string(),
            source,
        })?;

    migrate_project_json(value).map_err(|err| match err {
        ProjectError::ParseFailed { source, .. } => ProjectError::ParseFailed {
            path: file_path.display().to_string(),
            source,
        },
        other => other,
    })
}

pub fn save_project(project: &Project) -> Result<(), ProjectError> {
    if project.workspace_path.trim().is_empty() {
        return Err(ProjectError::EmptyWorkspacePath);
    }

    let workspace_path = Path::new(&project.workspace_path);
    fs::create_dir_all(workspace_path).map_err(|source| ProjectError::CreateDirFailed {
        path: workspace_path.display().to_string(),
        source,
    })?;

    let src_dir = workspace_path.join("src");
    fs::create_dir_all(&src_dir).map_err(|source| ProjectError::CreateDirFailed {
        path: src_dir.display().to_string(),
        source,
    })?;

    let file_path = project_file_path(workspace_path);
    let mut serialized =
        serde_json::to_string_pretty(project).expect("Project serialization cannot fail");
    serialized.push('\n');

    let tmp_path = workspace_path.join(".rosforge.json.tmp");
    fs::write(&tmp_path, serialized).map_err(|source| ProjectError::WriteFailed {
        path: tmp_path.display().to_string(),
        source,
    })?;

    fs::rename(&tmp_path, &file_path).map_err(|source| ProjectError::WriteFailed {
        path: file_path.display().to_string(),
        source,
    })?;

    Ok(())
}

/// Records `workspace_path` at the front of `recent`, deduplicating and capping length.
pub fn record_recent_workspace(recent: &mut Vec<String>, workspace_path: &str) {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return;
    }
    recent.retain(|p| p != trimmed);
    recent.insert(0, trimmed.to_string());
    recent.truncate(MAX_RECENT_WORKSPACES);
}

/// Builds the M1 acceptance example graph (SPEC §4 M1 Acceptance & §5 Empty-state onboarding):
/// - Python package `py_pubsub` with `talker` (pub `/chatter`, srv client `/add_two_ints`, action client `/fibonacci`, 500ms timer, `greeting` param)
/// - C++ package `cpp_pubsub` with `listener` (sub `/chatter`, srv server `/add_two_ints`, action server `/fibonacci`)
pub fn build_talker_listener_example(
    workspace_path: &str,
    maintainer_name: &str,
    maintainer_email: &str,
) -> Project {
    let maint_name = if maintainer_name.trim().is_empty() {
        "RosForge User".to_string()
    } else {
        maintainer_name.trim().to_string()
    };
    let maint_email = if maintainer_email.trim().is_empty() {
        "user@example.com".to_string()
    } else {
        maintainer_email.trim().to_string()
    };

    let ch_chatter_id = new_id();
    let ch_add_id = new_id();
    let ch_fib_id = new_id();

    let py_pkg_id = new_id();
    let talker_id = new_id();

    let cpp_pkg_id = new_id();
    let listener_id = new_id();

    let py_pkg = Package {
        id: py_pkg_id.clone(),
        name: "py_pubsub".to_string(),
        lang: PackageLang::Python,
        version: "0.1.0".to_string(),
        description: "Python talker and client example package".to_string(),
        maintainer: Maintainer {
            name: maint_name.clone(),
            email: maint_email.clone(),
        },
        license: "Apache-2.0".to_string(),
        nodes: vec![RosNode {
            id: talker_id.clone(),
            name: "talker".to_string(),
            executable: "talker".to_string(),
            class_name: "TalkerNode".to_string(),
            namespace: String::new(),
            ownership: NodeOwnership::Generated,
            ports: vec![
                Port {
                    id: new_id(),
                    kind: PortKind::Pub,
                    channel_id: ch_chatter_id.clone(),
                    qos: QosPreset::Default,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
                Port {
                    id: new_id(),
                    kind: PortKind::SrvClient,
                    channel_id: ch_add_id.clone(),
                    qos: QosPreset::ServicesDefault,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
                Port {
                    id: new_id(),
                    kind: PortKind::ActionClient,
                    channel_id: ch_fib_id.clone(),
                    qos: QosPreset::Default,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
            ],
            params: vec![Param {
                id: new_id(),
                name: "greeting".to_string(),
                param_type: ParamType::String,
                default: ParamValue::String("Hello ROS 2".to_string()),
                description: "Greeting prefix logged by talker".to_string(),
                origin: ItemOrigin::Ui,
            }],
            timers: vec![Timer {
                id: new_id(),
                name: "publish_timer".to_string(),
                period_ms: 500,
                behavior: None,
                origin: ItemOrigin::Ui,
            }],
            source_file: None,
        }],
        launch_files: vec![LaunchFile {
            id: new_id(),
            name: "py_pubsub.launch.py".to_string(),
            entries: vec![LaunchEntry {
                node_id: talker_id.clone(),
                name_override: None,
                namespace: None,
                remaps: Vec::new(),
                param_overrides: BTreeMap::new(),
            }],
        }],
        extra_deps: Vec::new(),
    };

    let cpp_pkg = Package {
        id: cpp_pkg_id.clone(),
        name: "cpp_pubsub".to_string(),
        lang: PackageLang::Cpp,
        version: "0.1.0".to_string(),
        description: "C++ listener, service server, and action server example package".to_string(),
        maintainer: Maintainer {
            name: maint_name,
            email: maint_email,
        },
        license: "Apache-2.0".to_string(),
        nodes: vec![RosNode {
            id: listener_id.clone(),
            name: "listener".to_string(),
            executable: "listener".to_string(),
            class_name: "ListenerNode".to_string(),
            namespace: String::new(),
            ownership: NodeOwnership::Generated,
            ports: vec![
                Port {
                    id: new_id(),
                    kind: PortKind::Sub,
                    channel_id: ch_chatter_id.clone(),
                    qos: QosPreset::Default,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
                Port {
                    id: new_id(),
                    kind: PortKind::SrvServer,
                    channel_id: ch_add_id.clone(),
                    qos: QosPreset::ServicesDefault,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
                Port {
                    id: new_id(),
                    kind: PortKind::ActionServer,
                    channel_id: ch_fib_id.clone(),
                    qos: QosPreset::Default,
                    behavior: None,
                    origin: ItemOrigin::Ui,
                    code_location: None,
                },
            ],
            params: vec![Param {
                id: new_id(),
                name: "log_received".to_string(),
                param_type: ParamType::Bool,
                default: ParamValue::Bool(true),
                description: "Log received messages".to_string(),
                origin: ItemOrigin::Ui,
            }],
            timers: Vec::new(),
            source_file: None,
        }],
        launch_files: vec![LaunchFile {
            id: new_id(),
            name: "cpp_pubsub.launch.py".to_string(),
            entries: vec![LaunchEntry {
                node_id: listener_id.clone(),
                name_override: None,
                namespace: None,
                remaps: Vec::new(),
                param_overrides: BTreeMap::new(),
            }],
        }],
        extra_deps: Vec::new(),
    };

    let channels = vec![
        RosChannel {
            id: ch_chatter_id.clone(),
            kind: ChannelKind::Topic,
            name: "/chatter".to_string(),
            interface_type: "std_msgs/msg/String".to_string(),
        },
        RosChannel {
            id: ch_add_id.clone(),
            kind: ChannelKind::Service,
            name: "/add_two_ints".to_string(),
            interface_type: "example_interfaces/srv/AddTwoInts".to_string(),
        },
        RosChannel {
            id: ch_fib_id.clone(),
            kind: ChannelKind::Action,
            name: "/fibonacci".to_string(),
            interface_type: "action_tutorials_interfaces/action/Fibonacci".to_string(),
        },
    ];

    let mut positions = BTreeMap::new();
    positions.insert(py_pkg_id, CanvasPosition { x: 40.0, y: 60.0 });
    positions.insert(talker_id, CanvasPosition { x: 24.0, y: 56.0 });
    positions.insert(ch_chatter_id, CanvasPosition { x: 430.0, y: 90.0 });
    positions.insert(ch_add_id, CanvasPosition { x: 430.0, y: 210.0 });
    positions.insert(ch_fib_id, CanvasPosition { x: 430.0, y: 330.0 });
    positions.insert(cpp_pkg_id, CanvasPosition { x: 760.0, y: 60.0 });
    positions.insert(listener_id, CanvasPosition { x: 24.0, y: 56.0 });

    Project {
        schema_version: CURRENT_SCHEMA_VERSION,
        name: "talker_listener_demo".to_string(),
        workspace_path: workspace_path.to_string(),
        ros_distro: crate::model::DEFAULT_ROS_DISTRO.to_string(),
        packages: vec![py_pkg, cpp_pkg],
        channels,
        canvas: CanvasState {
            positions,
            viewport: Viewport::default(),
        },
        generated_file_hashes: BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn open_or_init_creates_src_and_project_file() {
        let dir = TempDir::new().expect("temp dir");
        let ws = dir.path().join("my_ws");

        let proj = open_or_init_workspace(&ws, None).expect("init workspace");
        assert_eq!(proj.name, "my_ws");
        assert!(ws.join("src").is_dir());
        assert!(ws.join(PROJECT_FILE_NAME).is_file());

        let reloaded = open_or_init_workspace(&ws, Some("ignored")).expect("reopen workspace");
        assert_eq!(reloaded.name, "my_ws");
    }

    #[test]
    fn rejects_unsupported_future_schema_version() {
        let json = serde_json::json!({
            "schemaVersion": 999,
            "name": "future",
            "workspacePath": "/tmp/future",
            "rosDistro": "jazzy",
            "packages": [],
            "channels": [],
            "canvas": { "positions": {}, "viewport": { "x": 0.0, "y": 0.0, "zoom": 1.0 } }
        });
        let err = migrate_project_json(json).expect_err("should fail");
        assert!(matches!(
            err,
            ProjectError::UnsupportedSchemaVersion { found: 999, .. }
        ));
    }

    #[test]
    fn recent_workspaces_dedups_and_caps() {
        let mut recent = vec!["/a".to_string(), "/b".to_string()];
        record_recent_workspace(&mut recent, "/b");
        assert_eq!(recent, vec!["/b", "/a"]);

        for i in 0..15 {
            record_recent_workspace(&mut recent, &format!("/ws/{i}"));
        }
        assert_eq!(recent.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(recent[0], "/ws/14");
    }

    #[test]
    fn talker_listener_example_roundtrips_json() {
        let dir = TempDir::new().expect("temp dir");
        let proj = build_talker_listener_example(
            &dir.path().display().to_string(),
            "Supragy",
            "supragy@example.com",
        );
        save_project(&proj).expect("save example");
        let loaded = load_project(dir.path()).expect("load example");
        assert_eq!(loaded, proj);
        assert_eq!(loaded.packages.len(), 2);
        assert_eq!(loaded.channels.len(), 3);
    }
}
