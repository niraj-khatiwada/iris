use tauri::{AppHandle, Manager};

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
