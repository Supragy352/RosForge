use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use thiserror::Error;
use tokio::process::{Child, Command};

const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Error)]
pub enum RosEnvError {
    #[error("failed to spawn ROS shell command via '{shell}': {source}")]
    SpawnFailed {
        shell: String,
        #[source]
        source: std::io::Error,
    },
    #[error("ROS command timed out after {0}s")]
    TimedOut(u64),
    #[error("failed waiting for ROS command: {0}")]
    WaitFailed(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosEnvConfig {
    pub ros_setup_path: PathBuf,
    pub workspace_path: Option<PathBuf>,
    pub ros_domain_id: u32,
}

impl RosEnvConfig {
    pub fn from_settings(settings: &Settings, workspace_path: Option<PathBuf>) -> Self {
        Self {
            ros_setup_path: PathBuf::from(&settings.ros_setup_path),
            workspace_path: workspace_path.or_else(|| {
                settings
                    .default_workspace
                    .as_ref()
                    .filter(|s| !s.trim().is_empty())
                    .map(PathBuf::from)
            }),
            ros_domain_id: settings.ros_domain_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RosHealthStatus {
    pub available: bool,
    pub ros_setup_path: String,
    pub ros_domain_id: u32,
    pub ros_distro: Option<String>,
    pub message: String,
    pub detail: Option<String>,
}

/// Safely quote a path or string for POSIX/bash `source` invocations.
pub fn shell_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

/// Build the `bash -lc` command script that sources ROS 2, optionally sources
/// `<workspace>/install/setup.bash` if present, and runs `cmd`.
pub fn build_ros_shell_script(config: &RosEnvConfig, cmd: &str) -> String {
    let ros_setup = shell_quote(&config.ros_setup_path.to_string_lossy());
    match &config.workspace_path {
        Some(ws) => {
            let ws_setup = ws.join("install").join("setup.bash");
            let ws_setup_quoted = shell_quote(&ws_setup.to_string_lossy());
            format!(
                "source {ros_setup} && if [ -f {ws_setup_quoted} ]; then source {ws_setup_quoted}; fi && {cmd}"
            )
        }
        None => format!("source {ros_setup} && {cmd}"),
    }
}

/// Trait boundary prepared for future WSL backend (`wsl -d <distro> -- bash -lc`)
/// without leaking shell details into callers (see SPEC.md "Later").
pub trait RosEnvRunner: Send + Sync {
    fn spawn_in_ros(
        &self,
        config: &RosEnvConfig,
        cmd: &str,
        cwd: Option<&Path>,
    ) -> Result<Child, RosEnvError>;
}

/// Default Linux/WSLg runner that executes commands via `bash -lc`.
#[derive(Debug, Default, Clone, Copy)]
pub struct LocalBashRosEnv;

impl RosEnvRunner for LocalBashRosEnv {
    fn spawn_in_ros(
        &self,
        config: &RosEnvConfig,
        cmd: &str,
        cwd: Option<&Path>,
    ) -> Result<Child, RosEnvError> {
        let script = build_ros_shell_script(config, cmd);

        let mut command = Command::new("bash");
        command
            .arg("-lc")
            .arg(&script)
            .env("ROS_DOMAIN_ID", config.ros_domain_id.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(dir) = cwd {
            command.current_dir(dir);
        }

        command.spawn().map_err(|source| RosEnvError::SpawnFailed {
            shell: "bash".to_string(),
            source,
        })
    }
}

/// Convenience entry point matching SPEC F0.4 (`run_in_ros(cmd, cwd) -> Child`).
pub fn run_in_ros(
    config: &RosEnvConfig,
    cmd: &str,
    cwd: Option<&Path>,
) -> Result<Child, RosEnvError> {
    LocalBashRosEnv.spawn_in_ros(config, cmd, cwd)
}

/// Spawn a long-running ROS 2 command (such as `colcon build`, `ros2 run`, or `ros2 launch`)
/// inside its own process group so stopping/canceling can cleanly send SIGINT to the whole tree.
pub fn spawn_in_ros_process_group(
    config: &RosEnvConfig,
    cmd: &str,
    cwd: Option<&Path>,
) -> Result<Child, RosEnvError> {
    let script = build_ros_shell_script(config, cmd);

    let mut command = Command::new("bash");
    command
        .arg("-lc")
        .arg(&script)
        .env("ROS_DOMAIN_ID", config.ros_domain_id.to_string())
        .env("PYTHONUNBUFFERED", "1")
        .env("RCUTILS_COLORIZED_OUTPUT", "1")
        .env("CLICOLOR_FORCE", "1")
        .env("FORCE_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    #[cfg(unix)]
    {
        command.process_group(0);
    }

    command.spawn().map_err(|source| RosEnvError::SpawnFailed {
        shell: "bash".to_string(),
        source,
    })
}

/// Send a POSIX signal (`INT`, `TERM`, or `KILL`) to a process group led by `pid`.
pub fn signal_process_group(pid: u32, signal: &str) {
    #[cfg(unix)]
    {
        let pgid_arg = format!("-{pid}");
        let _ = std::process::Command::new("kill")
            .arg(format!("-{signal}"))
            .arg(&pgid_arg)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
    }
}

/// Startup health check: verifies the configured ROS setup script and runs `ros2 --help`.
pub async fn check_ros_health(config: &RosEnvConfig) -> RosHealthStatus {
    let setup_display = config.ros_setup_path.display().to_string();

    if cfg!(unix) && !config.ros_setup_path.exists() {
        return RosHealthStatus {
            available: false,
            ros_setup_path: setup_display.clone(),
            ros_domain_id: config.ros_domain_id,
            ros_distro: None,
            message: format!("ROS 2 setup file not found at '{setup_display}'."),
            detail: Some(
                "Check your ROS setup path in Settings (default: /opt/ros/jazzy/setup.bash)."
                    .to_string(),
            ),
        };
    }

    let child = match run_in_ros(
        config,
        "printf 'ROS_DISTRO=%s\\n' \"${ROS_DISTRO:-}\" && ros2 --help",
        None,
    ) {
        Ok(child) => child,
        Err(err) => {
            return RosHealthStatus {
                available: false,
                ros_setup_path: setup_display,
                ros_domain_id: config.ros_domain_id,
                ros_distro: None,
                message: "Unable to run ROS 2 shell environment.".to_string(),
                detail: Some(err.to_string()),
            };
        }
    };

    let output = match tokio::time::timeout(HEALTH_CHECK_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return RosHealthStatus {
                available: false,
                ros_setup_path: setup_display,
                ros_domain_id: config.ros_domain_id,
                ros_distro: None,
                message: "Failed while running `ros2 --help`.".to_string(),
                detail: Some(err.to_string()),
            };
        }
        Err(_) => {
            return RosHealthStatus {
                available: false,
                ros_setup_path: setup_display,
                ros_domain_id: config.ros_domain_id,
                ros_distro: None,
                message: format!(
                    "ROS 2 health check timed out after {}s.",
                    HEALTH_CHECK_TIMEOUT.as_secs()
                ),
                detail: None,
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let ros_distro = stdout
        .lines()
        .find_map(|line| line.strip_prefix("ROS_DISTRO="))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if output.status.success() {
        let message = format!(
            "ROS 2 ({}) is ready.",
            ros_distro.as_deref().unwrap_or("unknown")
        );
        RosHealthStatus {
            available: true,
            ros_setup_path: setup_display,
            ros_domain_id: config.ros_domain_id,
            ros_distro,
            message,
            detail: None,
        }
    } else {
        let detail = if !stderr.trim().is_empty() {
            Some(stderr.trim().to_string())
        } else if !stdout.trim().is_empty() {
            Some(stdout.trim().to_string())
        } else {
            Some(format!("Process exited with status {}", output.status))
        };

        RosHealthStatus {
            available: false,
            ros_setup_path: setup_display,
            ros_domain_id: config.ros_domain_id,
            ros_distro,
            message: "ROS 2 environment check failed (`ros2 --help` did not succeed).".to_string(),
            detail,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_script_without_workspace() {
        let cfg = RosEnvConfig {
            ros_setup_path: PathBuf::from("/opt/ros/jazzy/setup.bash"),
            workspace_path: None,
            ros_domain_id: 0,
        };
        let script = build_ros_shell_script(&cfg, "ros2 --help");
        assert_eq!(
            script,
            "source '/opt/ros/jazzy/setup.bash' && ros2 --help"
        );
    }

    #[test]
    fn builds_script_with_workspace_and_escaping() {
        let cfg = RosEnvConfig {
            ros_setup_path: PathBuf::from("/opt/ros/jazzy/setup.bash"),
            workspace_path: Some(PathBuf::from("/home/user/my 'ros' ws")),
            ros_domain_id: 5,
        };
        let script = build_ros_shell_script(&cfg, "colcon build");
        assert!(script.starts_with("source '/opt/ros/jazzy/setup.bash' && if [ -f "));
        assert!(script.contains("my '\"'\"'ros'\"'\"' ws"));
        assert!(script.ends_with("&& colcon build"));
    }

    #[tokio::test]
    async fn health_check_reports_unavailable_for_missing_setup_path() {
        let cfg = RosEnvConfig {
            ros_setup_path: PathBuf::from("/nonexistent/rosforge/test/setup.bash"),
            workspace_path: None,
            ros_domain_id: 0,
        };
        let status = check_ros_health(&cfg).await;
        assert!(!status.available);
        assert_eq!(status.ros_setup_path, "/nonexistent/rosforge/test/setup.bash");
    }

    #[tokio::test]
    async fn health_check_succeeds_when_jazzy_is_installed() {
        let setup_path = PathBuf::from("/opt/ros/jazzy/setup.bash");
        if !setup_path.exists() {
            return;
        }
        let cfg = RosEnvConfig {
            ros_setup_path: setup_path,
            workspace_path: None,
            ros_domain_id: 0,
        };
        let status = check_ros_health(&cfg).await;
        assert!(status.available, "expected ROS 2 Jazzy to be ready: {status:?}");
        assert_eq!(status.ros_distro.as_deref(), Some("jazzy"));
    }
}
