use crate::model::{
    Package, PackageLang, ParamValue, PortKind, QosDurability, QosHistory, QosPreset,
    QosReliability, RosChannel,
};
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterfaceParts {
    pub package: String,
    pub kind: String,
    pub type_name: String,
}

impl InterfaceParts {
    pub fn parse(interface_type: &str) -> Option<Self> {
        let mut parts = interface_type.trim().split('/');
        let package = parts.next()?.to_string();
        let kind = parts.next()?.to_string();
        let type_name = parts.next()?.to_string();
        if parts.next().is_some()
            || package.is_empty()
            || kind.is_empty()
            || type_name.is_empty()
        {
            return None;
        }
        Some(Self {
            package,
            kind,
            type_name,
        })
    }

    /// Python import module path: `std_msgs/msg/String` -> `std_msgs.msg`
    pub fn python_module(&self) -> String {
        format!("{}.{}", self.package, self.kind)
    }

    /// C++ qualified type: `std_msgs/msg/String` -> `std_msgs::msg::String`
    pub fn cpp_type(&self) -> String {
        format!("{}::{}::{}", self.package, self.kind, self.type_name)
    }

    /// C++ include header: `std_msgs/msg/String` -> `std_msgs/msg/string.hpp`
    pub fn cpp_header(&self) -> String {
        format!(
            "{}/{}/{}.hpp",
            self.package,
            self.kind,
            rosidl_camel_to_snake(&self.type_name)
        )
    }
}

/// Exact port of `rosidl_pycommon.convert_camel_case_to_lower_case_underscore`.
pub fn rosidl_camel_to_snake(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut pass1 = String::with_capacity(value.len() + 8);

    // Pass 1: re.sub('(.)([A-Z][a-z]+)', r'\1_\2', value)
    for i in 0..chars.len() {
        let c = chars[i];
        if i > 0
            && c.is_ascii_uppercase()
            && chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase())
        {
            pass1.push('_');
        }
        pass1.push(c);
    }

    // Pass 2: re.sub('([a-z0-9])([A-Z])', r'\1_\2', value)
    let p1_chars: Vec<char> = pass1.chars().collect();
    let mut pass2 = String::with_capacity(pass1.len() + 8);
    for i in 0..p1_chars.len() {
        let c = p1_chars[i];
        if i > 0
            && c.is_ascii_uppercase()
            && p1_chars[i - 1].is_ascii_alphanumeric()
            && !p1_chars[i - 1].is_ascii_uppercase()
        {
            pass2.push('_');
        }
        pass2.push(c);
    }

    pass2.to_ascii_lowercase()
}

/// Converts a channel name like `/robot_1/cmd_vel` into a clean identifier suffix `robot_1_cmd_vel`.
pub fn sanitize_symbol_name(input: &str) -> String {
    let mut out = String::new();
    let mut last_underscore = true;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_underscore = false;
        } else if !last_underscore {
            out.push('_');
            last_underscore = true;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "unnamed".to_string()
    } else if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("n_{trimmed}")
    } else {
        trimmed
    }
}

/// Auto-derives sorted, deduplicated ROS 2 dependencies for a package (F1.25, F1.30).
pub fn derive_dependencies(pkg: &Package, channels: &HashMap<&str, &RosChannel>) -> Vec<String> {
    let mut deps = BTreeSet::new();

    match pkg.lang {
        PackageLang::Python => {
            deps.insert("rclpy".to_string());
        }
        PackageLang::Cpp => {
            deps.insert("rclcpp".to_string());
        }
    }

    let mut has_action = false;
    for node in &pkg.nodes {
        for port in &node.ports {
            if matches!(port.kind, PortKind::ActionServer | PortKind::ActionClient) {
                has_action = true;
            }
            if let Some(ch) = channels.get(port.channel_id.as_str()) {
                if let Some(parts) = InterfaceParts::parse(&ch.interface_type) {
                    deps.insert(parts.package);
                }
            }
        }
    }

    if has_action && pkg.lang == PackageLang::Cpp {
        deps.insert("rclcpp_action".to_string());
    }

    // Every generated package includes at least one launch file.
    deps.insert("launch".to_string());
    deps.insert("launch_ros".to_string());

    for extra in &pkg.extra_deps {
        let trimmed = extra.trim();
        if !trimmed.is_empty() {
            deps.insert(trimmed.to_string());
        }
    }

    deps.into_iter().collect()
}

/// CMake `find_package` / `ament_target_dependencies` set (excludes Python-only runtime launch deps).
pub fn derive_cmake_build_dependencies(
    pkg: &Package,
    channels: &HashMap<&str, &RosChannel>,
) -> Vec<String> {
    let mut deps = BTreeSet::new();
    deps.insert("rclcpp".to_string());

    let mut has_action = false;
    for node in &pkg.nodes {
        for port in &node.ports {
            if matches!(port.kind, PortKind::ActionServer | PortKind::ActionClient) {
                has_action = true;
            }
            if let Some(ch) = channels.get(port.channel_id.as_str()) {
                if let Some(parts) = InterfaceParts::parse(&ch.interface_type) {
                    deps.insert(parts.package);
                }
            }
        }
    }

    if has_action {
        deps.insert("rclcpp_action".to_string());
    }

    for extra in &pkg.extra_deps {
        let trimmed = extra.trim();
        if !trimmed.is_empty() && trimmed != "launch" && trimmed != "launch_ros" {
            deps.insert(trimmed.to_string());
        }
    }

    deps.into_iter().collect()
}

pub fn python_qos_expr(qos: &QosPreset) -> String {
    match qos {
        QosPreset::Default => "10".to_string(),
        QosPreset::SensorData => "qos_profile_sensor_data".to_string(),
        QosPreset::ServicesDefault => "qos_profile_services_default".to_string(),
        QosPreset::SystemDefault => "qos_profile_system_default".to_string(),
        QosPreset::Custom(c) => {
            let rel = match c.reliability {
                QosReliability::Reliable => "ReliabilityPolicy.RELIABLE",
                QosReliability::BestEffort => "ReliabilityPolicy.BEST_EFFORT",
                QosReliability::SystemDefault => "ReliabilityPolicy.SYSTEM_DEFAULT",
            };
            let dur = match c.durability {
                QosDurability::Volatile => "DurabilityPolicy.VOLATILE",
                QosDurability::TransientLocal => "DurabilityPolicy.TRANSIENT_LOCAL",
                QosDurability::SystemDefault => "DurabilityPolicy.SYSTEM_DEFAULT",
            };
            let hist = match c.history {
                QosHistory::KeepLast => "HistoryPolicy.KEEP_LAST",
                QosHistory::KeepAll => "HistoryPolicy.KEEP_ALL",
                QosHistory::SystemDefault => "HistoryPolicy.SYSTEM_DEFAULT",
            };
            format!(
                "QoSProfile(depth={}, reliability={}, durability={}, history={})",
                c.depth, rel, dur, hist
            )
        }
    }
}

pub fn cpp_qos_expr(qos: &QosPreset) -> String {
    match qos {
        QosPreset::Default => "rclcpp::QoS(10)".to_string(),
        QosPreset::SensorData => "rclcpp::SensorDataQoS()".to_string(),
        QosPreset::ServicesDefault => "rclcpp::ServicesQoS()".to_string(),
        QosPreset::SystemDefault => "rclcpp::SystemDefaultsQoS()".to_string(),
        QosPreset::Custom(c) => {
            let mut expr = match c.history {
                QosHistory::KeepAll => "rclcpp::QoS(rclcpp::KeepAll())".to_string(),
                QosHistory::KeepLast | QosHistory::SystemDefault => {
                    format!("rclcpp::QoS(rclcpp::KeepLast({}))", c.depth)
                }
            };
            match c.reliability {
                QosReliability::Reliable => expr.push_str(".reliable()"),
                QosReliability::BestEffort => expr.push_str(".best_effort()"),
                QosReliability::SystemDefault => {}
            }
            match c.durability {
                QosDurability::Volatile => expr.push_str(".durability_volatile()"),
                QosDurability::TransientLocal => expr.push_str(".transient_local()"),
                QosDurability::SystemDefault => {}
            }
            expr
        }
    }
}

pub fn python_param_literal(val: &ParamValue) -> String {
    match val {
        ParamValue::Bool(b) => if *b { "True" } else { "False" }.to_string(),
        ParamValue::Int(i) => i.to_string(),
        ParamValue::Double(d) => {
            let s = d.to_string();
            if s.contains('.') || s.contains('e') || s.contains('E') {
                s
            } else {
                format!("{s}.0")
            }
        }
        ParamValue::String(s) => format!("'{}'", escape_py_single(s)),
        ParamValue::BoolArray(arr) => format!(
            "[{}]",
            arr.iter()
                .map(|b| if *b { "True" } else { "False" })
                .collect::<Vec<_>>()
                .join(", ")
        ),
        ParamValue::IntArray(arr) => format!(
            "[{}]",
            arr.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        ParamValue::DoubleArray(arr) => format!(
            "[{}]",
            arr.iter()
                .map(|d| python_param_literal(&ParamValue::Double(*d)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        ParamValue::StringArray(arr) => format!(
            "[{}]",
            arr.iter()
                .map(|s| format!("'{}'", escape_py_single(s)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

pub fn cpp_param_type_and_literal(val: &ParamValue) -> (&'static str, String) {
    match val {
        ParamValue::Bool(b) => ("bool", if *b { "true" } else { "false" }.to_string()),
        ParamValue::Int(i) => ("int64_t", format!("static_cast<int64_t>({i})")),
        ParamValue::Double(d) => {
            let s = d.to_string();
            let lit = if s.contains('.') || s.contains('e') || s.contains('E') {
                s
            } else {
                format!("{s}.0")
            };
            ("double", lit)
        }
        ParamValue::String(s) => ("std::string", format!("std::string(\"{}\")", escape_cpp(s))),
        ParamValue::BoolArray(arr) => (
            "std::vector<bool>",
            format!(
                "std::vector<bool>{{{}}}",
                arr.iter()
                    .map(|b| if *b { "true" } else { "false" })
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ),
        ParamValue::IntArray(arr) => (
            "std::vector<int64_t>",
            format!(
                "std::vector<int64_t>{{{}}}",
                arr.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ),
        ParamValue::DoubleArray(arr) => (
            "std::vector<double>",
            format!(
                "std::vector<double>{{{}}}",
                arr.iter()
                    .map(|d| cpp_param_type_and_literal(&ParamValue::Double(*d)).1)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ),
        ParamValue::StringArray(arr) => (
            "std::vector<std::string>",
            format!(
                "std::vector<std::string>{{{}}}",
                arr.iter()
                    .map(|s| format!("\"{}\"", escape_cpp(s)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ),
    }
}

pub fn escape_py_single(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
}

pub fn escape_cpp(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::build_talker_listener_example;

    #[test]
    fn rosidl_header_conversion_matches_ros2_jazzy() {
        let cases = [
            ("String", "string"),
            ("Pose2D", "pose2_d"),
            ("ColorRGBA", "color_rgba"),
            ("UInt32", "u_int32"),
            ("Float64MultiArray", "float64_multi_array"),
            ("PointCloud2", "point_cloud2"),
            ("AddTwoInts", "add_two_ints"),
            ("Fibonacci", "fibonacci"),
            ("LaserScan", "laser_scan"),
            ("NavSatFix", "nav_sat_fix"),
        ];
        for (input, expected) in cases {
            assert_eq!(rosidl_camel_to_snake(input), expected, "for {input}");
        }

        let parts = InterfaceParts::parse("std_msgs/msg/String").unwrap();
        assert_eq!(parts.python_module(), "std_msgs.msg");
        assert_eq!(parts.cpp_type(), "std_msgs::msg::String");
        assert_eq!(parts.cpp_header(), "std_msgs/msg/string.hpp");
    }

    #[test]
    fn derives_sorted_dependencies_for_python_and_cpp() {
        let project = build_talker_listener_example("/tmp/demo", "Dev", "dev@example.com");
        let ch_map: HashMap<&str, &RosChannel> = project
            .channels
            .iter()
            .map(|c| (c.id.as_str(), c))
            .collect();

        let py_deps = derive_dependencies(&project.packages[0], &ch_map);
        assert_eq!(
            py_deps,
            vec![
                "action_tutorials_interfaces",
                "example_interfaces",
                "launch",
                "launch_ros",
                "rclpy",
                "std_msgs",
            ]
        );

        let cpp_deps = derive_dependencies(&project.packages[1], &ch_map);
        assert_eq!(
            cpp_deps,
            vec![
                "action_tutorials_interfaces",
                "example_interfaces",
                "launch",
                "launch_ros",
                "rclcpp",
                "rclcpp_action",
                "std_msgs",
            ]
        );
    }
}
