use crate::catalog::{self, InterfaceCatalog, InterfaceDefinition};
use crate::codegen::{self, ApplyGenerateResult, FileResolution, GeneratePreview};
use crate::model::{Diagnostic, Project};
use crate::project;
use crate::ros_env::{self, RosEnvConfig, RosHealthStatus};
use crate::runner::{
    self, BuildRequest, BuildStartResponse, CleanRequest, CleanResult, RunRequest,
    RunStartResponse, RunnerStatus,
};
use crate::settings::Settings;
use crate::validate;
use crate::AppState;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub ok: bool,
    pub reply: String,
    pub app_version: String,
    pub platform: String,
}

#[tauri::command]
#[specta::specta]
pub fn ping(message: Option<String>) -> PingResponse {
    let reply = match message {
        Some(msg) if !msg.trim().is_empty() => format!("pong: {}", msg.trim()),
        _ => "pong".to_string(),
    };

    PingResponse {
        ok: true,
        reply,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let guard = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
#[specta::specta]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    state
        .settings_store
        .save(&settings)
        .map_err(|e| e.to_string())?;

    let mut guard = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    *guard = settings.clone();
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub async fn check_ros_health(state: State<'_, AppState>) -> Result<RosHealthStatus, String> {
    let settings = {
        let guard = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        guard.clone()
    };

    let config = RosEnvConfig::from_settings(&settings, None);
    Ok(ros_env::check_ros_health(&config).await)
}

#[tauri::command]
#[specta::specta]
pub fn open_workspace(
    state: State<'_, AppState>,
    workspace_path: String,
    project_name: Option<String>,
) -> Result<Project, String> {
    let ws = PathBuf::from(workspace_path.trim());
    let proj = project::open_or_init_workspace(&ws, project_name.as_deref())
        .map_err(|e| e.to_string())?;

    {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        project::record_recent_workspace(&mut settings.recent_workspaces, &proj.workspace_path);
        let _ = state.settings_store.save(&settings);
    }

    if let Ok(mut active) = state.active_project.lock() {
        *active = Some(proj.clone());
    }

    Ok(proj)
}

#[tauri::command]
#[specta::specta]
pub fn save_project(state: State<'_, AppState>, project: Project) -> Result<Project, String> {
    project::save_project(&project).map_err(|e| e.to_string())?;

    if let Ok(mut active) = state.active_project.lock() {
        *active = Some(project.clone());
    }

    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn create_example_project(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<Project, String> {
    let ws_trimmed = workspace_path.trim();
    if ws_trimmed.is_empty() {
        return Err("Workspace path cannot be empty".to_string());
    }

    let (maint_name, maint_email) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        (
            settings.default_maintainer_name.clone(),
            settings.default_maintainer_email.clone(),
        )
    };

    let proj = project::build_talker_listener_example(ws_trimmed, &maint_name, &maint_email);
    project::save_project(&proj).map_err(|e| e.to_string())?;

    {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        project::record_recent_workspace(&mut settings.recent_workspaces, &proj.workspace_path);
        let _ = state.settings_store.save(&settings);
    }

    if let Ok(mut active) = state.active_project.lock() {
        *active = Some(proj.clone());
    }

    Ok(proj)
}

#[tauri::command]
#[specta::specta]
pub fn validate_project(project: Project) -> Vec<Diagnostic> {
    validate::validate_project(&project)
}

#[tauri::command]
#[specta::specta]
pub async fn get_interface_catalog(
    state: State<'_, AppState>,
    refresh: bool,
) -> Result<InterfaceCatalog, String> {
    let (settings, active_ws) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?
            .clone();
        let active_ws = state
            .active_project
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|p| PathBuf::from(&p.workspace_path)));
        (settings, active_ws)
    };

    let config = RosEnvConfig::from_settings(&settings, active_ws);
    Ok(catalog::load_catalog(&config, refresh).await)
}

#[tauri::command]
#[specta::specta]
pub async fn show_interface(
    state: State<'_, AppState>,
    interface_type: String,
) -> Result<InterfaceDefinition, String> {
    let (settings, active_ws) = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?
            .clone();
        let active_ws = state
            .active_project
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|p| PathBuf::from(&p.workspace_path)));
        (settings, active_ws)
    };

    let config = RosEnvConfig::from_settings(&settings, active_ws);
    catalog::show_interface(&config, &interface_type).await
}

#[tauri::command]
#[specta::specta]
pub fn preview_generate(project: Project) -> GeneratePreview {
    codegen::preview_generate(&project)
}

#[tauri::command]
#[specta::specta]
pub fn apply_generate(
    state: State<'_, AppState>,
    project: Project,
    resolutions: BTreeMap<String, FileResolution>,
) -> Result<ApplyGenerateResult, String> {
    let result = codegen::apply_generate(&project, &resolutions)?;
    if let Ok(mut active) = state.active_project.lock() {
        *active = Some(result.project.clone());
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn open_devtools(app: AppHandle, toggle: Option<bool>) -> Result<bool, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;
    if toggle.unwrap_or(false) && win.is_devtools_open() {
        win.close_devtools();
        return Ok(false);
    }
    win.open_devtools();
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub fn start_build(
    app: AppHandle,
    state: State<'_, AppState>,
    request: BuildRequest,
) -> Result<BuildStartResponse, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .clone();
    let config = RosEnvConfig::from_settings(
        &settings,
        Some(PathBuf::from(request.workspace_path.trim())),
    );
    state.runner.start_build(app, config, request)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_build(state: State<'_, AppState>) -> Result<bool, String> {
    state.runner.cancel_build()
}

#[tauri::command]
#[specta::specta]
pub fn clean_workspace(
    state: State<'_, AppState>,
    request: CleanRequest,
) -> Result<CleanResult, String> {
    state.runner.clean_workspace(request)
}

#[tauri::command]
#[specta::specta]
pub fn start_run(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RunRequest,
) -> Result<RunStartResponse, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .clone();
    let config = RosEnvConfig::from_settings(
        &settings,
        Some(PathBuf::from(request.workspace_path.trim())),
    );
    state.runner.start_run(app, config, request)
}

#[tauri::command]
#[specta::specta]
pub fn stop_run(state: State<'_, AppState>, run_id: String) -> Result<bool, String> {
    state.runner.stop_run(&run_id)
}

#[tauri::command]
#[specta::specta]
pub fn get_runner_status(state: State<'_, AppState>) -> RunnerStatus {
    state.runner.status()
}

#[tauri::command]
#[specta::specta]
pub fn open_in_editor(
    state: State<'_, AppState>,
    file: String,
    line: Option<u32>,
) -> Result<(), String> {
    let editor_cmd = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .external_editor_command
        .clone();
    runner::open_in_external_editor(&editor_cmd, &file, line)
}



