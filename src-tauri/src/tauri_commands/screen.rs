use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureAttached {
    data_url: String,
}

/// Captures the display under the mouse, attaches it to the current quick chat, and focuses the
/// prompt. This is the `⌘⇧A` path: no capture panel, region selection, or annotation.
#[tauri::command]
pub async fn capture_screen_for_ask(app: AppHandle) -> Result<(), String> {
    let result = ask_capture(&app).await;

    // The overlay may have been hidden for the shot. Always bring it back so both the attached
    // image and any error are visible.
    let show_app = app.clone();
    let _ = on_main(&app, move || crate::sys::overlay::show(&show_app));

    let data_url = result?;
    let _ = app.emit("capture:attached", CaptureAttached { data_url });
    Ok(())
}

async fn ask_capture(app: &AppHandle) -> Result<String, String> {
    if !crate::sys::screen::has_permission() {
        return Err("Screen Recording permission is required.".to_string());
    }

    let display_app = app.clone();
    let display = on_main(app, move || -> Result<usize, String> {
        let position = display_app
            .cursor_position()
            .map_err(|error| format!("Could not read the mouse position: {error}"))?;
        let monitor = display_app
            .monitor_from_point(position.x, position.y)
            .map_err(|error| format!("Could not find the display under the mouse: {error}"))?
            .or_else(|| {
                display_app
                    .get_webview_window(crate::sys::overlay::OVERLAY_LABEL)
                    .and_then(|window| window.current_monitor().ok().flatten())
            })
            .or_else(|| display_app.primary_monitor().ok().flatten())
            .ok_or_else(|| "Could not find a display to capture.".to_string())?;
        Ok(display_number(&display_app, &monitor))
    })??;

    let hide_app = app.clone();
    on_main(app, move || crate::sys::overlay::hide(&hide_app))??;
    tokio::time::sleep(Duration::from_millis(120)).await;

    let capture_app = app.clone();
    tokio::task::spawn_blocking(move || capture_display_jpeg(&capture_app, display))
        .await
        .map_err(|error| format!("Screen capture task failed: {error}"))?
}

/// Opens the live capture panel over the current display. Nothing is screenshotted yet: the
/// screen keeps rendering behind a transparent selection overlay, and the annotated region is
/// captured only when the user attaches it. AppKit window calls must stay on the main thread.
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

    let monitor_app = app.clone();
    let monitor = on_main(&app, move || -> Result<tauri::Monitor, String> {
        let overlay = monitor_app
            .get_webview_window(crate::sys::overlay::OVERLAY_LABEL)
            .ok_or_else(|| "The Iris overlay is not available.".to_string())?;
        overlay
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| overlay.primary_monitor().ok().flatten())
            .ok_or_else(|| "Could not find a display to capture.".to_string())
    })??;

    let show_app = app.clone();
    let show_monitor = monitor.clone();
    on_main(&app, move || {
        crate::sys::capture::show(&show_app, &show_monitor)
    })??;

    // Iris stays above the selection as a passive panel: visible and clickable, but it never
    // takes key focus from the capture tools.
    let overlay_app = app.clone();
    if let Err(error) = on_main(&app, move || {
        crate::sys::overlay::show_passive(&overlay_app)
    }) {
        log::warn!("Could not show the overlay above the capture panel: {error}");
    }

    Ok(())
}

/// Captures the display under the live capture panel. The frontend hides the selection chrome
/// first, so the screenshot contains the live screen plus the annotations, never the handles or
/// toolbar. Iris is hidden for the shot and restored passively afterwards.
#[tauri::command]
pub async fn capture_annotated_screen(app: AppHandle) -> Result<String, String> {
    if !crate::sys::screen::has_permission() {
        return Err("Screen Recording permission is required.".to_string());
    }

    let hide_app = app.clone();
    on_main(&app, move || crate::sys::overlay::hide(&hide_app))??;
    tokio::time::sleep(Duration::from_millis(120)).await;

    let display_app = app.clone();
    let display = on_main(&app, move || -> Result<usize, String> {
        let capture = display_app
            .get_webview_window(crate::sys::capture::CAPTURE_LABEL)
            .ok_or_else(|| "The Iris capture window is not available.".to_string())?;
        let monitor = capture
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| capture.primary_monitor().ok().flatten())
            .ok_or_else(|| "Could not find a display to capture.".to_string())?;
        Ok(display_number(&display_app, &monitor))
    })??;

    let capture_app = app.clone();
    let image = tokio::task::spawn_blocking(move || capture_display(&capture_app, display))
        .await
        .map_err(|error| format!("Screen capture task failed: {error}"))?;

    // The capture panel keeps key focus. Showing Iris passively again also leaves the capture
    // usable if the frontend fails to crop the image.
    let restore_app = app.clone();
    let _ = on_main(&app, move || {
        crate::sys::overlay::show_passive(&restore_app)
    });

    image
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
    capture_display_with_format(app, display, "png", "image/png", None)
}

fn capture_display_jpeg(app: &AppHandle, display: usize) -> Result<String, String> {
    capture_display_with_format(app, display, "jpg", "image/jpeg", Some("jpg"))
}

fn capture_display_with_format(
    app: &AppHandle,
    display: usize,
    extension: &str,
    mime_type: &str,
    capture_format: Option<&str>,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the capture cache directory: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the capture cache directory: {error}"))?;
    let path = directory.join(format!(
        "iris-capture-{}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default(),
        extension
    ));

    let mut command = std::process::Command::new("/usr/sbin/screencapture");
    command.arg("-x").arg("-D").arg(display.to_string());
    if let Some(format) = capture_format {
        command.arg("-t").arg(format);
    }
    let output = command
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
        "data:{mime_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
