use tauri::{Manager, State};

use crate::core::memory;
use crate::core::storage::{Storage, StoredMemory};

/// Every current memory, newest first. Used by Settings → Memory.
#[tauri::command]
pub fn list_memories(storage: State<'_, Storage>) -> Result<Vec<StoredMemory>, String> {
    storage.list_memories()
}

/// Edits one remembered fact. The edit is marked authoritative so the automatic writer will not
/// overwrite it later.
#[tauri::command]
pub fn update_memory(
    storage: State<'_, Storage>,
    id: String,
    content: String,
) -> Result<(), String> {
    let content = memory::validate_manual_memory(&content)?;
    storage.update_memory(&id, &content)
}

#[tauri::command]
pub fn set_memory_paused(
    storage: State<'_, Storage>,
    id: String,
    paused: bool,
) -> Result<(), String> {
    storage.set_memory_paused(&id, paused)
}

#[tauri::command]
pub fn delete_memory(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    storage.delete_memory(&id)
}

#[tauri::command]
pub fn clear_memories(storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear_memories()
}

/// Reverts the most recent automatically learned batch. Returns how many current memories were
/// removed and restored.
#[tauri::command]
pub fn undo_last_memory_batch(storage: State<'_, Storage>) -> Result<usize, String> {
    storage.undo_last_memory_batch()
}

/// Invalidates memory runs that are waiting for idle or still calling the model, e.g. when the
/// user turns learning off.
#[tauri::command]
pub fn cancel_pending_memory(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<crate::core::memory::MemoryState>() {
        state.cancel_all();
    }
}
