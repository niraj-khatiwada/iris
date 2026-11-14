use tauri::AppHandle;

#[tauri::command]
pub fn overlay_ready(app: AppHandle) -> Result<(), String> {
    crate::sys::overlay::ready(&app)
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    crate::sys::overlay::show(&app)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    crate::sys::overlay::hide(&app)
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> Result<(), String> {
    crate::sys::overlay::toggle(&app)
}

#[tauri::command]
pub fn resize_overlay(app: AppHandle, height: f64) -> Result<(), String> {
    crate::sys::overlay::resize(&app, height)
}
