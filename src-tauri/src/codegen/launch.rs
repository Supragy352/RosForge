use crate::codegen::types::{escape_py_single, python_param_literal};
use crate::model::{LaunchEntry, LaunchFile, Package, RosNode};
use std::collections::HashMap;

/// Generates a deterministic Python ROS 2 launch file for a package (F1.26, F1.30).
pub fn render_launch_file(pkg: &Package, launch_file: &LaunchFile) -> String {
    let nodes_by_id: HashMap<&str, &RosNode> =
        pkg.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut out = String::new();
    out.push_str("from launch import LaunchDescription\n");
    out.push_str("from launch_ros.actions import Node\n\n\n");
    out.push_str("def generate_launch_description():\n");
    out.push_str("    return LaunchDescription([\n");

    let effective_entries: Vec<LaunchEntry> = if launch_file.entries.is_empty() {
        pkg.nodes
            .iter()
            .map(|n| LaunchEntry {
                node_id: n.id.clone(),
                name_override: None,
                namespace: if n.namespace.is_empty() {
                    None
                } else {
                    Some(n.namespace.clone())
                },
                remaps: Vec::new(),
                param_overrides: Default::default(),
            })
            .collect()
    } else {
        launch_file.entries.clone()
    };

    for entry in &effective_entries {
        let Some(node) = nodes_by_id.get(entry.node_id.as_str()) else {
            continue;
        };
        let node_name = entry
            .name_override
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&node.name);
        let namespace = entry
            .namespace
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                if node.namespace.trim().is_empty() {
                    None
                } else {
                    Some(node.namespace.as_str())
                }
            });

        out.push_str("        Node(\n");
        out.push_str(&format!(
            "            package='{}',\n",
            escape_py_single(&pkg.name)
        ));
        out.push_str(&format!(
            "            executable='{}',\n",
            escape_py_single(&node.executable)
        ));
        out.push_str(&format!(
            "            name='{}',\n",
            escape_py_single(node_name)
        ));
        if let Some(ns) = namespace {
            out.push_str(&format!(
                "            namespace='{}',\n",
                escape_py_single(ns)
            ));
        }
        out.push_str("            output='screen',\n");

        if !entry.remaps.is_empty() {
            out.push_str("            remappings=[\n");
            for (from, to) in &entry.remaps {
                out.push_str(&format!(
                    "                ('{}', '{}'),\n",
                    escape_py_single(from),
                    escape_py_single(to)
                ));
            }
            out.push_str("            ],\n");
        }

        if !entry.param_overrides.is_empty() {
            out.push_str("            parameters=[{\n");
            for (k, v) in &entry.param_overrides {
                out.push_str(&format!(
                    "                '{}': {},\n",
                    escape_py_single(k),
                    python_param_literal(v)
                ));
            }
            out.push_str("            }],\n");
        }

        out.push_str("        ),\n");
    }

    out.push_str("    ])\n");
    out
}

/// Returns all launch files to generate for `pkg` (falls back to a default `<pkg>.launch.py`
/// containing every node in the package if `pkg.launch_files` is empty).
pub fn render_package_launch_files(pkg: &Package) -> Vec<(String, String)> {
    if pkg.launch_files.is_empty() {
        let default_lf = LaunchFile {
            id: format!("default-launch-{}", pkg.id),
            name: format!("{}.launch.py", pkg.name),
            entries: Vec::new(),
        };
        let filename = format!("launch/{}", default_lf.name);
        return vec![(filename, render_launch_file(pkg, &default_lf))];
    }

    pkg.launch_files
        .iter()
        .map(|lf| {
            let name = if lf.name.ends_with(".launch.py") || lf.name.ends_with(".py") {
                lf.name.clone()
            } else {
                format!("{}.launch.py", lf.name)
            };
            (format!("launch/{name}"), render_launch_file(pkg, lf))
        })
        .collect()
}
