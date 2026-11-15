use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewWindow,
};

pub const OVERLAY_LABEL: &str = "overlay";
pub const CANVAS_LABEL: &str = "canvas";

static OVERLAY_READY: AtomicBool = AtomicBool::new(false);

const OVERLAY_WIDTH: f64 = 792.0;
const OVERLAY_MIN_HEIGHT: f64 = 100.0;
const OVERLAY_MAX_HEIGHT: f64 = 720.0;
const BOTTOM_MARGIN: f64 = 96.0;

#[cfg(target_os = "macos")]
mod panel {
    use tauri_nspanel::tauri_panel;

    tauri_panel! {
        panel!(IrisOverlayPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })

        panel!(IrisCanvasPanel {
            config: {
                can_become_key_window: false,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
    }
}

/// Converts the pre-created windows into non-activating NSPanels. This is what lets the overlay
/// become key on the current Space without activating Iris or pulling the history window forward.
#[cfg(target_os = "macos")]
pub fn setup_panels(app: &AppHandle) -> Result<(), String> {
    use tauri_nspanel::{CollectionBehavior, StyleMask, WebviewWindowExt};

    let overlay = overlay_window(app)?;
    let overlay_panel = overlay
        .to_panel::<panel::IrisOverlayPanel>()
        .map_err(|error| error.to_string())?;

    overlay_panel
        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
        .map_err(|error| error.to_string())?;
    overlay_panel.set_level(27);
    overlay_panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .ignores_cycle()
            .into(),
    );
    overlay_panel.set_hides_on_deactivate(false);
    overlay_panel.set_transparent(true);
    overlay_panel.set_has_shadow(false);
    overlay_panel.set_released_when_closed(false);

    if let Some(canvas) = app.get_webview_window(CANVAS_LABEL) {
        match canvas.to_panel::<panel::IrisCanvasPanel>() {
            Ok(canvas_panel) => {
                if let Err(error) =
                    canvas_panel.add_style_mask(StyleMask::empty().nonactivating_panel().into())
                {
                    log::warn!("Could not make the canvas non-activating: {error}");
                }
                canvas_panel.set_level(25);
                canvas_panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .stationary()
                        .full_screen_auxiliary()
                        .ignores_cycle()
                        .into(),
                );
                canvas_panel.set_hides_on_deactivate(false);
                canvas_panel.set_transparent(true);
                canvas_panel.set_has_shadow(false);
                canvas_panel.set_released_when_closed(false);
            }
            Err(error) => log::warn!("Could not convert the Iris canvas to a panel: {error}"),
        }
    }

    log::info!("Iris windows are ready as non-activating panels");
    Ok(())
}

fn overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "The Iris overlay window is not available.".to_string())
}

/// Called by the overlay once its first frame is painted. Until then, showing the window would
/// reveal an empty native surface before the webview has anything in it.
pub fn ready(app: &AppHandle) -> Result<(), String> {
    OVERLAY_READY.store(true, Ordering::SeqCst);
    log::info!("Overlay webview painted; revealing Iris");
    show(app)
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    if !OVERLAY_READY.load(Ordering::SeqCst) {
        log::debug!("Overlay has not painted yet; leaving it hidden");
        return Ok(());
    }

    log::debug!("Showing Iris overlay");
    if let Err(error) = show_canvas(app) {
        log::warn!("Could not show the Iris canvas: {error}");
    }

    let window = overlay_window(app)?;
    position(&window, None)?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        match app.get_webview_panel(OVERLAY_LABEL) {
            Ok(panel) => panel.show_and_make_key(),
            Err(error) => {
                log::warn!("Could not show the Iris panel: {error:?}; falling back to a window");
                window.show().map_err(|error| error.to_string())?;
                let _ = window.set_always_on_top(true);
                let _ = window.set_visible_on_all_workspaces(true);
                let _ = window.unminimize();
                elevate(&window, true);
                window.set_focus().map_err(|error| error.to_string())?;
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.unminimize();
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    log::debug!("Hiding Iris overlay");
    if let Some(canvas) = app.get_webview_window(CANVAS_LABEL) {
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;

            if let Ok(panel) = app.get_webview_panel(CANVAS_LABEL) {
                panel.hide();
            } else if let Err(error) = canvas.hide() {
                log::warn!("Could not hide the Iris canvas: {error}");
            }
        }
        #[cfg(not(target_os = "macos"))]
        if let Err(error) = canvas.hide() {
            log::warn!("Could not hide the Iris canvas: {error}");
        }
    }

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel(OVERLAY_LABEL) {
            panel.hide();
            let _ = app.emit(crate::utils::event::OVERLAY_HIDDEN, ());
            return Ok(());
        }
    }

    overlay_window(app)?
        .hide()
        .map_err(|error| error.to_string())?;
    let _ = app.emit(crate::utils::event::OVERLAY_HIDDEN, ());
    Ok(())
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    if !OVERLAY_READY.load(Ordering::SeqCst) {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    let visible = {
        use tauri_nspanel::ManagerExt;

        app.get_webview_panel(OVERLAY_LABEL)
            .map(|panel| panel.is_visible())
            .unwrap_or(false)
    };
    #[cfg(not(target_os = "macos"))]
    let visible = overlay_window(app)?
        .is_visible()
        .map_err(|error| error.to_string())?;

    if visible {
        hide(app)
    } else {
        show(app)
    }
}

/// Shows the full-screen, click-through canvas behind the quick-chat panel. It covers every
/// display and is the future surface for screen annotations and agent output.
fn show_canvas(app: &AppHandle) -> Result<(), String> {
    let canvas = app
        .get_webview_window(CANVAS_LABEL)
        .ok_or_else(|| "The Iris canvas window is not available.".to_string())?;

    fit_canvas_to_monitors(&canvas)?;
    canvas
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        match app.get_webview_panel(CANVAS_LABEL) {
            Ok(panel) => panel.order_front_regardless(),
            Err(error) => {
                log::warn!("Could not show the Iris canvas panel: {error:?}; falling back");
                canvas.show().map_err(|error| error.to_string())?;
                let _ = canvas.set_always_on_top(true);
                let _ = canvas.set_visible_on_all_workspaces(true);
                elevate(&canvas, false);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        canvas.show().map_err(|error| error.to_string())?;
        let _ = canvas.set_always_on_top(true);
        let _ = canvas.set_visible_on_all_workspaces(true);
    }

    Ok(())
}

fn fit_canvas_to_monitors(canvas: &WebviewWindow) -> Result<(), String> {
    let monitors = canvas
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let Some(first) = monitors.first() else {
        return Ok(());
    };

    let mut min_x = first.position().x;
    let mut min_y = first.position().y;
    let mut max_x = min_x + first.size().width as i32;
    let mut max_y = min_y + first.size().height as i32;

    for monitor in &monitors[1..] {
        let position = monitor.position();
        let size = monitor.size();
        min_x = min_x.min(position.x);
        min_y = min_y.min(position.y);
        max_x = max_x.max(position.x + size.width as i32);
        max_y = max_y.max(position.y + size.height as i32);
    }

    canvas
        .set_position(Position::Physical(PhysicalPosition::new(min_x, min_y)))
        .map_err(|error| error.to_string())?;
    canvas
        .set_size(Size::Physical(PhysicalSize::new(
            (max_x - min_x) as u32,
            (max_y - min_y) as u32,
        )))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Raises a window above normal and full-screen apps, and puts it on every Space.
#[cfg(target_os = "macos")]
fn elevate(window: &WebviewWindow, interactive: bool) {
    use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};

    let Ok(handle) = window.ns_window() else {
        return;
    };
    if handle.is_null() {
        return;
    }

    let pointer = handle as usize;
    let level = NSStatusWindowLevel + if interactive { 2 } else { 0 };
    let label = window.label().to_string();
    let label_in_closure = label.clone();
    log::debug!("Elevating {label} to level {level}");
    let result = window.run_on_main_thread(move || {
        let ns_window = unsafe { &*(pointer as *const NSWindow) };
        ns_window.setLevel(level);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.orderFrontRegardless();
        log::debug!("{label_in_closure} is now level {}", ns_window.level());
    });
    if let Err(error) = result {
        log::warn!("Could not elevate {label}: {error}");
    }
}

/// Grows or shrinks the window with the panel, keeping its bottom edge fixed.
pub fn resize(app: &AppHandle, height: f64) -> Result<(), String> {
    let window = overlay_window(app)?;
    let height = height.clamp(OVERLAY_MIN_HEIGHT, OVERLAY_MAX_HEIGHT);

    window
        .set_size(Size::Logical(LogicalSize::new(OVERLAY_WIDTH, height)))
        .map_err(|error| error.to_string())?;
    position(&window, Some(height))
}

/// Bottom-centres the overlay on the screen it is on. `logical_height` is used right after a
/// resize, before the window has reported its new outer size.
fn position(window: &WebviewWindow, logical_height: Option<f64>) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let (width, height) = match logical_height {
        Some(height) => (
            (OVERLAY_WIDTH * scale).round() as i32,
            (height * scale).round() as i32,
        ),
        None => {
            let size = window.outer_size().map_err(|error| error.to_string())?;
            (size.width as i32, size.height as i32)
        }
    };

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let x = monitor_position.x + (monitor_size.width as i32 - width) / 2;
    let y = monitor_position.y + monitor_size.height as i32
        - height
        - (BOTTOM_MARGIN * scale).round() as i32;

    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}
