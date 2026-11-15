use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// The default summon shortcut: Command+Space on macOS.
pub const DEFAULT_OPEN_SHORTCUT: &str = "commandorcontrol+space";

/// Tracks the single global shortcut Iris currently owns so a new choice can replace it without
/// leaving an invisible second binding behind.
#[derive(Default)]
pub struct ShortcutState {
    current: Mutex<Option<String>>,
}

impl ShortcutState {
    pub fn new(current: Option<String>) -> Self {
        Self {
            current: Mutex::new(current),
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
    let next = shortcut.trim().to_lowercase();
    if next.is_empty() {
        return Err("Choose a shortcut first.".to_string());
    }

    let mut current = state
        .current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if current.as_deref() == Some(next.as_str()) {
        return Ok(());
    }

    let previous = current.clone();
    let manager = app.global_shortcut();

    if let Some(previous_shortcut) = previous.as_deref() {
        let _ = manager.unregister(previous_shortcut);
    }

    match manager.register(next.as_str()) {
        Ok(()) => {
            *current = Some(next);
            Ok(())
        }
        Err(error) => {
            if let Some(previous_shortcut) = previous.as_deref() {
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
