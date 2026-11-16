use tauri::{AppHandle, Manager};

/// Sets the history window's native appearance without touching the rest of the app.
///
/// Tauri's `Window::set_theme` assigns `NSApplication.appearance` on macOS, which is app-wide.
/// The quick overlay is its own window and must keep following the macOS appearance, so the
/// history window sets the appearance on its own `NSWindow` instead.
#[tauri::command]
pub fn set_main_window_theme(app: AppHandle, theme: Option<String>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The Iris history window is not available.".to_string())?;

    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua,
            NSAppearanceNameDarkAqua, NSWindow,
        };

        let handle = window.ns_window().map_err(|error| error.to_string())?;
        if handle.is_null() {
            return Ok(());
        }

        let pointer = handle as usize;
        window
            .run_on_main_thread(move || {
                let ns_window = unsafe { &*(pointer as *const NSWindow) };
                let appearance = match theme.as_deref() {
                    Some("dark") => unsafe {
                        NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua)
                    },
                    Some("light") => unsafe {
                        NSAppearance::appearanceNamed(NSAppearanceNameAqua)
                    },
                    _ => None,
                };
                ns_window.setAppearance(appearance.as_deref());
            })
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_theme(match theme.as_deref() {
                Some("dark") => Some(tauri::Theme::Dark),
                Some("light") => Some(tauri::Theme::Light),
                _ => None,
            })
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}
