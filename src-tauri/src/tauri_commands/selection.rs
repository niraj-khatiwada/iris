use tauri::{AppHandle, State};

use crate::core::storage::{SelectionMetadata, Storage};

/// Whether Iris already has macOS Accessibility access for reading and replacing selections.
#[tauri::command]
pub fn get_selection_permission() -> bool {
    crate::sys::selection::has_permission()
}

/// Shows the macOS Accessibility prompt. macOS only presents the system prompt once; when access
/// was denied before, `open_selection_settings` is the recovery path.
#[tauri::command]
pub fn request_selection_permission() -> bool {
    crate::sys::selection::prompt_for_permission()
}

#[tauri::command]
pub fn open_selection_settings() -> Result<(), String> {
    crate::sys::selection::open_settings()
}

/// Replaces the captured selection with the reply the user approved. The frontend hides the
/// overlay after this succeeds, leaving the source app in front.
#[tauri::command]
pub async fn replace_selection(app: AppHandle, text: String) -> Result<(), String> {
    crate::sys::selection::replace(app, text).await
}

#[tauri::command]
pub async fn paste_selection(app: AppHandle, text: String) -> Result<(), String> {
    crate::sys::selection::paste(app, text).await
}

/// Persists where a selection action came from and what it asked Iris to do. The selected text
/// itself is already the user message; this is the durable provenance record.
#[tauri::command]
pub fn save_selection_metadata(
    storage: State<'_, Storage>,
    metadata: SelectionMetadata,
) -> Result<(), String> {
    storage.save_selection_metadata(&metadata)
}

/// Selection provenance for one conversation, available for a future source badge in History.
#[tauri::command]
pub fn load_selection_metadata(
    storage: State<'_, Storage>,
    conversation_id: String,
) -> Result<Vec<SelectionMetadata>, String> {
    storage.selection_metadata(&conversation_id)
}
