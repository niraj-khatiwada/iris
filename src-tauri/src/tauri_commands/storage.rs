use tauri::State;

use crate::core::storage::{Storage, StoredConversation};

#[tauri::command]
pub fn load_conversations(storage: State<'_, Storage>) -> Result<Vec<StoredConversation>, String> {
    storage.load()
}

#[tauri::command]
pub fn save_conversation(
    storage: State<'_, Storage>,
    conversation: StoredConversation,
) -> Result<(), String> {
    storage.save(&conversation)
}

#[tauri::command]
pub fn save_conversations(
    storage: State<'_, Storage>,
    conversations: Vec<StoredConversation>,
) -> Result<(), String> {
    storage.save_all(&conversations)
}

#[tauri::command]
pub fn delete_conversation(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    storage.delete(&id)
}

#[tauri::command]
pub fn clear_conversations(storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear()
}
