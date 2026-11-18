use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::core::attachments;
use crate::sys::preview;

const PREVIEW_SHOW: &str = "preview:show";
const PREVIEW_HIDE: &str = "preview:hide";

/// The image currently on screen, kept so copy and save do not need the webview to send it back.
#[derive(Clone)]
struct PreviewImage {
    /// Asset-protocol or data URL used by the lightbox.
    url: String,
    /// Set for stored attachments; the original file is the best copy/download source.
    conversation_id: Option<String>,
    file_name: Option<String>,
}

/// Remembers which window opened the preview so closing it can restore that window's focus.
#[derive(Default)]
pub struct PreviewState {
    source: Mutex<Option<String>>,
    image: Mutex<Option<PreviewImage>>,
}

/// Opens the in-app image preview above the overlay. `source` is the label of the window that
/// initiated it (`overlay` or `main`); anything else falls back to the history window.
#[tauri::command]
pub async fn show_image_preview(
    app: AppHandle,
    state: State<'_, PreviewState>,
    source: String,
    url: String,
    name: String,
    conversation_id: Option<String>,
    file_name: Option<String>,
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

    {
        let mut current = state
            .image
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *current = Some(PreviewImage {
            url: url.clone(),
            conversation_id: conversation_id.clone(),
            file_name: file_name.clone(),
        });
    }

    let show_app = app.clone();
    let show_monitor = monitor.clone();
    on_main(&app, move || preview::show(&show_app, &show_monitor))??;

    // The preview webview is created at startup, so its listener is already mounted.
    let _ = app.emit(
        PREVIEW_SHOW,
        serde_json::json!({
            "url": url,
            "name": name,
            "conversationId": conversation_id,
            "fileName": file_name,
        }),
    );
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

/// Copies the image on screen to the system clipboard.
#[tauri::command]
pub async fn copy_preview_image(
    app: AppHandle,
    state: State<'_, PreviewState>,
) -> Result<(), String> {
    let image = current_image(&state)?;
    let bytes = read_image_bytes(&app, &image)?;
    on_main(&app, move || preview::copy_image_to_clipboard(&bytes))?
}

/// Writes the image on screen to the destination chosen in the save dialog.
#[tauri::command]
pub async fn save_preview_image(
    app: AppHandle,
    state: State<'_, PreviewState>,
    destination: String,
) -> Result<(), String> {
    let image = current_image(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_image_bytes(&app, &image)?;
        if let Some(parent) = std::path::Path::new(&destination).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the download folder: {error}"))?;
        }
        std::fs::write(&destination, bytes)
            .map_err(|error| format!("Could not save the image: {error}"))
    })
    .await
    .map_err(|error| format!("Could not save the image: {error}"))?
}

fn current_image(state: &State<'_, PreviewState>) -> Result<PreviewImage, String> {
    state
        .image
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .ok_or_else(|| "There is no image to use.".to_string())
}

/// Reads the stored original when available, otherwise the inline data URL shown in the lightbox.
fn read_image_bytes(app: &AppHandle, image: &PreviewImage) -> Result<Vec<u8>, String> {
    if let (Some(conversation_id), Some(file_name)) = (&image.conversation_id, &image.file_name) {
        let path = attachments::path_for(app, conversation_id, file_name)?;
        match std::fs::read(&path) {
            Ok(bytes) => return Ok(bytes),
            Err(error) => {
                // The lightbox may still be showing a fallback data URL for this attachment.
                if let Ok(bytes) = decode_data_url(&image.url) {
                    return Ok(bytes);
                }
                return Err(format!("Could not read the image: {error}"));
            }
        }
    }

    decode_data_url(&image.url)
}

fn decode_data_url(value: &str) -> Result<Vec<u8>, String> {
    let (header, data) = value
        .split_once(',')
        .ok_or_else(|| "The image data is invalid.".to_string())?;
    if !header.starts_with("data:") || !header.ends_with(";base64") {
        return Err("The image data is invalid.".to_string());
    }

    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "The image data is invalid.".to_string())
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
