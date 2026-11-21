use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use uuid::Uuid;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_ROS_DISTRO: &str = "jazzy";

/// Generate a new time-ordered UUIDv7 string for model entities.
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub name: String,
    pub workspace_path: String,
    pub ros_distro: String,
    pub packages: Vec<Package>,
    pub channels: Vec<RosChannel>,
    pub canvas: CanvasState,
    /// Per-file hashes of non-region generated content for hand-edit detection (F1.28).
    #[serde(default)]
    pub generated_file_hashes: BTreeMap<String, String>,
}

impl Project {
    pub fn new(name: impl Into<String>, workspace_path: impl Into<String>) -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            name: name.into(),
            workspace_path: workspace_path.into(),
            ros_distro: DEFAULT_ROS_DISTRO.to_string(),
            packages: Vec::new(),
            channels: Vec::new(),
            canvas: CanvasState::default(),
            generated_file_hashes: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CanvasState {
    pub positions: BTreeMap<String, CanvasPosition>,
    pub viewport: Viewport,
}

impl Default for CanvasState {
    fn default() -> Self {
        Self {
            positions: BTreeMap::new(),
            viewport: Viewport::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct CanvasPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: String,
    pub name: String,
    pub lang: PackageLang,
    pub version: String,
    pub description: String,
    pub maintainer: Maintainer,
    pub license: String,
    pub nodes: Vec<RosNode>,
    pub launch_files: Vec<LaunchFile>,
    pub extra_deps: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum PackageLang {
    Python,
    Cpp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Maintainer {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RosNode {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub class_name: String,
    pub namespace: String,
    pub ownership: NodeOwnership,
    pub ports: Vec<Port>,
    pub params: Vec<Param>,
    pub timers: Vec<Timer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeOwnership {
    Generated,
    Handwritten,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub id: String,
    pub kind: PortKind,
    pub channel_id: String,
    pub qos: QosPreset,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior: Option<Behavior>,
    pub origin: ItemOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_location: Option<CodeLocation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PortKind {
    Pub,
    Sub,
    SrvServer,
    SrvClient,
    ActionServer,
    ActionClient,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ItemOrigin {
    Ui,
    Code,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CodeLocation {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RosChannel {
    pub id: String,
    pub kind: ChannelKind,
    pub name: String,
    #[serde(rename = "type")]
    pub interface_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Topic,
    Service,
    Action,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: ParamType,
    pub default: ParamValue,
    pub description: String,
    pub origin: ItemOrigin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ParamType {
    Bool,
    Int,
    Double,
    String,
    BoolArray,
    IntArray,
    DoubleArray,
    StringArray,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ParamValue {
    Bool(bool),
    Int(i32),
    Double(f64),
    String(String),
    BoolArray(Vec<bool>),
    IntArray(Vec<i32>),
    DoubleArray(Vec<f64>),
    StringArray(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub id: String,
    pub name: String,
    pub period_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior: Option<Behavior>,
    pub origin: ItemOrigin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "preset", rename_all = "snake_case")]
pub enum QosPreset {
    Default,
    SensorData,
    ServicesDefault,
    SystemDefault,
    Custom(CustomQos),
}

impl Default for QosPreset {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CustomQos {
    pub depth: u32,
    pub reliability: QosReliability,
    pub durability: QosDurability,
    pub history: QosHistory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum QosReliability {
    Reliable,
    BestEffort,
    SystemDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum QosDurability {
    Volatile,
    TransientLocal,
    SystemDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum QosHistory {
    KeepLast,
    KeepAll,
    SystemDefault,
}

/// Behavior templates (expanded in M3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "template", rename_all = "snake_case")]
pub enum Behavior {
    LogMessage {
        level: LogLevel,
        fields: Vec<String>,
    },
    Republish {
        target_port_id: String,
        throttle_hz: Option<f64>,
    },
    PublishConstant {
        target_port_id: String,
        fields: BTreeMap<String, String>,
    },
    Waveform {
        target_port_id: String,
        field: String,
        mode: WaveformMode,
        amplitude: f64,
        frequency_hz: f64,
        step: f64,
    },
    FieldMath {
        target_port_id: String,
        output_field: String,
        expression: String,
    },
    Threshold {
        target_port_id: String,
        input_field: String,
        operator: ThresholdOp,
        value: f64,
    },
    EchoService {
        fields: BTreeMap<String, String>,
    },
    FakeAction {
        steps: u32,
        step_delay_ms: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum WaveformMode {
    Counter,
    Sine,
    Ramp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ThresholdOp {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
    Neq,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFile {
    pub id: String,
    pub name: String,
    pub entries: Vec<LaunchEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchEntry {
    pub node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default)]
    pub remaps: Vec<(String, String)>,
    #[serde(default)]
    pub param_overrides: BTreeMap<String, ParamValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_project_has_schema_v1_and_jazzy() {
        let project = Project::new("demo_ws", "/tmp/demo_ws");
        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.ros_distro, "jazzy");

        let json = serde_json::to_string_pretty(&project).expect("serialize project");
        let parsed: Project = serde_json::from_str(&json).expect("deserialize project");
        assert_eq!(parsed, project);
    }

    #[test]
    fn uuid_v7_ids_are_unique_and_valid() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        let parsed = Uuid::parse_str(&a).expect("valid uuid");
        assert_eq!(parsed.get_version_num(), 7);
    }
}
