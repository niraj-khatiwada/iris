use tauri::{AppHandle, Manager, State};

use crate::core::storage::Storage;

/// Static information about this build, shown in Settings -> About.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: String,
    version: String,
    identifier: String,
    platform: String,
    arch: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        identifier: app.config().identifier.clone(),
        platform: crate::sys::platform::name().to_string(),
        arch: crate::sys::platform::arch().to_string(),
    }
}

/// Brings the main window back, e.g. from a tray click later on.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    let _ = crate::sys::overlay::hide(&app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

/// Wipes everything Iris owns on this Mac: conversations, compressed summaries, speech audio,
/// and the pre-rename data copies. The webview clears its own settings and then restarts Iris.
#[tauri::command]
pub fn reset_app_data(app: AppHandle, storage: State<'_, Storage>) -> Result<(), String> {
    crate::sys::speech::stop(&app);

    if let Some(cache) = app.try_state::<crate::core::agent::SummaryCache>() {
        cache.clear();
    }

    storage.clear()?;

    if let Ok(directory) = app.path().app_cache_dir() {
        if let Ok(entries) = std::fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_speech = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("iris-speech-"));
                if is_speech {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }

    crate::core::legacy::remove_legacy_data();
    crate::sys::overlay::reset_position(&app);
    crate::tauri_commands::keychain::remove_api_key()?;

    Ok(())
}
