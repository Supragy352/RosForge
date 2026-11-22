use crate::model::{Diagnostic, DiagnosticSeverity};
use crate::ros_env::{shell_quote, signal_process_group, spawn_in_ros_process_group, RosEnvConfig};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;
use uuid::Uuid;

pub const EVENT_BUILD_OUTPUT: &str = "rosforge:build-output";
pub const EVENT_BUILD_FINISHED: &str = "rosforge:build-finished";
pub const EVENT_RUN_OUTPUT: &str = "rosforge:run-output";
pub const EVENT_RUN_EXITED: &str = "rosforge:run-exited";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BuildMode {
    Project,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub workspace_path: String,
    pub mode: BuildMode,
    pub packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanRequest {
    pub workspace_path: String,
    pub packages: Vec<String>,
    pub clean_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub removed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildStartResponse {
    pub build_id: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildOutputEvent {
    pub build_id: String,
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildFinishedEvent {
    pub build_id: String,
    pub success: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: u32,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLaunchTarget {
    pub package_name: String,
    pub launch_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunTarget {
    #[serde(rename_all = "camelCase")]
    PackageLaunch {
        package_name: String,
        launch_file: String,
        node_ids: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    SingleNode {
        package_name: String,
        executable: String,
        node_id: String,
        node_name: String,
    },
    #[serde(rename_all = "camelCase")]
    WholeProject {
        packages: Vec<ProjectLaunchTarget>,
        node_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub workspace_path: String,
    pub label: String,
    pub target: RunTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunStartResponse {
    pub run_id: String,
    pub label: String,
    pub command: String,
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunOutputEvent {
    pub run_id: String,
    pub stream: String,
    pub line: String,
    pub node_prefix: Option<String>,
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunExitedEvent {
    pub run_id: String,
    pub stopped: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    pub building: bool,
    pub active_build_id: Option<String>,
    pub active_runs: Vec<RunStartResponse>,
}

struct ActiveBuild {
    id: String,
    pid: Option<u32>,
    cancelled: Arc<AtomicBool>,
    stop_tx: Option<oneshot::Sender<()>>,
}

struct ActiveRun {
    meta: RunStartResponse,
    pid: Option<u32>,
    stopped: Arc<AtomicBool>,
    stop_tx: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
struct RunnerInner {
    active_build: Option<ActiveBuild>,
    active_runs: HashMap<String, ActiveRun>,
}

#[derive(Clone, Default)]
pub struct RunnerManager {
    inner: Arc<Mutex<RunnerInner>>,
}

impl RunnerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> RunnerStatus {
        let guard = self.inner.lock().expect("runner lock poisoned");
        RunnerStatus {
            building: guard.active_build.is_some(),
            active_build_id: guard.active_build.as_ref().map(|b| b.id.clone()),
            active_runs: guard
                .active_runs
                .values()
                .map(|r| r.meta.clone())
                .collect(),
        }
    }

    pub fn is_building(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.active_build.is_some())
            .unwrap_or(false)
    }

    pub fn start_build(
        &self,
        app: AppHandle,
        config: RosEnvConfig,
        req: BuildRequest,
    ) -> Result<BuildStartResponse, String> {
        let ws = PathBuf::from(req.workspace_path.trim());
        if !ws.exists() {
            return Err(format!("Workspace path does not exist: {}", ws.display()));
        }

        let cmd = build_colcon_command(&req)?;
        let build_id = Uuid::now_v7().to_string();

        {
            let guard = self
                .inner
                .lock()
                .map_err(|_| "runner lock poisoned".to_string())?;
            if guard.active_build.is_some() {
                return Err("A build is already in progress.".to_string());
            }
        }

        let mut child = spawn_in_ros_process_group(&config, &cmd, Some(&ws))
            .map_err(|e| format!("Failed to start colcon build: {e}"))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let cancelled = Arc::new(AtomicBool::new(false));

        {
            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "runner lock poisoned".to_string())?;
            if guard.active_build.is_some() {
                if let Some(p) = pid {
                    signal_process_group(p, "KILL");
                }
                return Err("A build is already in progress.".to_string());
            }
            guard.active_build = Some(ActiveBuild {
                id: build_id.clone(),
                pid,
                cancelled: Arc::clone(&cancelled),
                stop_tx: Some(stop_tx),
            });
        }

        let manager = self.clone();
        let bid = build_id.clone();
        let ws_clone = ws.clone();

        tauri::async_runtime::spawn(async move {
            let started = Instant::now();
            let collected_lines = Arc::new(Mutex::new(Vec::<String>::new()));

            let out_handle = stdout.map(|out| {
                let app_out = app.clone();
                let bid_out = bid.clone();
                let lines_out = Arc::clone(&collected_lines);
                tauri::async_runtime::spawn(async move {
                    let mut reader = BufReader::new(out).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        if let Ok(mut buf) = lines_out.lock() {
                            if buf.len() < 8000 {
                                buf.push(line.clone());
                            }
                        }
                        let _ = app_out.emit(
                            EVENT_BUILD_OUTPUT,
                            BuildOutputEvent {
                                build_id: bid_out.clone(),
                                stream: "stdout".to_string(),
                                line,
                            },
                        );
                    }
                })
            });

            let err_handle = stderr.map(|err| {
                let app_err = app.clone();
                let bid_err = bid.clone();
                let lines_err = Arc::clone(&collected_lines);
                tauri::async_runtime::spawn(async move {
                    let mut reader = BufReader::new(err).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        if let Ok(mut buf) = lines_err.lock() {
                            if buf.len() < 8000 {
                                buf.push(line.clone());
                            }
                        }
                        let _ = app_err.emit(
                            EVENT_BUILD_OUTPUT,
                            BuildOutputEvent {
                                build_id: bid_err.clone(),
                                stream: "stderr".to_string(),
                                line,
                            },
                        );
                    }
                })
            });

            let status = tokio::select! {
                res = child.wait() => res.ok(),
                _ = &mut stop_rx => {
                    if let Some(p) = pid {
                        signal_process_group(p, "INT");
                    }
                    match tokio::time::timeout(Duration::from_millis(2500), child.wait()).await {
                        Ok(res) => res.ok(),
                        Err(_) => {
                            if let Some(p) = pid {
                                signal_process_group(p, "TERM");
                            }
                            let _ = child.kill().await;
                            child.wait().await.ok()
                        }
                    }
                }
            };

            if let Some(h) = out_handle {
                let _ = h.await;
            }
            if let Some(h) = err_handle {
                let _ = h.await;
            }

            if let Ok(mut guard) = manager.inner.lock() {
                if guard.active_build.as_ref().map(|b| b.id.as_str()) == Some(bid.as_str()) {
                    guard.active_build = None;
                }
            }

            let was_cancelled = cancelled.load(Ordering::SeqCst);
            let exit_code = status.and_then(|s| s.code());
            let success = !was_cancelled && status.map(|s| s.success()).unwrap_or(false);
            let lines = collected_lines
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();
            let diagnostics = parse_build_diagnostics(&lines, &ws_clone);

            let duration_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
            let _ = app.emit(
                EVENT_BUILD_FINISHED,
                BuildFinishedEvent {
                    build_id: bid,
                    success,
                    cancelled: was_cancelled,
                    exit_code,
                    duration_ms,
                    diagnostics,
                },
            );
        });

        Ok(BuildStartResponse {
            build_id,
            command: cmd,
        })
    }

    pub fn cancel_build(&self) -> Result<bool, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "runner lock poisoned".to_string())?;
        let Some(active) = guard.active_build.as_mut() else {
            return Ok(false);
        };
        active.cancelled.store(true, Ordering::SeqCst);
        if let Some(pid) = active.pid {
            signal_process_group(pid, "INT");
        }
        if let Some(tx) = active.stop_tx.take() {
            let _ = tx.send(());
        }
        Ok(true)
    }

    pub fn clean_workspace(&self, req: CleanRequest) -> Result<CleanResult, String> {
        if self.is_building() {
            return Err("Cannot clean workspace while a build is in progress.".to_string());
        }
        let ws = PathBuf::from(req.workspace_path.trim());
        if !ws.exists() {
            return Err(format!("Workspace path does not exist: {}", ws.display()));
        }

        let mut removed = Vec::new();
        if req.clean_all || req.packages.is_empty() {
            for dir_name in ["build", "install", "log"] {
                let target = ws.join(dir_name);
                if target.exists() {
                    fs::remove_dir_all(&target)
                        .map_err(|e| format!("Failed removing {}: {e}", target.display()))?;
                    removed.push(target.display().to_string());
                }
            }
        } else {
            for pkg in &req.packages {
                let pkg_trimmed = pkg.trim();
                if pkg_trimmed.is_empty()
                    || pkg_trimmed.contains('/')
                    || pkg_trimmed.contains('\\')
                    || pkg_trimmed.contains("..")
                {
                    return Err(format!("Unsafe package name for clean: '{pkg}'"));
                }
                for root in ["build", "install"] {
                    let target = ws.join(root).join(pkg_trimmed);
                    if target.exists() {
                        fs::remove_dir_all(&target)
                            .map_err(|e| format!("Failed removing {}: {e}", target.display()))?;
                        removed.push(target.display().to_string());
                    }
                }
            }
            let log_dir = ws.join("log");
            if log_dir.exists() {
                fs::remove_dir_all(&log_dir)
                    .map_err(|e| format!("Failed removing {}: {e}", log_dir.display()))?;
                removed.push(log_dir.display().to_string());
            }
        }

        Ok(CleanResult {
            removed_paths: removed,
        })
    }

    pub fn start_run(
        &self,
        app: AppHandle,
        config: RosEnvConfig,
        req: RunRequest,
    ) -> Result<RunStartResponse, String> {
        if self.is_building() {
            return Err("Cannot start a run while a build is in progress.".to_string());
        }

        let ws = PathBuf::from(req.workspace_path.trim());
        if !ws.exists() {
            return Err(format!("Workspace path does not exist: {}", ws.display()));
        }

        let (cmd, node_ids, fallback_prefix) = match &req.target {
            RunTarget::PackageLaunch {
                package_name,
                launch_file,
                node_ids,
            } => {
                let cmd = format!(
                    "ros2 launch {} {}",
                    shell_quote(package_name),
                    shell_quote(launch_file)
                );
                (cmd, node_ids.clone(), None)
            }
            RunTarget::SingleNode {
                package_name,
                executable,
                node_id,
                node_name,
            } => {
                let cmd = format!(
                    "ros2 run {} {}",
                    shell_quote(package_name),
                    shell_quote(executable)
                );
                (cmd, vec![node_id.clone()], Some(node_name.clone()))
            }
            RunTarget::WholeProject { packages, node_ids } => {
                if packages.is_empty() {
                    return Err("Project has no packages with launch files to run.".to_string());
                }
                let launch_path = write_aggregated_launch_file(&ws, packages)?;
                let cmd = format!("ros2 launch {}", shell_quote(&launch_path.to_string_lossy()));
                (cmd, node_ids.clone(), None)
            }
        };

        let mut child = spawn_in_ros_process_group(&config, &cmd, Some(&ws))
            .map_err(|e| format!("Failed to start ROS 2 run: {e}"))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let run_id = Uuid::now_v7().to_string();
        let meta = RunStartResponse {
            run_id: run_id.clone(),
            label: req.label,
            command: cmd,
            node_ids,
        };

        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let stopped = Arc::new(AtomicBool::new(false));

        {
            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "runner lock poisoned".to_string())?;
            guard.active_runs.insert(
                run_id.clone(),
                ActiveRun {
                    meta: meta.clone(),
                    pid,
                    stopped: Arc::clone(&stopped),
                    stop_tx: Some(stop_tx),
                },
            );
        }

        let manager = self.clone();
        let rid = run_id.clone();

        tauri::async_runtime::spawn(async move {
            let out_handle = stdout.map(|out| {
                let app_out = app.clone();
                let rid_out = rid.clone();
                let fp = fallback_prefix.clone();
                tauri::async_runtime::spawn(async move {
                    let mut reader = BufReader::new(out).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        let (parsed_prefix, level) = extract_run_line_meta(&line);
                        let _ = app_out.emit(
                            EVENT_RUN_OUTPUT,
                            RunOutputEvent {
                                run_id: rid_out.clone(),
                                stream: "stdout".to_string(),
                                line,
                                node_prefix: parsed_prefix.or_else(|| fp.clone()),
                                level,
                            },
                        );
                    }
                })
            });

            let err_handle = stderr.map(|err| {
                let app_err = app.clone();
                let rid_err = rid.clone();
                let fp = fallback_prefix.clone();
                tauri::async_runtime::spawn(async move {
                    let mut reader = BufReader::new(err).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        let (parsed_prefix, level) = extract_run_line_meta(&line);
                        let _ = app_err.emit(
                            EVENT_RUN_OUTPUT,
                            RunOutputEvent {
                                run_id: rid_err.clone(),
                                stream: "stderr".to_string(),
                                line,
                                node_prefix: parsed_prefix.or_else(|| fp.clone()),
                                level,
                            },
                        );
                    }
                })
            });

            let status = tokio::select! {
                res = child.wait() => res.ok(),
                _ = &mut stop_rx => {
                    if let Some(p) = pid {
                        signal_process_group(p, "INT");
                    }
                    match tokio::time::timeout(Duration::from_millis(2500), child.wait()).await {
                        Ok(res) => res.ok(),
                        Err(_) => {
                            if let Some(p) = pid {
                                signal_process_group(p, "TERM");
                            }
                            let _ = child.kill().await;
                            child.wait().await.ok()
                        }
                    }
                }
            };

            if let Some(h) = out_handle {
                let _ = h.await;
            }
            if let Some(h) = err_handle {
                let _ = h.await;
            }

            if let Ok(mut guard) = manager.inner.lock() {
                guard.active_runs.remove(&rid);
            }

            let _ = app.emit(
                EVENT_RUN_EXITED,
                RunExitedEvent {
                    run_id: rid,
                    stopped: stopped.load(Ordering::SeqCst),
                    exit_code: status.and_then(|s| s.code()),
                },
            );
        });

        Ok(meta)
    }

    pub fn stop_run(&self, run_id: &str) -> Result<bool, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "runner lock poisoned".to_string())?;
        let Some(active) = guard.active_runs.get_mut(run_id) else {
            return Ok(false);
        };
        active.stopped.store(true, Ordering::SeqCst);
        if let Some(pid) = active.pid {
            signal_process_group(pid, "INT");
        }
        if let Some(tx) = active.stop_tx.take() {
            let _ = tx.send(());
        }
        Ok(true)
    }

    pub fn stop_all(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(active) = guard.active_build.as_mut() {
                active.cancelled.store(true, Ordering::SeqCst);
                if let Some(pid) = active.pid {
                    signal_process_group(pid, "INT");
                }
                if let Some(tx) = active.stop_tx.take() {
                    let _ = tx.send(());
                }
            }
            for active in guard.active_runs.values_mut() {
                active.stopped.store(true, Ordering::SeqCst);
                if let Some(pid) = active.pid {
                    signal_process_group(pid, "INT");
                }
                if let Some(tx) = active.stop_tx.take() {
                    let _ = tx.send(());
                }
            }
        }
    }
}

pub fn build_colcon_command(req: &BuildRequest) -> Result<String, String> {
    match req.mode {
        BuildMode::All => Ok("colcon build --symlink-install".to_string()),
        BuildMode::Project => {
            if req.packages.is_empty() {
                return Err("Project has no packages to build.".to_string());
            }
            let quoted: Vec<String> = req.packages.iter().map(|p| shell_quote(p)).collect();
            Ok(format!(
                "colcon build --symlink-install --packages-select {}",
                quoted.join(" ")
            ))
        }
    }
}

pub fn write_aggregated_launch_file(
    workspace_path: &Path,
    packages: &[ProjectLaunchTarget],
) -> Result<PathBuf, String> {
    let dir = workspace_path.join(".rosforge");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed creating {}: {e}", dir.display()))?;
    let path = dir.join("run_all.launch.py");

    let mut content = String::new();
    content.push_str("# Auto-generated temporary aggregated launch file by RosForge.\n");
    content.push_str("import os\n");
    content.push_str("from ament_index_python.packages import get_package_share_directory\n");
    content.push_str("from launch import LaunchDescription\n");
    content.push_str("from launch.actions import IncludeLaunchDescription\n");
    content.push_str("from launch.launch_description_sources import PythonLaunchDescriptionSource\n\n\n");
    content.push_str("def generate_launch_description():\n");
    content.push_str("    return LaunchDescription([\n");
    for target in packages {
        let pkg = target.package_name.replace('\'', "\\'");
        let lf = target.launch_file.replace('\'', "\\'");
        content.push_str("        IncludeLaunchDescription(\n");
        content.push_str("            PythonLaunchDescriptionSource(\n");
        content.push_str(&format!(
            "                os.path.join(get_package_share_directory('{pkg}'), 'launch', '{lf}')\n"
        ));
        content.push_str("            )\n");
        content.push_str("        ),\n");
    }
    content.push_str("    ])\n");

    fs::write(&path, content)
        .map_err(|e| format!("Failed writing {}: {e}", path.display()))?;
    Ok(path)
}

/// Launch the configured external editor (default `code -g {file}:{line}`) detached.
pub fn open_in_external_editor(
    editor_command: &str,
    file: &str,
    line: Option<u32>,
) -> Result<(), String> {
    let trimmed = editor_command.trim();
    if trimmed.is_empty() {
        return Err("External editor command is empty in Settings.".to_string());
    }
    let line_str = line.unwrap_or(1).max(1).to_string();

    let expanded = if trimmed.contains("{file}") {
        trimmed
            .replace("{file}", &shell_quote(file))
            .replace("{line}", &line_str)
    } else {
        format!("{trimmed} {}", shell_quote(file))
    };

    #[cfg(unix)]
    {
        std::process::Command::new("bash")
            .arg("-lc")
            .arg(&expanded)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed launching editor command '{expanded}': {e}"))?;
    }
    #[cfg(not(unix))]
    {
        std::process::Command::new("cmd")
            .arg("/C")
            .arg(&expanded)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed launching editor command '{expanded}': {e}"))?;
    }
    Ok(())
}

/// Strip ANSI CSI escape sequences so parsers operate on plain text.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if matches!(chars.peek(), Some('[')) {
                let _ = chars.next();
                for nc in chars.by_ref() {
                    if ('@'..='~').contains(&nc) {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

fn resolve_file_path(raw: &str, workspace_path: &Path) -> String {
    let p = Path::new(raw.trim());
    if p.is_absolute() {
        p.to_string_lossy().to_string()
    } else {
        workspace_path.join(p).to_string_lossy().to_string()
    }
}

fn push_unique_diag(
    diagnostics: &mut Vec<Diagnostic>,
    seen: &mut HashSet<(String, Option<String>, Option<u32>)>,
    severity: DiagnosticSeverity,
    message: String,
    file: Option<String>,
    line: Option<u32>,
) {
    let key = (message.clone(), file.clone(), line);
    if seen.insert(key) {
        diagnostics.push(Diagnostic {
            severity,
            message,
            target_id: None,
            file,
            line,
        });
    }
}

/// Parse GCC/Clang, CMake, Python traceback, and setuptools/colcon errors into Diagnostics.
pub fn parse_build_diagnostics(lines: &[String], workspace_path: &Path) -> Vec<Diagnostic> {
    let clean: Vec<String> = lines.iter().map(|l| strip_ansi(l)).collect();
    let mut diagnostics = Vec::new();
    let mut seen = HashSet::<(String, Option<String>, Option<u32>)>::new();

    let mut i = 0;
    while i < clean.len() {
        let line = clean[i].trim();

        // 1. GCC / Clang: /path/to/file.cpp:42:13: error: expected ';'
        if let Some((file, line_no, sev, msg)) = parse_gcc_clang_line(line) {
            let resolved = resolve_file_path(&file, workspace_path);
            push_unique_diag(
                &mut diagnostics,
                &mut seen,
                sev,
                msg,
                Some(resolved),
                Some(line_no),
            );
            i += 1;
            continue;
        }

        // 2. CMake Error at CMakeLists.txt:25 (find_package):
        if let Some((file, line_no, header)) = parse_cmake_error_line(line) {
            let mut detail = String::new();
            let mut j = i + 1;
            while j < clean.len() && j <= i + 4 {
                let next_l = clean[j].trim();
                if next_l.is_empty() {
                    if !detail.is_empty() {
                        break;
                    }
                    j += 1;
                    continue;
                }
                if !detail.is_empty() {
                    detail.push(' ');
                }
                detail.push_str(next_l);
                if detail.len() > 180 {
                    break;
                }
                j += 1;
            }
            let message = if detail.is_empty() {
                header
            } else {
                format!("{header} {detail}")
            };
            let resolved = resolve_file_path(&file, workspace_path);
            push_unique_diag(
                &mut diagnostics,
                &mut seen,
                DiagnosticSeverity::Error,
                message,
                Some(resolved),
                Some(line_no),
            );
            i += 1;
            continue;
        }

        // 3. Python traceback: File "/path/to/node.py", line 18, in <module>
        if let Some((file, line_no)) = parse_python_traceback_line(line) {
            let mut exc_msg = None;
            for lookahead in &clean[i + 1..(i + 6).min(clean.len())] {
                let t = lookahead.trim();
                if t.starts_with("File \"") {
                    break;
                }
                if is_python_exception_line(t) {
                    exc_msg = Some(t.to_string());
                    break;
                }
            }
            if let Some(exc) = exc_msg {
                let resolved = resolve_file_path(&file, workspace_path);
                push_unique_diag(
                    &mut diagnostics,
                    &mut seen,
                    DiagnosticSeverity::Error,
                    format!("Python: {exc}"),
                    Some(resolved),
                    Some(line_no),
                );
            }
            i += 1;
            continue;
        }

        // 4. setuptools / setup.py / colcon package failure
        if line.starts_with("error in ") && line.contains("setup command:") {
            push_unique_diag(
                &mut diagnostics,
                &mut seen,
                DiagnosticSeverity::Error,
                format!("setuptools: {line}"),
                None,
                None,
            );
        } else if let Some(rest) = line.strip_prefix("Failed   <<< ") {
            let pkg_name = rest.split_whitespace().next().unwrap_or(rest);
            let has_specific_for_pkg = diagnostics.iter().any(|d| {
                d.severity == DiagnosticSeverity::Error
                    && d.file
                        .as_deref()
                        .map(|f| f.contains(pkg_name))
                        .unwrap_or(false)
            });
            if !has_specific_for_pkg {
                push_unique_diag(
                    &mut diagnostics,
                    &mut seen,
                    DiagnosticSeverity::Error,
                    format!("colcon build failed for package '{pkg_name}' ({rest})"),
                    None,
                    None,
                );
            }
        }

        i += 1;
    }

    diagnostics
}

fn parse_gcc_clang_line(line: &str) -> Option<(String, u32, DiagnosticSeverity, String)> {
    // Find severity marker first for robustness with Windows/Unix paths
    let (marker_idx, severity, marker_len) = [
        (": fatal error: ", DiagnosticSeverity::Error),
        (": error: ", DiagnosticSeverity::Error),
        (": warning: ", DiagnosticSeverity::Warning),
    ]
    .into_iter()
    .filter_map(|(m, sev)| line.find(m).map(|idx| (idx, sev, m.len())))
    .min_by_key(|(idx, _, _)| *idx)?;

    let loc = &line[..marker_idx];
    let msg = line[marker_idx + marker_len..].trim().to_string();
    if msg.is_empty() {
        return None;
    }

    // Parse `<file>:<line>:<col>` or `<file>:<line>` from the right
    let (before_last, last_seg) = loc.rsplit_once(':')?;
    let last_num = last_seg.trim().parse::<u32>().ok()?;
    let (file, line_no) = if let Some((f_part, mid_seg)) = before_last.rsplit_once(':') {
        if let Ok(mid_num) = mid_seg.trim().parse::<u32>() {
            (f_part, mid_num)
        } else {
            (before_last, last_num)
        }
    } else {
        (before_last, last_num)
    };

    let file_trimmed = file.trim();
    if file_trimmed.is_empty() || file_trimmed.starts_with("http") {
        return None;
    }
    Some((file_trimmed.to_string(), line_no, severity, msg))
}

fn parse_cmake_error_line(line: &str) -> Option<(String, u32, String)> {
    let rest = line.strip_prefix("CMake Error at ")?;
    let loc_end = rest.find(' ').unwrap_or(rest.len());
    let loc = rest[..loc_end].trim_end_matches(':');
    let (file, line_str) = loc.rsplit_once(':')?;
    let line_no = line_str.parse::<u32>().ok()?;
    Some((file.trim().to_string(), line_no, line.to_string()))
}

fn parse_python_traceback_line(line: &str) -> Option<(String, u32)> {
    let rest = line.strip_prefix("File \"")?;
    let quote_end = rest.find('"')?;
    let file = &rest[..quote_end];
    let after = &rest[quote_end + 1..];
    let line_idx = after.find("line ")?;
    let num_str: String = after[line_idx + 5..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let line_no = num_str.parse::<u32>().ok()?;
    Some((file.to_string(), line_no))
}

fn is_python_exception_line(line: &str) -> bool {
    let Some((prefix, _)) = line.split_once(':') else {
        return false;
    };
    !prefix.is_empty()
        && !prefix.contains(' ')
        && (prefix.ends_with("Error") || prefix.ends_with("Exception") || prefix == "SyntaxWarning")
}

/// Extract ROS 2 launch node prefix (e.g. `talker-1`) and log level (`INFO`, `WARN`, `ERROR`, `DEBUG`, `FATAL`).
pub fn extract_run_line_meta(line: &str) -> (Option<String>, Option<String>) {
    let clean = strip_ansi(line);
    let trimmed = clean.trim_start();
    let mut node_prefix: Option<String> = None;
    let mut rest = trimmed;

    if let Some(after_open) = rest.strip_prefix('[') {
        if let Some(close_idx) = after_open.find(']') {
            let token = after_open[..close_idx].trim();
            if !token.is_empty() && !is_log_level_token(token) {
                node_prefix = Some(token.to_string());
                rest = after_open[close_idx + 1..].trim_start();
            }
        }
    }

    let level = ["FATAL", "ERROR", "WARN", "INFO", "DEBUG"]
        .into_iter()
        .find(|lvl| rest.contains(&format!("[{lvl}]")) || trimmed.contains(&format!("[{lvl}]")))
        .map(str::to_string);

    (node_prefix, level)
}

fn is_log_level_token(tok: &str) -> bool {
    matches!(tok, "DEBUG" | "INFO" | "WARN" | "WARNING" | "ERROR" | "FATAL")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gcc_cmake_python_and_colcon_errors() {
        let ws = Path::new("/tmp/test_ws");
        let lines = vec![
            "\x1b[31m/tmp/test_ws/src/cpp_pkg/src/listener.cpp:42:13: error: expected ';' before '}' token\x1b[0m".to_string(),
            "src/cpp_pkg/src/listener.cpp:10:5: warning: unused variable 'x'".to_string(),
            "CMake Error at CMakeLists.txt:15 (find_package):".to_string(),
            "  Could not find a package configuration file provided by \"missing_msgs\"".to_string(),
            "  File \"/tmp/test_ws/src/py_pkg/py_pkg/talker.py\", line 27, in <module>".to_string(),
            "    foo(bar".to_string(),
            "SyntaxError: '(' was never closed".to_string(),
            "error in py_pkg setup command: 'entry_points' must be a dict".to_string(),
            "Failed   <<< other_pkg [0.42s, exited with code 1]".to_string(),
        ];

        let diags = parse_build_diagnostics(&lines, ws);
        assert_eq!(diags.len(), 6);

        assert_eq!(diags[0].severity, DiagnosticSeverity::Error);
        assert_eq!(
            diags[0].file.as_deref(),
            Some("/tmp/test_ws/src/cpp_pkg/src/listener.cpp")
        );
        assert_eq!(diags[0].line, Some(42));
        assert!(diags[0].message.contains("expected ';'"));

        assert_eq!(diags[1].severity, DiagnosticSeverity::Warning);
        assert_eq!(diags[1].line, Some(10));

        assert_eq!(diags[2].severity, DiagnosticSeverity::Error);
        assert_eq!(diags[2].line, Some(15));
        assert!(diags[2].message.contains("missing_msgs"));

        assert_eq!(diags[3].severity, DiagnosticSeverity::Error);
        assert_eq!(
            diags[3].file.as_deref(),
            Some("/tmp/test_ws/src/py_pkg/py_pkg/talker.py")
        );
        assert_eq!(diags[3].line, Some(27));
        assert!(diags[3].message.contains("SyntaxError"));

        assert!(diags[4].message.contains("setuptools"));
        assert!(diags[5].message.contains("other_pkg"));
    }

    #[test]
    fn extracts_run_prefix_and_log_level() {
        let (p1, l1) = extract_run_line_meta("\x1b[32m[talker-1]\x1b[0m [INFO] [1700.12] [talker]: hi");
        assert_eq!(p1.as_deref(), Some("talker-1"));
        assert_eq!(l1.as_deref(), Some("INFO"));

        let (p2, l2) = extract_run_line_meta("[WARN] [1700.12] [listener]: slow callback");
        assert_eq!(p2, None);
        assert_eq!(l2.as_deref(), Some("WARN"));
    }

    #[test]
    fn generates_aggregated_launch_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = write_aggregated_launch_file(
            tmp.path(),
            &[
                ProjectLaunchTarget {
                    package_name: "py_pubsub".to_string(),
                    launch_file: "py_pubsub.launch.py".to_string(),
                },
                ProjectLaunchTarget {
                    package_name: "cpp_pubsub".to_string(),
                    launch_file: "cpp_pubsub.launch.py".to_string(),
                },
            ],
        )
        .expect("write launch");

        let content = fs::read_to_string(&path).expect("read launch");
        assert!(content.contains("get_package_share_directory('py_pubsub')"));
        assert!(content.contains("'cpp_pubsub.launch.py'"));
        assert!(content.contains("IncludeLaunchDescription"));
    }
}
