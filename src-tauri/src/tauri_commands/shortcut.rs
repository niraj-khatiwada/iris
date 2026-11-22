use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// The default summon shortcut: Command+Space on macOS.
pub const DEFAULT_OPEN_SHORTCUT: &str = "commandorcontrol+space";
/// The default selection action shortcut, tried from any app with text selected.
pub const DEFAULT_SELECTION_SHORTCUT: &str = "commandorcontrol+shift+space";
/// The default full-screen ask shortcut.
pub const DEFAULT_SCREEN_ASK_SHORTCUT: &str = "commandorcontrol+shift+keya";

/// Tracks the global shortcuts Iris currently owns so a new choice can replace one without
/// leaving an invisible binding behind.
#[derive(Default)]
pub struct ShortcutState {
    open: Mutex<Option<Shortcut>>,
    selection: Mutex<Option<Shortcut>>,
    screen_ask: Mutex<Option<Shortcut>>,
}

impl ShortcutState {
    pub fn new(
        open: Option<Shortcut>,
        selection: Option<Shortcut>,
        screen_ask: Option<Shortcut>,
    ) -> Self {
        Self {
            open: Mutex::new(open),
            selection: Mutex::new(selection),
            screen_ask: Mutex::new(screen_ask),
        }
    }

    pub fn is_open(&self, shortcut: &Shortcut) -> bool {
        self.open
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|current| current == shortcut)
    }

    pub fn is_selection(&self, shortcut: &Shortcut) -> bool {
        self.selection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|current| current == shortcut)
    }

    pub fn is_screen_ask(&self, shortcut: &Shortcut) -> bool {
        self.screen_ask
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|current| current == shortcut)
    }
}

fn replace_shortcut(
    app: &AppHandle,
    slot: &Mutex<Option<Shortcut>>,
    shortcut: &str,
) -> Result<(), String> {
    let next = Shortcut::from_str(shortcut.trim())
        .map_err(|error| format!("That shortcut is not valid: {error}"))?;

    let previous = *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if previous == Some(next) {
        return Ok(());
    }

    let manager = app.global_shortcut();

    if let Some(previous_shortcut) = previous {
        let _ = manager.unregister(previous_shortcut);
    }

    match manager.register(next) {
        Ok(()) => {
            *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(next);
            Ok(())
        }
        Err(error) => {
            if let Some(previous_shortcut) = previous {
                if let Err(restore_error) = manager.register(previous_shortcut) {
                    log::warn!(
                        "Could not restore global shortcut {previous_shortcut}: {restore_error}"
                    );
                }
            }
            Err(format!(
                "That shortcut is not available on this Mac: {error}"
            ))
        }
    }
}

/// Replaces the shortcut that opens the quick overlay. If the new one is unavailable (another app
/// already owns it), the previous binding is restored and the error is returned to Settings.
#[tauri::command]
pub fn set_open_shortcut(
    app: AppHandle,
    state: State<'_, ShortcutState>,
    shortcut: String,
) -> Result<(), String> {
    replace_shortcut(&app, &state.open, &shortcut)
}

/// Replaces the global shortcut that captures the current text selection.
#[tauri::command]
pub fn set_selection_shortcut(
    app: AppHandle,
    state: State<'_, ShortcutState>,
    shortcut: String,
) -> Result<(), String> {
    replace_shortcut(&app, &state.selection, &shortcut)
}

/// Replaces the global shortcut that captures the whole display for a quick question.
#[tauri::command]
pub fn set_screen_ask_shortcut(
    app: AppHandle,
    state: State<'_, ShortcutState>,
    shortcut: String,
) -> Result<(), String> {
    replace_shortcut(&app, &state.screen_ask, &shortcut)
}
