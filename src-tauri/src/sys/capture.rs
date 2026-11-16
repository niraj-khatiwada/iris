use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow,
};

use crate::utils::event;

pub const CAPTURE_LABEL: &str = "capture";

#[cfg(target_os = "macos")]
mod panel {
    use tauri_nspanel::tauri_panel;

    tauri_panel! {
        panel!(IrisCapturePanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
    }
}

/// Turns the capture window into a non-activating panel above the overlay. It appears on the
/// current Space without switching desktops or activating the history window.
#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle) -> Result<(), String> {
    use tauri_nspanel::{CollectionBehavior, StyleMask, WebviewWindowExt};

    let Some(window) = window(app) else {
        return Ok(());
    };
    let panel = window
        .to_panel::<panel::IrisCapturePanel>()
        .map_err(|error| error.to_string())?;

    panel
        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
        .map_err(|error| error.to_string())?;
    panel.set_level(26);
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
    app.get_webview_window(CAPTURE_LABEL)
}

/// Covers the captured display with the screenshot and waits for a selection.
pub fn show(app: &AppHandle, monitor: &tauri::Monitor, image: &str) -> Result<(), String> {
    let Some(window) = window(app) else {
        return Err("The Iris capture window is not available.".to_string());
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

        match app.get_webview_panel(CAPTURE_LABEL) {
            Ok(panel) => panel.show_and_make_key(),
            Err(error) => {
                log::warn!("Could not show the capture panel: {error:?}; falling back to a window");
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

    // The capture webview is created at startup, so the listener is already mounted.
    let _ = app.emit(event::CAPTURE_START, serde_json::json!({ "image": image }));
    Ok(())
}

/// Whether the capture panel is currently covering the screen.
pub fn is_visible(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel(CAPTURE_LABEL) {
            return panel.is_visible();
        }
    }

    window(app)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel(CAPTURE_LABEL) {
            panel.hide();
            return Ok(());
        }
    }

    if let Some(window) = window(app) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}
