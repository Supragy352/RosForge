use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const DEFAULT_ROS_SETUP_PATH: &str = "/opt/ros/jazzy/setup.bash";
pub const DEFAULT_EXTERNAL_EDITOR_COMMAND: &str = "code -g {file}:{line}";
pub const MAX_ROS_DOMAIN_ID: u32 = 232;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("could not resolve user config directory")]
    ConfigDirUnavailable,
    #[error("failed to read settings file '{path}': {source}")]
    ReadFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse settings JSON at '{path}': {source}")]
    ParseFailed {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("failed to write settings file '{path}': {source}")]
    WriteFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid setting: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
}

impl Default for ThemeMode {
    fn default() -> Self {
        Self::Dark
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_ros_setup_path")]
    pub ros_setup_path: String,
    #[serde(default)]
    pub default_workspace: Option<String>,
    #[serde(default)]
    pub default_maintainer_name: String,
    #[serde(default)]
    pub default_maintainer_email: String,
    #[serde(default)]
    pub ros_domain_id: u32,
    #[serde(default = "default_external_editor_command")]
    pub external_editor_command: String,
    #[serde(default = "default_true")]
    pub build_before_run: bool,
    #[serde(default)]
    pub theme: ThemeMode,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
}

fn default_ros_setup_path() -> String {
    DEFAULT_ROS_SETUP_PATH.to_string()
}

fn default_external_editor_command() -> String {
    DEFAULT_EXTERNAL_EDITOR_COMMAND.to_string()
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ros_setup_path: default_ros_setup_path(),
            default_workspace: None,
            default_maintainer_name: String::new(),
            default_maintainer_email: String::new(),
            ros_domain_id: 0,
            external_editor_command: default_external_editor_command(),
            build_before_run: true,
            theme: ThemeMode::Dark,
            recent_workspaces: Vec::new(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), SettingsError> {
        if self.ros_setup_path.trim().is_empty() {
            return Err(SettingsError::Validation(
                "ROS setup path cannot be empty".to_string(),
            ));
        }
        if self.ros_domain_id > MAX_ROS_DOMAIN_ID {
            return Err(SettingsError::Validation(format!(
                "ROS_DOMAIN_ID must be between 0 and {MAX_ROS_DOMAIN_ID}, got {}",
                self.ros_domain_id
            )));
        }
        if self.external_editor_command.trim().is_empty() {
            return Err(SettingsError::Validation(
                "External editor command cannot be empty".to_string(),
            ));
        }
        Ok(())
    }
}

/// Resolves the canonical RosForge settings file path: `~/.config/rosforge/settings.json`
/// (honoring `XDG_CONFIG_HOME` when set on Unix).
pub fn default_settings_path() -> Result<PathBuf, SettingsError> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        let trimmed = xdg.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join("rosforge").join("settings.json"));
        }
    }

    let home = dirs::home_dir().ok_or(SettingsError::ConfigDirUnavailable)?;
    Ok(home.join(".config").join("rosforge").join("settings.json"))
}

#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn from_default_path() -> Result<Self, SettingsError> {
        Ok(Self::new(default_settings_path()?))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Load settings from disk. Returns `Settings::default()` if the file does not exist yet.
    pub fn load(&self) -> Result<Settings, SettingsError> {
        if !self.path.exists() {
            return Ok(Settings::default());
        }

        let raw = fs::read_to_string(&self.path).map_err(|source| SettingsError::ReadFailed {
            path: self.path.display().to_string(),
            source,
        })?;

        let settings: Settings =
            serde_json::from_str(&raw).map_err(|source| SettingsError::ParseFailed {
                path: self.path.display().to_string(),
                source,
            })?;

        Ok(settings)
    }

    /// Validate and atomically save settings as pretty-printed JSON.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        settings.validate()?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|source| SettingsError::WriteFailed {
                path: self.path.display().to_string(),
                source,
            })?;
        }

        let mut serialized =
            serde_json::to_string_pretty(settings).expect("Settings serialization cannot fail");
        serialized.push('\n');

        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, serialized).map_err(|source| SettingsError::WriteFailed {
            path: tmp_path.display().to_string(),
            source,
        })?;

        fs::rename(&tmp_path, &self.path).map_err(|source| SettingsError::WriteFailed {
            path: self.path.display().to_string(),
            source,
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn loads_defaults_when_file_is_missing() {
        let dir = TempDir::new().expect("temp dir");
        let store = SettingsStore::new(dir.path().join("rosforge").join("settings.json"));

        let loaded = store.load().expect("load defaults");
        assert_eq!(loaded, Settings::default());
        assert_eq!(loaded.ros_setup_path, "/opt/ros/jazzy/setup.bash");
        assert_eq!(loaded.external_editor_command, "code -g {file}:{line}");
        assert_eq!(loaded.ros_domain_id, 0);
        assert_eq!(loaded.theme, ThemeMode::Dark);
    }

    #[test]
    fn saves_and_reloads_roundtrip() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("nested").join("settings.json");
        let store = SettingsStore::new(path.clone());

        let mut settings = Settings::default();
        settings.default_workspace = Some("/home/dev/ros2_ws".to_string());
        settings.default_maintainer_name = "Supragy".to_string();
        settings.default_maintainer_email = "dev@example.com".to_string();
        settings.ros_domain_id = 42;
        settings.theme = ThemeMode::Light;

        store.save(&settings).expect("save settings");
        assert!(path.exists());

        let reloaded = store.load().expect("reload settings");
        assert_eq!(reloaded, settings);
    }

    #[test]
    fn rejects_invalid_ros_domain_id() {
        let dir = TempDir::new().expect("temp dir");
        let store = SettingsStore::new(dir.path().join("settings.json"));

        let mut settings = Settings::default();
        settings.ros_domain_id = 300;

        let err = store.save(&settings).expect_err("should fail validation");
        assert!(matches!(err, SettingsError::Validation(_)));
    }

    #[test]
    fn partial_json_fills_missing_fields_with_defaults() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{ "rosDomainId": 7 }"#).expect("write partial json");

        let store = SettingsStore::new(path);
        let loaded = store.load().expect("load partial");
        assert_eq!(loaded.ros_domain_id, 7);
        assert_eq!(loaded.ros_setup_path, DEFAULT_ROS_SETUP_PATH);
        assert_eq!(
            loaded.external_editor_command,
            DEFAULT_EXTERNAL_EDITOR_COMMAND
        );
    }
}
