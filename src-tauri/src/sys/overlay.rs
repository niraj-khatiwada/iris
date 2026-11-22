use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewWindow,
};

pub const OVERLAY_LABEL: &str = "overlay";
pub const CANVAS_LABEL: &str = "canvas";

static OVERLAY_READY: AtomicBool = AtomicBool::new(false);

const OVERLAY_WIDTH: f64 = 792.0;
/// The visible panel inside the 792px overlay window (16px shadow gutter on each side).
const OVERLAY_PANEL_WIDTH: f64 = OVERLAY_WIDTH - 32.0;
const OVERLAY_MIN_HEIGHT: f64 = 100.0;
const OVERLAY_MAX_HEIGHT: f64 = 720.0;
const BOTTOM_MARGIN: f64 = 96.0;
/// How close the window center must be to the display center to snap and show blue guides.
const SNAP_DISTANCE: f64 = 24.0;
const POSITION_FILE: &str = "overlay-position.json";
const POSITION_WRITE_INTERVAL: Duration = Duration::from_millis(350);

/// The overlay's last position. The bottom edge is kept fixed while the panel grows or shrinks,
/// which is how the quick chat feels anchored to where it was dropped.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
struct OverlayBounds {
    x: i32,
    bottom: i32,
}

/// Screen-space snap guides for the canvas window. `left` and `right` are CSS pixels inside the
/// canvas webview; they mark the centered panel's edges, not the window's current edges.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayGuides {
    left: f64,
    right: f64,
    snapped: bool,
    visible: bool,
}

/// Window position is native state, not conversation data, so it lives in Rust and survives
/// restarts through `overlay-position.json` in the app data directory.
#[derive(Default)]
pub struct OverlayPosition {
    saved: Mutex<Option<OverlayBounds>>,
    last_write: Mutex<Option<Instant>>,
    /// Programmatic placements fire Moved events too; ignore those so they cannot overwrite the
    /// restored position before it is applied.
    suppress_until: Mutex<Option<Instant>>,
}

impl OverlayPosition {
    pub fn load(app: &AppHandle) -> Self {
        let saved = position_path(app)
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<OverlayBounds>(&bytes).ok());

        if let Some(bounds) = saved {
            log::debug!(
                "Restored the Iris overlay position at {} {}",
                bounds.x,
                bounds.bottom
            );
        }

        Self {
            saved: Mutex::new(saved),
            last_write: Mutex::new(None),
            suppress_until: Mutex::new(None),
        }
    }

    fn suppress(&self) {
        *self
            .suppress_until
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(Instant::now() + Duration::from_millis(300));
    }

    fn is_suppressed(&self) -> bool {
        self.suppress_until
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some_and(|until| Instant::now() < until)
    }
}

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

    if let Err(error) = crate::sys::capture::setup(app) {
        log::warn!("Could not prepare the Iris capture panel: {error}");
    }

    if let Err(error) = crate::sys::preview::setup(app) {
        log::warn!("Could not prepare the Iris preview panel: {error}");
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

    // Make the webview first responder before the frontend focuses the textarea, otherwise a
    // re-shown non-activating panel can become key with no caret.
    focus_webview(&window);

    let _ = app.emit(crate::utils::event::OVERLAY_FOCUSED, ());
    Ok(())
}

/// Hands keyboard focus back to the WKWebView. Re-keying a non-activating panel does not restore
/// the webview's first-responder status, so a focused textarea would receive typing but show no
/// caret until the webview itself is first responder again.
#[cfg(target_os = "macos")]
fn focus_webview(window: &WebviewWindow) {
    if let Err(error) = window.with_webview(|webview| {
        use objc2_app_kit::{NSResponder, NSView};

        unsafe {
            let view = webview.inner() as *const NSView;
            if view.is_null() {
                return;
            }
            let Some(ns_window) = (*view).window() else {
                return;
            };
            ns_window.makeFirstResponder(Some(&*(view as *const NSResponder)));
        }
    }) {
        log::warn!("Could not focus the Iris webview: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn focus_webview(window: &WebviewWindow) {
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus the Iris overlay: {error}");
    }
}

/// Shows the overlay above the capture panel without taking key focus, so the capture selection
/// still receives the first drag while Iris remains visible and clickable.
pub fn show_passive(app: &AppHandle) -> Result<(), String> {
    if !OVERLAY_READY.load(Ordering::SeqCst) {
        return Ok(());
    }

    let window = overlay_window(app)?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        if let Ok(panel) = app.get_webview_panel(OVERLAY_LABEL) {
            panel.show();
            return Ok(());
        }
    }

    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    log::debug!("Hiding Iris overlay");
    hide_guides(app);
    persist_position(app);
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

    let visible = overlay_visible(app)?;

    if !visible {
        return show(app);
    }

    // A visible but unfocused overlay is brought forward instead of dismissed. Pressing the
    // summon shortcut again while it is key closes it.
    let focused = overlay_window(app)?
        .is_focused()
        .map_err(|error| error.to_string())?;
    if focused {
        hide(app)
    } else {
        show(app)
    }
}

/// The tray icon is a direct visibility switch: visible hides, hidden shows, regardless of
/// whether the non-activating panel currently has key focus.
pub fn toggle_visible(app: &AppHandle) -> Result<(), String> {
    if !OVERLAY_READY.load(Ordering::SeqCst) {
        return Ok(());
    }

    if overlay_visible(app)? {
        hide(app)
    } else {
        show(app)
    }
}

fn overlay_visible(app: &AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;

        return Ok(app
            .get_webview_panel(OVERLAY_LABEL)
            .map(|panel| panel.is_visible())
            .unwrap_or(false));
    }
    #[cfg(not(target_os = "macos"))]
    {
        overlay_window(app)?
            .is_visible()
            .map_err(|error| error.to_string())
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

/// The x position of a centered overlay on the display it currently occupies.
fn centered_x(window: &WebviewWindow, size: PhysicalSize<u32>) -> Option<(i32, f64)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let target_x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    Some((target_x, monitor.scale_factor()))
}

/// Snaps the overlay to the display center when it is close enough, and returns the x to persist.
fn snap_horizontally(
    app: &AppHandle,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> i32 {
    let Ok(window) = overlay_window(app) else {
        return position.x;
    };
    let Some((target_x, scale)) = centered_x(&window, size) else {
        return position.x;
    };

    if (position.x - target_x).abs() as f64 > SNAP_DISTANCE * scale {
        return position.x;
    }

    if position.x != target_x {
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            target_x, position.y,
        )));
    }
    target_x
}

/// Draws the snap guide lines on the full-screen canvas, mapped into its CSS coordinates.
fn show_guides(app: &AppHandle, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) {
    let Ok(window) = overlay_window(app) else {
        return;
    };
    let Some((target_x, scale)) = centered_x(&window, size) else {
        return;
    };
    let Some(canvas) = app.get_webview_window(CANVAS_LABEL) else {
        return;
    };
    let Ok(canvas_position) = canvas.outer_position() else {
        return;
    };
    let Ok(canvas_scale) = canvas.scale_factor() else {
        return;
    };

    let center = target_x as f64 + size.width as f64 / 2.0;
    let half_panel = OVERLAY_PANEL_WIDTH * scale / 2.0;
    let left = (center - half_panel - canvas_position.x as f64) / canvas_scale;
    let right = (center + half_panel - canvas_position.x as f64) / canvas_scale;

    let _ = app.emit(
        crate::utils::event::OVERLAY_GUIDES,
        OverlayGuides {
            left,
            right,
            snapped: (position.x - target_x).abs() as f64 <= SNAP_DISTANCE * scale,
            visible: true,
        },
    );
}

/// Removes the canvas guides immediately, e.g. when the overlay is hidden.
fn hide_guides(app: &AppHandle) {
    let _ = app.emit(
        crate::utils::event::OVERLAY_GUIDES,
        OverlayGuides {
            left: 0.0,
            right: 0.0,
            snapped: false,
            visible: false,
        },
    );
}

/// Persists the position recorded by the last Moved event.
pub fn persist_position(app: &AppHandle) {
    let Some(state) = app.try_state::<OverlayPosition>() else {
        return;
    };
    let bounds = *state
        .saved
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(bounds) = bounds {
        write_position(app, bounds);
    }
}

/// Records a native window move. Writes are throttled, and `hide`/exit flush the final value.
pub fn record_move(app: &AppHandle, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) {
    if !OVERLAY_READY.load(Ordering::SeqCst) {
        return;
    }

    let Some(state) = app.try_state::<OverlayPosition>() else {
        return;
    };

    if state.is_suppressed() {
        return;
    }

    // Dragging near the horizontal center of the display snaps the panel and turns the guides
    // blue. The canvas draws them at the centered target's edges.
    let x = snap_horizontally(app, position, size);
    show_guides(app, position, size);

    let bounds = OverlayBounds {
        x,
        bottom: position.y + size.height as i32,
    };
    *state
        .saved
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(bounds);

    let mut last_write = state
        .last_write
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if last_write.is_some_and(|instant| instant.elapsed() < POSITION_WRITE_INTERVAL) {
        return;
    }
    *last_write = Some(Instant::now());
    drop(last_write);

    write_position(app, bounds);
}

/// Drops the saved position, e.g. when Iris is reset, so the next show recentres the overlay.
pub fn reset_position(app: &AppHandle) {
    if let Some(state) = app.try_state::<OverlayPosition>() {
        *state
            .saved
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        *state
            .last_write
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        *state
            .suppress_until
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    if let Some(path) = position_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn position_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(POSITION_FILE))
}

fn write_position(app: &AppHandle, bounds: OverlayBounds) {
    let Some(path) = position_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!("Could not create the Iris data directory: {error}");
            return;
        }
    }

    match serde_json::to_vec(&bounds) {
        Ok(json) => {
            if let Err(error) = std::fs::write(&path, json) {
                log::warn!("Could not save the Iris overlay position: {error}");
            }
        }
        Err(error) => log::warn!("Could not encode the Iris overlay position: {error}"),
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

/// Places the overlay at its saved position, or bottom-centres it on the screen it is on.
/// `logical_height` is used right after a resize, before the window has reported its new size.
fn position(window: &WebviewWindow, logical_height: Option<f64>) -> Result<(), String> {
    let scale = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
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

    let saved = window
        .app_handle()
        .try_state::<OverlayPosition>()
        .and_then(|state| {
            *state
                .saved
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        });

    if let Some(bounds) = saved {
        let monitors = window
            .available_monitors()
            .map_err(|error| error.to_string())?;
        let monitor =
            monitor_for_point(&monitors, bounds.x + width / 2, bounds.bottom - height / 2)
                .or_else(|| window.current_monitor().ok().flatten())
                .or_else(|| window.primary_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let monitor_size = monitor.size();
            let monitor_position = monitor.position();
            let min_x = monitor_position.x;
            let max_x = (monitor_position.x + monitor_size.width as i32 - width).max(min_x);
            let min_y = monitor_position.y;
            let max_y = (monitor_position.y + monitor_size.height as i32 - height).max(min_y);
            let x = bounds.x.clamp(min_x, max_x);
            let y = (bounds.bottom - height).clamp(min_y, max_y);

            return place(window, x, y);
        }
    }

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let x = monitor_position.x + (monitor_size.width as i32 - width) / 2;
    let y = monitor_position.y + monitor_size.height as i32
        - height
        - (BOTTOM_MARGIN * scale).round() as i32;

    place(window, x, y)
}

/// Moves the window and suppresses the Moved events caused by this placement.
fn place(window: &WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    if let Some(state) = window.app_handle().try_state::<OverlayPosition>() {
        state.suppress();
    }

    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}

/// Finds the monitor containing a point, so a panel dragged to another display is clamped to it.
fn monitor_for_point(monitors: &[tauri::Monitor], x: i32, y: i32) -> Option<tauri::Monitor> {
    monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            x >= position.x
                && y >= position.y
                && x < position.x + size.width as i32
                && y < position.y + size.height as i32
        })
        .cloned()
}
