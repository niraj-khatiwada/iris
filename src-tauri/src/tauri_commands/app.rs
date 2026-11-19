use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartExt;

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

/// Hides the history window without quitting Iris, the same result as the red close button and
/// Cmd+W in the history window.
#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn reload_app_windows(app: AppHandle) {
    // Reload both webviews so every Zustand store and the localStorage cache start clean. The
    // process (and the menu bar item) stays alive; a full restart raced the single-instance plugin.
    for label in ["main", "overlay"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.eval("window.location.reload()");
        }
    }
}

/// Wipes everything Iris owns on this Mac: conversations, compressed summaries, speech audio,
/// and the pre-rename data copies. The webview clears its own settings and then reloads.
#[tauri::command]
pub fn reset_app_data(app: AppHandle, storage: State<'_, Storage>) -> Result<(), String> {
    crate::sys::speech::stop(&app);

    // Start-at-login is registered with macOS, outside the database reset, so turn it off too.
    if let Err(error) = app.autolaunch().disable() {
        log::warn!("Could not disable start at login during reset: {error}");
    }

    if let Some(cache) = app.try_state::<crate::core::agent::SummaryCache>() {
        cache.clear();
    }

    // Drop the schema and immediately rebuild an empty one, so the backend is usable during the
    // short window before the webviews reload.
    storage.reset_schema()?;
    crate::core::attachments::delete_all(&app)?;

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
    // The schema reset above dropped the credential table, which takes the API key with it, so no
    // separate clear is needed here.

    Ok(())
}
