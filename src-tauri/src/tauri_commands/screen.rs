use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager};

/// Hides the overlay for the screenshot, then opens the capture panel below the overlay so Iris
/// stays visible and usable above the frozen screen. AppKit window calls must stay on the main
/// thread; only the blocking screencapture runs off it.
#[tauri::command]
pub async fn start_screen_capture(app: AppHandle) -> Result<(), String> {
    if !crate::sys::screen::has_permission() {
        return Err("Screen Recording permission is required.".to_string());
    }

    let visible_app = app.clone();
    let capture_visible =
        on_main(&app, move || crate::sys::capture::is_visible(&visible_app)).unwrap_or(false);
    if capture_visible {
        return Ok(());
    }

    let prepare_app = app.clone();
    let (monitor, display) = on_main(&app, move || -> Result<(tauri::Monitor, usize), String> {
        let overlay = prepare_app
            .get_webview_window(crate::sys::overlay::OVERLAY_LABEL)
            .ok_or_else(|| "The Iris overlay is not available.".to_string())?;
        let monitor = overlay
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| overlay.primary_monitor().ok().flatten())
            .ok_or_else(|| "Could not find a display to capture.".to_string())?;
        let display = display_number(&prepare_app, &monitor);
        Ok((monitor, display))
    })??;

    let hide_app = app.clone();
    on_main(&app, move || crate::sys::overlay::hide(&hide_app))??;

    tokio::time::sleep(Duration::from_millis(220)).await;

    let capture_app = app.clone();
    let image =
        match tokio::task::spawn_blocking(move || capture_display(&capture_app, display)).await {
            Ok(Ok(image)) => image,
            Ok(Err(error)) => {
                restore_overlay(&app);
                return Err(error);
            }
            Err(error) => {
                restore_overlay(&app);
                return Err(format!("Screen capture task failed: {error}"));
            }
        };

    let show_app = app.clone();
    let show_monitor = monitor.clone();
    let show_image = image.clone();
    let shown = on_main(&app, move || {
        crate::sys::capture::show(&show_app, &show_monitor, &show_image)
    });
    let result = match shown {
        Ok(inner) => inner,
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        restore_overlay(&app);
        return Err(error);
    }

    // Show Iris above the capture panel without stealing its key focus.
    let overlay_app = app.clone();
    if let Err(error) = on_main(&app, move || {
        crate::sys::overlay::show_passive(&overlay_app)
    }) {
        log::warn!("Could not show the overlay above the capture panel: {error}");
    }

    Ok(())
}

/// Closes the capture window and brings the quick overlay back.
#[tauri::command]
pub fn close_screen_capture(app: AppHandle) -> Result<(), String> {
    crate::sys::capture::hide(&app)?;
    let _ = app.emit(crate::utils::event::CAPTURE_CLOSED, ());
    crate::sys::overlay::show(&app)
}

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

fn restore_overlay(app: &AppHandle) {
    let handle = app.clone();
    let _ = on_main(app, move || crate::sys::overlay::show(&handle));
}

/// Runs a closure on the main thread and waits for it. AppKit window APIs require this.
fn on_main<T, F>(app: &AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(task());
    })
    .map_err(|error| error.to_string())?;
    receiver.recv().map_err(|error| error.to_string())
}

fn display_number(app: &AppHandle, monitor: &tauri::Monitor) -> usize {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .position(|candidate| {
            candidate.position() == monitor.position() && candidate.size() == monitor.size()
        })
        .map(|index| index + 1)
        .unwrap_or(1)
}

fn capture_display(app: &AppHandle, display: usize) -> Result<String, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the capture cache directory: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the capture cache directory: {error}"))?;
    let path = directory.join(format!(
        "iris-capture-{}.png",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));

    let output = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-D")
        .arg(display.to_string())
        .arg(&path)
        .output()
        .map_err(|error| format!("Could not run the screen capture: {error}"))?;

    let bytes = std::fs::read(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Screen capture failed.".to_string()
        } else {
            message
        });
    }
    if bytes.is_empty() {
        return Err("Screen capture returned an empty image.".to_string());
    }

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
