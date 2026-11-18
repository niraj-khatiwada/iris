use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow};

pub const PREVIEW_LABEL: &str = "preview";

#[cfg(target_os = "macos")]
mod panel {
    use tauri_nspanel::tauri_panel;

    tauri_panel! {
        panel!(IrisPreviewPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
    }
}

/// Turns the preview window into a non-activating panel above the overlay, so opening an image
/// never activates a different app or switches Spaces.
#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle) -> Result<(), String> {
    use tauri_nspanel::{CollectionBehavior, StyleMask, WebviewWindowExt};

    let Some(window) = window(app) else {
        return Ok(());
    };
    let panel = window
        .to_panel::<panel::IrisPreviewPanel>()
        .map_err(|error| error.to_string())?;

    panel
        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
        .map_err(|error| error.to_string())?;
    panel.set_level(28);
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .ignores_cycle()
            .into(),
    );
    panel.set_hides_on_deactivate(false);
    panel.set_transparent(true);
    panel.set_has_shadow(false);
    panel.set_released_when_closed(false);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn setup(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PREVIEW_LABEL)
}

/// Covers the display that opened the preview with a dim lightbox and makes the panel key so
/// Escape reaches the preview webview.
pub fn show(app: &AppHandle, monitor: &tauri::Monitor) -> Result<(), String> {
    let Some(window) = window(app) else {
        return Err("The Iris preview window is not available.".to_string());
    };

    let scale = monitor.scale_factor();
    let size = monitor.size();
    let position = monitor.position();
    window
        .set_size(Size::Logical(LogicalSize::new(
            size.width as f64 / scale,
            size.height as f64 / scale,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_position(Position::Logical(LogicalPosition::new(
            position.x as f64 / scale,
            position.y as f64 / scale,
        )))
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        match app.get_webview_panel(PREVIEW_LABEL) {
            Ok(panel) => panel.show_and_make_key(),
            Err(error) => {
                log::warn!("Could not show the preview panel: {error:?}; falling back to a window");
                window.show().map_err(|error| error.to_string())?;
                window.set_focus().map_err(|error| error.to_string())?;
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel(PREVIEW_LABEL) {
            panel.hide();
            return Ok(());
        }
    }

    if let Some(window) = window(app) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Puts the image on the system clipboard in its original format (JPEG stays JPEG), so pasting
/// it produces the same file the download action saves. Unknown formats fall back to a TIFF
/// representation built by `NSImage`. Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn copy_image_to_clipboard(bytes: &[u8]) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSImage, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF};
    use objc2_foundation::{NSData, NSString};

    let data = NSData::with_bytes(bytes);
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();

    let copied = if is_png(bytes) {
        pasteboard.setData_forType(Some(&data), unsafe { NSPasteboardTypePNG })
    } else if is_tiff(bytes) {
        pasteboard.setData_forType(Some(&data), unsafe { NSPasteboardTypeTIFF })
    } else if let Some(uti) = image_uti(bytes) {
        let uti = NSString::from_str(uti);
        pasteboard.setData_forType(Some(&data), &uti)
    } else {
        false
    };
    if copied {
        return Ok(());
    }

    // A format macOS has no pasteboard type for still pastes through its TIFF representation.
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "The image could not be read.".to_string())?;
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "The image could not be prepared for the clipboard.".to_string())?;

    if !pasteboard.setData_forType(Some(&tiff), unsafe { NSPasteboardTypeTIFF }) {
        return Err("The image could not be copied to the clipboard.".to_string());
    }
    Ok(())
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
}

fn is_tiff(bytes: &[u8]) -> bool {
    bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*")
}

/// The pasteboard UTI for the common image formats that have no AppKit constant.
fn image_uti(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("public.jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("com.compuserve.gif");
    }
    if bytes.starts_with(b"BM") {
        return Some("com.microsoft.bmp");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("org.webmproject.webp");
    }
    if bytes.get(4..8) == Some(b"ftyp") {
        match bytes.get(8..12) {
            Some(b"heic" | b"heix" | b"hevc" | b"hevx") => return Some("public.heic"),
            Some(b"mif1" | b"msf1") => return Some("public.heif"),
            Some(b"avif" | b"avis") => return Some("public.avif"),
            _ => {}
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
pub fn copy_image_to_clipboard(_bytes: &[u8]) -> Result<(), String> {
    Err("Copying images is not supported on this platform.".to_string())
}
