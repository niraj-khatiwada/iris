#[tauri::command]
pub fn get_screen_capture_permission() -> bool {
    crate::sys::screen::has_permission()
}

#[tauri::command]
pub fn request_screen_capture_permission() -> bool {
    crate::sys::screen::request_permission()
}

#[tauri::command]
pub fn open_screen_capture_settings() -> Result<(), String> {
    crate::sys::screen::open_settings()
}
