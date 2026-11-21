use crate::model::DEFAULT_ROS_DISTRO;
use crate::ros_env::{self, RosEnvConfig};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const CLI_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Ros2,
    Cache,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceField {
    pub name: String,
    pub field_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    #[serde(default)]
    pub children: Vec<InterfaceField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceDefinition {
    pub interface_type: String,
    pub raw: String,
    pub fields: Vec<InterfaceField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceCatalog {
    pub ros_distro: String,
    pub source: CatalogSource,
    pub messages: Vec<String>,
    pub services: Vec<String>,
    pub actions: Vec<String>,
    #[serde(default)]
    pub definitions: BTreeMap<String, InterfaceDefinition>,
}

pub fn default_cache_path(distro: &str) -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        let trimmed = xdg.trim();
        if !trimmed.is_empty() {
            return Some(
                PathBuf::from(trimmed)
                    .join("rosforge")
                    .join(format!("interfaces-{distro}.json")),
            );
        }
    }
    dirs::home_dir().map(|h| {
        h.join(".cache")
            .join("rosforge")
            .join(format!("interfaces-{distro}.json"))
    })
}

pub fn bundled_fallback_catalog(distro: &str) -> InterfaceCatalog {
    let messages = vec![
        "std_msgs/msg/Bool",
        "std_msgs/msg/Byte",
        "std_msgs/msg/Char",
        "std_msgs/msg/ColorRGBA",
        "std_msgs/msg/Empty",
        "std_msgs/msg/Float32",
        "std_msgs/msg/Float32MultiArray",
        "std_msgs/msg/Float64",
        "std_msgs/msg/Float64MultiArray",
        "std_msgs/msg/Header",
        "std_msgs/msg/Int16",
        "std_msgs/msg/Int32",
        "std_msgs/msg/Int64",
        "std_msgs/msg/Int8",
        "std_msgs/msg/String",
        "std_msgs/msg/UInt16",
        "std_msgs/msg/UInt32",
        "std_msgs/msg/UInt64",
        "std_msgs/msg/UInt8",
        "geometry_msgs/msg/Accel",
        "geometry_msgs/msg/AccelStamped",
        "geometry_msgs/msg/Point",
        "geometry_msgs/msg/PointStamped",
        "geometry_msgs/msg/Pose",
        "geometry_msgs/msg/Pose2D",
        "geometry_msgs/msg/PoseStamped",
        "geometry_msgs/msg/PoseWithCovarianceStamped",
        "geometry_msgs/msg/Quaternion",
        "geometry_msgs/msg/Transform",
        "geometry_msgs/msg/TransformStamped",
        "geometry_msgs/msg/Twist",
        "geometry_msgs/msg/TwistStamped",
        "geometry_msgs/msg/Vector3",
        "geometry_msgs/msg/Wrench",
        "sensor_msgs/msg/BatteryState",
        "sensor_msgs/msg/CameraInfo",
        "sensor_msgs/msg/CompressedImage",
        "sensor_msgs/msg/Image",
        "sensor_msgs/msg/Imu",
        "sensor_msgs/msg/JointState",
        "sensor_msgs/msg/Joy",
        "sensor_msgs/msg/LaserScan",
        "sensor_msgs/msg/NavSatFix",
        "sensor_msgs/msg/PointCloud2",
        "sensor_msgs/msg/Range",
        "sensor_msgs/msg/Temperature",
        "nav_msgs/msg/GridCells",
        "nav_msgs/msg/MapMetaData",
        "nav_msgs/msg/OccupancyGrid",
        "nav_msgs/msg/Odometry",
        "nav_msgs/msg/Path",
        "example_interfaces/msg/Bool",
        "example_interfaces/msg/Float64",
        "example_interfaces/msg/Int64",
        "example_interfaces/msg/String",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();

    let services = vec![
        "std_srvs/srv/Empty",
        "std_srvs/srv/SetBool",
        "std_srvs/srv/Trigger",
        "example_interfaces/srv/AddTwoInts",
        "example_interfaces/srv/SetBool",
        "example_interfaces/srv/Trigger",
        "nav_msgs/srv/GetMap",
        "nav_msgs/srv/GetPlan",
        "nav_msgs/srv/SetMap",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();

    let actions = vec![
        "action_tutorials_interfaces/action/Fibonacci",
        "example_interfaces/action/Fibonacci",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();

    InterfaceCatalog {
        ros_distro: distro.to_string(),
        source: CatalogSource::Fallback,
        messages,
        services,
        actions,
        definitions: BTreeMap::new(),
    }
}

/// Parses output of `ros2 interface list` into (messages, services, actions).
pub fn parse_interface_list(stdout: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    enum Section {
        None,
        Messages,
        Services,
        Actions,
    }

    let mut section = Section::None;
    let mut messages = Vec::new();
    let mut services = Vec::new();
    let mut actions = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match trimmed {
            "Messages:" => section = Section::Messages,
            "Services:" => section = Section::Services,
            "Actions:" => section = Section::Actions,
            _ if trimmed.contains('/') => match section {
                Section::Messages => messages.push(trimmed.to_string()),
                Section::Services => services.push(trimmed.to_string()),
                Section::Actions => actions.push(trimmed.to_string()),
                Section::None => {
                    if trimmed.contains("/msg/") {
                        messages.push(trimmed.to_string());
                    } else if trimmed.contains("/srv/") {
                        services.push(trimmed.to_string());
                    } else if trimmed.contains("/action/") {
                        actions.push(trimmed.to_string());
                    }
                }
            },
            _ => {}
        }
    }

    messages.sort();
    messages.dedup();
    services.sort();
    services.dedup();
    actions.sort();
    actions.dedup();

    (messages, services, actions)
}

/// Parses output of `ros2 interface show <type>` into a nested field tree.
pub fn parse_interface_show(interface_type: &str, raw: &str) -> InterfaceDefinition {
    let mut roots: Vec<InterfaceField> = Vec::new();
    let mut stack: Vec<(usize, InterfaceField)> = Vec::new();

    let flush_to_indent =
        |target_indent: usize, stack: &mut Vec<(usize, InterfaceField)>, roots: &mut Vec<InterfaceField>| {
            while let Some((last_indent, _)) = stack.last() {
                if *last_indent >= target_indent {
                    let (_, node) = stack.pop().unwrap();
                    if let Some((_, parent)) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        roots.push(node);
                    }
                } else {
                    break;
                }
            }
        };

    for line in raw.lines() {
        // Strip inline comments
        let without_comment = line.split('#').next().unwrap_or("");
        let trimmed = without_comment.trim();
        if trimmed.is_empty() || trimmed == "---" {
            continue;
        }
        // Skip constants (`TYPE NAME=VALUE` with `=` attached to uppercase constant)
        if trimmed.contains('=') {
            continue;
        }

        let indent = without_comment.chars().take_while(|c| *c == '\t' || *c == ' ').count();
        let mut parts = trimmed.split_whitespace();
        let Some(field_type) = parts.next() else {
            continue;
        };
        let Some(name) = parts.next() else {
            continue;
        };
        let rest: Vec<&str> = parts.collect();
        let default_value = if rest.is_empty() {
            None
        } else {
            Some(rest.join(" "))
        };

        flush_to_indent(indent, &mut stack, &mut roots);
        stack.push((
            indent,
            InterfaceField {
                name: name.to_string(),
                field_type: field_type.to_string(),
                default_value,
                children: Vec::new(),
            },
        ));
    }

    flush_to_indent(0, &mut stack, &mut roots);

    InterfaceDefinition {
        interface_type: interface_type.to_string(),
        raw: raw.to_string(),
        fields: roots,
    }
}

fn read_cache(path: &Path) -> Option<InterfaceCatalog> {
    let raw = fs::read_to_string(path).ok()?;
    let mut catalog: InterfaceCatalog = serde_json::from_str(&raw).ok()?;
    catalog.source = CatalogSource::Cache;
    Some(catalog)
}

fn write_cache(path: &Path, catalog: &InterfaceCatalog) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut serialized) = serde_json::to_string_pretty(catalog) {
        serialized.push('\n');
        let tmp = path.with_extension("json.tmp");
        if fs::write(&tmp, serialized).is_ok() {
            let _ = fs::rename(&tmp, path);
        }
    }
}

/// Loads the interface catalog:
/// 1. Uses `~/.cache/rosforge/interfaces-jazzy.json` unless `refresh == true`.
/// 2. Queries `ros2 interface list` via `ros_env`.
/// 3. Falls back to the bundled common interfaces catalog if ROS 2 is unavailable.
pub async fn load_catalog(config: &RosEnvConfig, refresh: bool) -> InterfaceCatalog {
    let distro = DEFAULT_ROS_DISTRO;
    let cache_path = default_cache_path(distro);

    if !refresh {
        if let Some(ref path) = cache_path {
            if let Some(cached) = read_cache(path) {
                if !cached.messages.is_empty() {
                    return cached;
                }
            }
        }
    }

    let existing_defs = cache_path
        .as_deref()
        .and_then(read_cache)
        .map(|c| c.definitions)
        .unwrap_or_default();

    if let Ok(child) = ros_env::run_in_ros(config, "ros2 interface list", None) {
        if let Ok(Ok(output)) = tokio::time::timeout(CLI_TIMEOUT, child.wait_with_output()).await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let (messages, services, actions) = parse_interface_list(&stdout);
                if !messages.is_empty() || !services.is_empty() || !actions.is_empty() {
                    let catalog = InterfaceCatalog {
                        ros_distro: distro.to_string(),
                        source: CatalogSource::Ros2,
                        messages,
                        services,
                        actions,
                        definitions: existing_defs,
                    };
                    if let Some(ref path) = cache_path {
                        write_cache(path, &catalog);
                    }
                    return catalog;
                }
            }
        }
    }

    bundled_fallback_catalog(distro)
}

/// Lazily fetches and caches `ros2 interface show <interface_type>`.
pub async fn show_interface(
    config: &RosEnvConfig,
    interface_type: &str,
) -> Result<InterfaceDefinition, String> {
    let trimmed = interface_type.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '/')
    {
        return Err(format!("Invalid interface type '{trimmed}'"));
    }

    let distro = DEFAULT_ROS_DISTRO;
    let cache_path = default_cache_path(distro);

    if let Some(ref path) = cache_path {
        if let Some(cached) = read_cache(path) {
            if let Some(def) = cached.definitions.get(trimmed) {
                return Ok(def.clone());
            }
        }
    }

    let cmd = format!("ros2 interface show {}", ros_env::shell_quote(trimmed));
    let child = ros_env::run_in_ros(config, &cmd, None).map_err(|e| e.to_string())?;
    let output = tokio::time::timeout(CLI_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "Timed out running `ros2 interface show`".to_string())?
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "`ros2 interface show {trimmed}` failed: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let def = parse_interface_show(trimmed, &stdout);

    if let Some(ref path) = cache_path {
        let mut catalog = read_cache(path).unwrap_or_else(|| bundled_fallback_catalog(distro));
        catalog.definitions.insert(trimmed.to_string(), def.clone());
        write_cache(path, &catalog);
    }

    Ok(def)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ros2_interface_list_output() {
        let sample = r#"
Messages:
    std_msgs/msg/String
    geometry_msgs/msg/Twist
Services:
    std_srvs/srv/Trigger
    example_interfaces/srv/AddTwoInts
Actions:
    action_tutorials_interfaces/action/Fibonacci
"#;
        let (msgs, srvs, acts) = parse_interface_list(sample);
        assert_eq!(msgs, vec!["geometry_msgs/msg/Twist", "std_msgs/msg/String"]);
        assert_eq!(
            srvs,
            vec!["example_interfaces/srv/AddTwoInts", "std_srvs/srv/Trigger"]
        );
        assert_eq!(acts, vec!["action_tutorials_interfaces/action/Fibonacci"]);
    }

    #[test]
    fn parses_nested_interface_show_tree() {
        let sample = r#"
# Twist message
geometry_msgs/Vector3 linear
	float64 x
	float64 y
	float64 z
geometry_msgs/Vector3 angular
	float64 x
	float64 y
	float64 z
"#;
        let def = parse_interface_show("geometry_msgs/msg/Twist", sample);
        assert_eq!(def.fields.len(), 2);
        assert_eq!(def.fields[0].name, "linear");
        assert_eq!(def.fields[0].children.len(), 3);
        assert_eq!(def.fields[0].children[0].name, "x");
        assert_eq!(def.fields[1].name, "angular");
    }

    #[test]
    fn fallback_catalog_contains_core_packages() {
        let cat = bundled_fallback_catalog("jazzy");
        assert!(cat.messages.contains(&"std_msgs/msg/String".to_string()));
        assert!(cat.messages.contains(&"geometry_msgs/msg/Twist".to_string()));
        assert!(cat.messages.contains(&"sensor_msgs/msg/LaserScan".to_string()));
        assert!(cat.messages.contains(&"nav_msgs/msg/Odometry".to_string()));
        assert!(cat.services.contains(&"std_srvs/srv/Trigger".to_string()));
        assert!(cat
            .services
            .contains(&"example_interfaces/srv/AddTwoInts".to_string()));
        assert!(cat
            .actions
            .contains(&"action_tutorials_interfaces/action/Fibonacci".to_string()));
    }
}
