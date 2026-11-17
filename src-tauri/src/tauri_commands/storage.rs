use tauri::{AppHandle, Emitter, State};

use crate::core::storage::{
    SearchResults, Storage, StoredConversation, StoredConversationSummary, StoredMessage,
    StoredMessagePage,
};

#[tauri::command]
pub fn load_conversations(
    storage: State<'_, Storage>,
) -> Result<Vec<StoredConversationSummary>, String> {
    storage.load()
}

#[tauri::command]
pub fn load_message_page(
    storage: State<'_, Storage>,
    conversation_id: String,
    before: Option<String>,
    limit: usize,
) -> Result<StoredMessagePage, String> {
    storage.load_message_page(&conversation_id, before.as_deref(), limit)
}

#[tauri::command]
pub fn search_history(
    storage: State<'_, Storage>,
    query: String,
    limit: Option<usize>,
) -> Result<SearchResults, String> {
    storage.search(&query, limit.unwrap_or(50))
}

#[tauri::command]
pub fn save_conversation_meta(
    storage: State<'_, Storage>,
    conversation: StoredConversationSummary,
) -> Result<(), String> {
    storage.save_summary(&conversation)
}

#[tauri::command]
pub fn save_message(
    storage: State<'_, Storage>,
    conversation_id: String,
    message: StoredMessage,
) -> Result<(), String> {
    storage.save_message(&conversation_id, &message)
}

#[tauri::command]
pub fn delete_messages(storage: State<'_, Storage>, ids: Vec<String>) -> Result<(), String> {
    storage.delete_messages(&ids)
}

#[tauri::command]
pub fn move_conversation_messages(
    storage: State<'_, Storage>,
    from: String,
    to: String,
) -> Result<(), String> {
    storage.move_conversation_messages(&from, &to)
}

#[tauri::command]
pub fn restore_quick_conversation(
    storage: State<'_, Storage>,
    quick: String,
    previous: String,
    retired: Option<String>,
) -> Result<(), String> {
    storage.restore_quick_conversation(&quick, &previous, retired.as_deref())
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
pub fn clear_conversations(app: AppHandle, storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear()?;
    let _ = app.emit(crate::utils::event::CHAT_CLEARED, ());
    Ok(())
}
