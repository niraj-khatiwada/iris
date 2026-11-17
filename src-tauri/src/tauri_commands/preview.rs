use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::sys::preview;

const PREVIEW_SHOW: &str = "preview:show";
const PREVIEW_HIDE: &str = "preview:hide";

/// Remembers which window opened the preview so closing it can restore that window's focus.
#[derive(Default)]
pub struct PreviewState {
    source: Mutex<Option<String>>,
}

/// Opens the in-app image preview above the overlay. `source` is the label of the window that
/// initiated it (`overlay` or `main`); anything else falls back to the history window.
#[tauri::command]
pub async fn show_image_preview(
    app: AppHandle,
    state: State<'_, PreviewState>,
    source: String,
    data_url: String,
) -> Result<(), String> {
    let source = if source == crate::sys::overlay::OVERLAY_LABEL {
        source
    } else {
        "main".to_string()
    };

    let monitor_app = app.clone();
    let monitor_source = source.clone();
    let monitor = on_main(&app, move || -> Result<tauri::Monitor, String> {
        let window = monitor_app
            .get_webview_window(&monitor_source)
            .or_else(|| monitor_app.get_webview_window("main"))
            .ok_or_else(|| "The window that opened the preview is not available.".to_string())?;
        window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| window.primary_monitor().ok().flatten())
            .ok_or_else(|| "Could not find a display for the preview.".to_string())
    })??;

    {
        let mut current = state
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *current = Some(source);
    }

    let show_app = app.clone();
    let show_monitor = monitor.clone();
    on_main(&app, move || preview::show(&show_app, &show_monitor))??;

    // The preview webview is created at startup, so its listener is already mounted.
    let _ = app.emit(PREVIEW_SHOW, serde_json::json!({ "dataUrl": data_url }));
    Ok(())
}

/// Hides the preview and gives focus back to the overlay or history window that opened it.
#[tauri::command]
pub async fn close_image_preview(
    app: AppHandle,
    state: State<'_, PreviewState>,
) -> Result<(), String> {
    let hide_app = app.clone();
    on_main(&app, move || preview::hide(&hide_app))??;
    let _ = app.emit(PREVIEW_HIDE, ());

    let source = state
        .source
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();

    match source.as_deref() {
        Some(crate::sys::overlay::OVERLAY_LABEL) => {
            let show_app = app.clone();
            on_main(&app, move || crate::sys::overlay::show(&show_app))??;
        }
        _ => {
            let focus_app = app.clone();
            on_main(&app, move || {
                if let Some(window) = focus_app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            })?;
        }
    }

    Ok(())
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
