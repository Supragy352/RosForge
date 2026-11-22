pub mod catalog;
pub mod codegen;
pub mod commands;
pub mod model;
pub mod project;
pub mod ros_env;
pub mod runner;
pub mod settings;
pub mod validate;

use crate::model::{Diagnostic, Project};
use crate::runner::{
    BuildFinishedEvent, BuildOutputEvent, RunExitedEvent, RunOutputEvent, RunnerManager,
};
use crate::settings::{Settings, SettingsStore};
use specta_typescript::Typescript;
use std::path::Path;
use std::sync::Mutex;
use tauri_specta::{collect_commands, Builder};

pub struct AppState {
    pub settings_store: SettingsStore,
    pub settings: Mutex<Settings>,
    pub active_project: Mutex<Option<Project>>,
    pub runner: RunnerManager,
}

impl AppState {
    pub fn initialize() -> Self {
        let settings_store = SettingsStore::from_default_path().unwrap_or_else(|err| {
            eprintln!("Warning: falling back to temp settings store: {err}");
            SettingsStore::new(std::env::temp_dir().join("rosforge-settings.json"))
        });

        let settings = settings_store.load().unwrap_or_else(|err| {
            eprintln!("Warning: failed to load settings, using defaults: {err}");
            Settings::default()
        });

        Self {
            settings_store,
            settings: Mutex::new(settings),
            active_project: Mutex::new(None),
            runner: RunnerManager::new(),
        }
    }
}

pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .disable_serde_phases()
        .commands(collect_commands![
            commands::ping,
            commands::get_settings,
            commands::save_settings,
            commands::check_ros_health,
            commands::open_workspace,
            commands::save_project,
            commands::create_example_project,
            commands::validate_project,
            commands::get_interface_catalog,
            commands::show_interface,
            commands::preview_generate,
            commands::apply_generate,
            commands::open_devtools,
            commands::start_build,
            commands::cancel_build,
            commands::clean_workspace,
            commands::start_run,
            commands::stop_run,
            commands::get_runner_status,
            commands::open_in_editor,
        ])
        .typ::<Project>()
        .typ::<Diagnostic>()
        .typ::<BuildOutputEvent>()
        .typ::<BuildFinishedEvent>()
        .typ::<RunOutputEvent>()
        .typ::<RunExitedEvent>()
}

pub fn export_typescript_bindings(output_path: impl AsRef<Path>) -> Result<(), String> {
    let path = output_path.as_ref();
    specta_builder()
        .export(Typescript::default(), path)
        .map_err(|err| {
            format!(
                "failed to export TypeScript bindings to {}: {err}",
                path.display()
            )
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    {
        let bindings_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("bindings.ts");
        builder
            .export(Typescript::default(), &bindings_path)
            .expect("Failed to export TypeScript bindings");
    }

    let app_state = AppState::initialize();
    let runner_for_exit = app_state.runner.clone();

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .on_window_event(move |_window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                runner_for_exit.stop_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running RosForge Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_ts_bindings_succeeds() {
        let bindings_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("bindings.ts");
        export_typescript_bindings(&bindings_path).expect("export TypeScript bindings");

        let content = std::fs::read_to_string(&bindings_path).expect("read generated bindings.ts");
        assert!(content.contains("ping"));
        assert!(content.contains("getSettings"));
        assert!(content.contains("saveSettings"));
        assert!(content.contains("checkRosHealth"));
        assert!(content.contains("openWorkspace"));
        assert!(content.contains("saveProject"));
        assert!(content.contains("createExampleProject"));
        assert!(content.contains("validateProject"));
        assert!(content.contains("getInterfaceCatalog"));
        assert!(content.contains("showInterface"));
        assert!(content.contains("export type Project"));
    }
}
