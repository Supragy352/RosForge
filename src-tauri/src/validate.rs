use crate::model::{
    ChannelKind, Diagnostic, DiagnosticSeverity, NodeOwnership, ParamType, ParamValue, PortKind,
    Project, QosDurability, QosPreset, QosReliability,
};
use std::collections::{HashMap, HashSet};

const CPP_KEYWORDS: &[&str] = &[
    "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break",
    "case", "catch", "char", "char8_t", "char16_t", "char32_t", "class", "compl", "concept",
    "const", "consteval", "constexpr", "constinit", "const_cast", "continue", "co_await",
    "co_return", "co_yield", "decltype", "default", "delete", "do", "double", "dynamic_cast",
    "else", "enum", "explicit", "export", "extern", "false", "float", "for", "friend", "goto",
    "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
    "nullptr", "operator", "or", "or_eq", "private", "protected", "public", "register",
    "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static",
    "static_assert", "static_cast", "struct", "switch", "template", "this", "thread_local",
    "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
    "virtual", "void", "volatile", "wchar_t", "while", "xor", "xor_eq",
];

const PYTHON_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
    "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
    "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
    "try", "while", "with", "yield",
];

/// ROS 2 package name rule: `[a-z][a-z0-9_]*` (REP-144).
pub fn is_valid_package_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !name.contains("__")
        && !name.ends_with('_')
}

/// ROS 2 node name rule: non-empty `[a-zA-Z_][a-zA-Z0-9_]*`, not starting with `__`.
pub fn is_valid_node_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') || name.starts_with("__") {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Valid executable name (no whitespace, ASCII identifier-like).
pub fn is_valid_executable_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Valid C++ / Python class identifier (excluding language keywords).
pub fn is_valid_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    !CPP_KEYWORDS.contains(&name) && !PYTHON_KEYWORDS.contains(&name)
}

/// Valid ROS 2 topic / service / action name (must start with `/`, slash-separated valid tokens).
pub fn is_valid_ros_channel_name(name: &str) -> bool {
    if !name.starts_with('/') || name == "/" || name.ends_with('/') || name.contains("//") {
        return false;
    }
    name[1..].split('/').all(|seg| {
        let mut chars = seg.chars();
        let Some(first) = chars.next() else {
            return false;
        };
        if !(first.is_ascii_alphabetic() || first == '_') || seg.starts_with("__") {
            return false;
        }
        chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// Valid optional ROS 2 namespace (empty or `/` followed by valid segments).
pub fn is_valid_namespace(ns: &str) -> bool {
    if ns.is_empty() || ns == "/" {
        return true;
    }
    is_valid_ros_channel_name(ns)
}

/// Valid ROS 2 interface type string matching `kind`:
/// - Topic -> `<pkg>/msg/<TypeName>`
/// - Service -> `<pkg>/srv/<TypeName>`
/// - Action -> `<pkg>/action/<TypeName>`
pub fn is_valid_interface_type(interface_type: &str, kind: ChannelKind) -> bool {
    let parts: Vec<&str> = interface_type.split('/').collect();
    if parts.len() != 3 {
        return false;
    }
    let expected_mid = match kind {
        ChannelKind::Topic => "msg",
        ChannelKind::Service => "srv",
        ChannelKind::Action => "action",
    };
    if parts[1] != expected_mid {
        return false;
    }
    if !is_valid_package_name(parts[0]) {
        return false;
    }
    let mut chars = parts[2].chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_uppercase() && chars.all(|c| c.is_ascii_alphanumeric())
}

/// Valid ROS 2 parameter name (dot-separated identifier segments).
pub fn is_valid_param_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    name.split('.').all(|seg| {
        let mut chars = seg.chars();
        let Some(first) = chars.next() else {
            return false;
        };
        (first.is_ascii_alphabetic() || first == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

pub fn param_default_matches_type(param_type: ParamType, default: &ParamValue) -> bool {
    matches!(
        (param_type, default),
        (ParamType::Bool, ParamValue::Bool(_))
            | (ParamType::Int, ParamValue::Int(_))
            | (ParamType::Double, ParamValue::Double(_))
            | (ParamType::String, ParamValue::String(_))
            | (ParamType::BoolArray, ParamValue::BoolArray(_))
            | (ParamType::IntArray, ParamValue::IntArray(_))
            | (ParamType::DoubleArray, ParamValue::DoubleArray(_))
            | (ParamType::StringArray, ParamValue::StringArray(_))
    )
}

fn port_matches_channel(port_kind: PortKind, channel_kind: ChannelKind) -> bool {
    matches!(
        (port_kind, channel_kind),
        (PortKind::Pub | PortKind::Sub, ChannelKind::Topic)
            | (PortKind::SrvServer | PortKind::SrvClient, ChannelKind::Service)
            | (
                PortKind::ActionServer | PortKind::ActionClient,
                ChannelKind::Action
            )
    )
}

fn resolve_qos(qos: &QosPreset) -> (QosReliability, QosDurability) {
    match qos {
        QosPreset::Default | QosPreset::ServicesDefault | QosPreset::SystemDefault => {
            (QosReliability::Reliable, QosDurability::Volatile)
        }
        QosPreset::SensorData => (QosReliability::BestEffort, QosDurability::Volatile),
        QosPreset::Custom(c) => (c.reliability, c.durability),
    }
}

fn diag(
    severity: DiagnosticSeverity,
    message: impl Into<String>,
    target_id: Option<String>,
) -> Diagnostic {
    Diagnostic {
        severity,
        message: message.into(),
        target_id,
        file: None,
        line: None,
    }
}

pub fn has_errors(diagnostics: &[Diagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Error)
}

/// Validates the entire project model, returning all errors (F1.19) and warnings (F1.20).
pub fn validate_project(project: &Project) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    // 1. Channels validation
    let mut channels_by_id: HashMap<&str, (ChannelKind, &str)> = HashMap::new();
    let mut seen_channels: HashSet<(u8, &str)> = HashSet::new();

    for ch in &project.channels {
        channels_by_id.insert(ch.id.as_str(), (ch.kind, ch.name.as_str()));

        if !is_valid_ros_channel_name(&ch.name) {
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!(
                    "Invalid ROS channel name '{}': must start with '/' and contain valid identifier segments.",
                    ch.name
                ),
                Some(ch.id.clone()),
            ));
        }

        let kind_tag = match ch.kind {
            ChannelKind::Topic => 0,
            ChannelKind::Service => 1,
            ChannelKind::Action => 2,
        };
        if !seen_channels.insert((kind_tag, ch.name.as_str())) {
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!("Duplicate channel '{}' of the same kind.", ch.name),
                Some(ch.id.clone()),
            ));
        }

        if ch.interface_type.trim().is_empty() {
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!("Channel '{}' is missing an interface type.", ch.name),
                Some(ch.id.clone()),
            ));
        } else if !is_valid_interface_type(&ch.interface_type, ch.kind) {
            let expected = match ch.kind {
                ChannelKind::Topic => "<pkg>/msg/<Type>",
                ChannelKind::Service => "<pkg>/srv/<Type>",
                ChannelKind::Action => "<pkg>/action/<Type>",
            };
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!(
                    "Channel '{}' has invalid interface type '{}' (expected {}).",
                    ch.name, ch.interface_type, expected
                ),
                Some(ch.id.clone()),
            ));
        }
    }

    // Track per-channel port attachments for F1.20 warnings & QoS checks
    struct AttachedPort<'a> {
        node_name: &'a str,
        port_id: &'a str,
        kind: PortKind,
        qos: &'a QosPreset,
    }
    let mut channel_ports: HashMap<&str, Vec<AttachedPort<'_>>> = HashMap::new();

    // 2. Packages & nodes validation
    let mut seen_pkg_names: HashSet<&str> = HashSet::new();

    for pkg in &project.packages {
        if !is_valid_package_name(&pkg.name) {
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!(
                    "Invalid package name '{}': must match [a-z][a-z0-9_]* without double or trailing underscores.",
                    pkg.name
                ),
                Some(pkg.id.clone()),
            ));
        }

        if !seen_pkg_names.insert(pkg.name.as_str()) {
            diagnostics.push(diag(
                DiagnosticSeverity::Error,
                format!("Duplicate package name '{}'.", pkg.name),
                Some(pkg.id.clone()),
            ));
        }

        let mut seen_node_names: HashSet<&str> = HashSet::new();
        let mut seen_executables: HashSet<&str> = HashSet::new();

        for node in &pkg.nodes {
            if !is_valid_node_name(&node.name) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Invalid node name '{}' in package '{}'.",
                        node.name, pkg.name
                    ),
                    Some(node.id.clone()),
                ));
            }
            if !seen_node_names.insert(node.name.as_str()) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Duplicate node name '{}' in package '{}'.",
                        node.name, pkg.name
                    ),
                    Some(node.id.clone()),
                ));
            }

            if !is_valid_executable_name(&node.executable) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Invalid executable name '{}' on node '{}' in package '{}'.",
                        node.executable, node.name, pkg.name
                    ),
                    Some(node.id.clone()),
                ));
            }
            if !seen_executables.insert(node.executable.as_str()) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Duplicate executable name '{}' in package '{}'.",
                        node.executable, pkg.name
                    ),
                    Some(node.id.clone()),
                ));
            }

            if !is_valid_identifier(&node.class_name) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Invalid class name '{}' on node '{}': must be a valid C++/Python identifier and not a keyword.",
                        node.class_name, node.name
                    ),
                    Some(node.id.clone()),
                ));
            }

            if !is_valid_namespace(&node.namespace) {
                diagnostics.push(diag(
                    DiagnosticSeverity::Error,
                    format!(
                        "Invalid namespace '{}' on node '{}'.",
                        node.namespace, node.name
                    ),
                    Some(node.id.clone()),
                ));
            }

            // Ports
            for port in &node.ports {
                match channels_by_id.get(port.channel_id.as_str()) {
                    None => {
                        diagnostics.push(diag(
                            DiagnosticSeverity::Error,
                            format!(
                                "Port on node '{}' references missing channel '{}'.",
                                node.name, port.channel_id
                            ),
                            Some(port.id.clone()),
                        ));
                    }
                    Some(&(ch_kind, ch_name)) => {
                        if !port_matches_channel(port.kind, ch_kind) {
                            diagnostics.push(diag(
                                DiagnosticSeverity::Error,
                                format!(
                                    "Port on node '{}' has incompatible kind for channel '{}'.",
                                    node.name, ch_name
                                ),
                                Some(port.id.clone()),
                            ));
                        } else {
                            channel_ports
                                .entry(port.channel_id.as_str())
                                .or_default()
                                .push(AttachedPort {
                                    node_name: node.name.as_str(),
                                    port_id: port.id.as_str(),
                                    kind: port.kind,
                                    qos: &port.qos,
                                });
                        }
                    }
                }
            }

            // Params
            let mut seen_params: HashSet<&str> = HashSet::new();
            for param in &node.params {
                if !is_valid_param_name(&param.name) {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Invalid parameter name '{}' on node '{}'.",
                            param.name, node.name
                        ),
                        Some(param.id.clone()),
                    ));
                }
                if !seen_params.insert(param.name.as_str()) {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Duplicate parameter '{}' on node '{}'.",
                            param.name, node.name
                        ),
                        Some(param.id.clone()),
                    ));
                }
                if !param_default_matches_type(param.param_type, &param.default) {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Parameter '{}' on node '{}' has a default value that does not match its declared type.",
                            param.name, node.name
                        ),
                        Some(param.id.clone()),
                    ));
                }
            }

            // Timers
            let mut seen_timers: HashSet<&str> = HashSet::new();
            for timer in &node.timers {
                if !is_valid_identifier(&timer.name) {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Invalid timer name '{}' on node '{}': must be a valid identifier.",
                            timer.name, node.name
                        ),
                        Some(timer.id.clone()),
                    ));
                }
                if !seen_timers.insert(timer.name.as_str()) {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Duplicate timer '{}' on node '{}'.",
                            timer.name, node.name
                        ),
                        Some(timer.id.clone()),
                    ));
                }
                if timer.period_ms == 0 {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Error,
                        format!(
                            "Timer '{}' on node '{}' must have period > 0 ms.",
                            timer.name, node.name
                        ),
                        Some(timer.id.clone()),
                    ));
                }
                if node.ownership == NodeOwnership::Generated && timer.behavior.is_none() {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!(
                            "Timer '{}' on generated node '{}' has no behavior configured (will emit TODO stub).",
                            timer.name, node.name
                        ),
                        Some(timer.id.clone()),
                    ));
                }
            }
        }
    }

    // 3. Channel connectivity & QoS compatibility warnings (F1.20)
    for ch in &project.channels {
        let attached = channel_ports
            .get(ch.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or(&[]);

        match ch.kind {
            ChannelKind::Topic => {
                let pubs: Vec<&AttachedPort<'_>> = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::Pub)
                    .collect();
                let subs: Vec<&AttachedPort<'_>> = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::Sub)
                    .collect();

                if !subs.is_empty() && pubs.is_empty() {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!("Topic '{}' has subscriber(s) but no publisher.", ch.name),
                        Some(ch.id.clone()),
                    ));
                } else if !pubs.is_empty() && subs.is_empty() {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!("Topic '{}' has publisher(s) but no subscriber.", ch.name),
                        Some(ch.id.clone()),
                    ));
                }

                for pub_port in &pubs {
                    let (pub_rel, pub_dur) = resolve_qos(pub_port.qos);
                    for sub_port in &subs {
                        let (sub_rel, sub_dur) = resolve_qos(sub_port.qos);
                        if pub_rel == QosReliability::BestEffort
                            && sub_rel == QosReliability::Reliable
                        {
                            diagnostics.push(diag(
                                DiagnosticSeverity::Warning,
                                format!(
                                    "QoS mismatch on '{}': publisher '{}' uses best_effort while subscriber '{}' requires reliable.",
                                    ch.name, pub_port.node_name, sub_port.node_name
                                ),
                                Some(sub_port.port_id.to_string()),
                            ));
                        }
                        if pub_dur == QosDurability::Volatile
                            && sub_dur == QosDurability::TransientLocal
                        {
                            diagnostics.push(diag(
                                DiagnosticSeverity::Warning,
                                format!(
                                    "QoS durability mismatch on '{}': publisher '{}' is volatile while subscriber '{}' requires transient_local.",
                                    ch.name, pub_port.node_name, sub_port.node_name
                                ),
                                Some(sub_port.port_id.to_string()),
                            ));
                        }
                    }
                }
            }
            ChannelKind::Service => {
                let servers = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::SrvServer)
                    .count();
                let clients = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::SrvClient)
                    .count();

                if clients > 0 && servers == 0 {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!("Service '{}' has client(s) but no server.", ch.name),
                        Some(ch.id.clone()),
                    ));
                }
                if servers > 1 {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!(
                            "Service '{}' has {} servers (expected at most 1).",
                            ch.name, servers
                        ),
                        Some(ch.id.clone()),
                    ));
                }
            }
            ChannelKind::Action => {
                let servers = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::ActionServer)
                    .count();
                let clients = attached
                    .iter()
                    .filter(|p| p.kind == PortKind::ActionClient)
                    .count();

                if clients > 0 && servers == 0 {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!("Action '{}' has client(s) but no server.", ch.name),
                        Some(ch.id.clone()),
                    ));
                }
                if servers > 1 {
                    diagnostics.push(diag(
                        DiagnosticSeverity::Warning,
                        format!(
                            "Action '{}' has {} servers (expected at most 1).",
                            ch.name, servers
                        ),
                        Some(ch.id.clone()),
                    ));
                }
            }
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CustomQos, ItemOrigin, Maintainer, Package, PackageLang, Param, Port, QosHistory,
        RosChannel, RosNode,
    };
    use crate::project::build_talker_listener_example;

    #[test]
    fn name_validation_rules() {
        assert!(is_valid_package_name("my_pkg_1"));
        assert!(!is_valid_package_name("MyPkg"));
        assert!(!is_valid_package_name("1pkg"));
        assert!(!is_valid_package_name("pkg__a"));
        assert!(!is_valid_package_name("pkg_"));

        assert!(is_valid_node_name("talker_1"));
        assert!(!is_valid_node_name("1talker"));
        assert!(!is_valid_node_name("__hidden"));

        assert!(is_valid_ros_channel_name("/chatter"));
        assert!(is_valid_ros_channel_name("/robot_1/cmd_vel"));
        assert!(!is_valid_ros_channel_name("chatter"));
        assert!(!is_valid_ros_channel_name("/"));
        assert!(!is_valid_ros_channel_name("/chatter/"));
        assert!(!is_valid_ros_channel_name("/a//b"));

        assert!(is_valid_identifier("TalkerNode"));
        assert!(!is_valid_identifier("class"));
        assert!(!is_valid_identifier("123Node"));

        assert!(is_valid_interface_type(
            "std_msgs/msg/String",
            ChannelKind::Topic
        ));
        assert!(!is_valid_interface_type(
            "std_msgs/srv/String",
            ChannelKind::Topic
        ));
        assert!(is_valid_interface_type(
            "example_interfaces/srv/AddTwoInts",
            ChannelKind::Service
        ));
        assert!(is_valid_interface_type(
            "action_tutorials_interfaces/action/Fibonacci",
            ChannelKind::Action
        ));
    }

    #[test]
    fn example_project_has_zero_errors() {
        let project = build_talker_listener_example("/tmp/demo", "Dev", "dev@example.com");
        let diags = validate_project(&project);
        assert!(
            !has_errors(&diags),
            "expected no errors in example project, got: {diags:?}"
        );
    }

    #[test]
    fn detects_qos_incompatibility_and_param_type_mismatch() {
        let mut project = Project::new("test", "/tmp/test");
        project.channels.push(RosChannel {
            id: "ch1".into(),
            kind: ChannelKind::Topic,
            name: "/scan".into(),
            interface_type: "sensor_msgs/msg/LaserScan".into(),
        });
        project.packages.push(Package {
            id: "p1".into(),
            name: "sensor_pkg".into(),
            lang: PackageLang::Cpp,
            version: "0.1.0".into(),
            description: String::new(),
            maintainer: Maintainer {
                name: "A".into(),
                email: "a@b.com".into(),
            },
            license: "Apache-2.0".into(),
            nodes: vec![
                RosNode {
                    id: "n1".into(),
                    name: "pub_node".into(),
                    executable: "pub_node".into(),
                    class_name: "PubNode".into(),
                    namespace: String::new(),
                    ownership: NodeOwnership::Generated,
                    ports: vec![Port {
                        id: "pt1".into(),
                        kind: PortKind::Pub,
                        channel_id: "ch1".into(),
                        qos: QosPreset::SensorData,
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    }],
                    params: vec![Param {
                        id: "pr1".into(),
                        name: "rate".into(),
                        param_type: ParamType::Int,
                        default: ParamValue::String("not_an_int".into()),
                        description: String::new(),
                        origin: ItemOrigin::Ui,
                    }],
                    timers: Vec::new(),
                    source_file: None,
                },
                RosNode {
                    id: "n2".into(),
                    name: "sub_node".into(),
                    executable: "sub_node".into(),
                    class_name: "SubNode".into(),
                    namespace: String::new(),
                    ownership: NodeOwnership::Generated,
                    ports: vec![Port {
                        id: "pt2".into(),
                        kind: PortKind::Sub,
                        channel_id: "ch1".into(),
                        qos: QosPreset::Custom(CustomQos {
                            depth: 10,
                            reliability: QosReliability::Reliable,
                            durability: QosDurability::Volatile,
                            history: QosHistory::KeepLast,
                        }),
                        behavior: None,
                        origin: ItemOrigin::Ui,
                        code_location: None,
                    }],
                    params: Vec::new(),
                    timers: Vec::new(),
                    source_file: None,
                },
            ],
            launch_files: Vec::new(),
            extra_deps: Vec::new(),
        });

        let diags = validate_project(&project);
        assert!(has_errors(&diags));
        assert!(diags
            .iter()
            .any(|d| d.severity == DiagnosticSeverity::Error && d.message.contains("Parameter 'rate'")));
        assert!(diags
            .iter()
            .any(|d| d.severity == DiagnosticSeverity::Warning && d.message.contains("QoS mismatch")));
    }
}
