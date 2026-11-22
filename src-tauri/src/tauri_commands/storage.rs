use tauri::{AppHandle, Emitter, State};

use crate::core::attachments;
use crate::core::storage::{
    SearchResults, Storage, StoredAttachment, StoredConversation, StoredConversationSummary,
    StoredMessage, StoredMessagePage, StoredSpokenSummary,
};
use crate::utils::event;

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
pub fn load_spoken_summaries(
    storage: State<'_, Storage>,
    conversation_id: String,
) -> Result<Vec<StoredSpokenSummary>, String> {
    storage.spoken_summaries(&conversation_id)
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
pub fn delete_messages(
    app: AppHandle,
    storage: State<'_, Storage>,
    ids: Vec<String>,
) -> Result<(), String> {
    let files = storage.attachments_for_messages(&ids)?;
    storage.delete_messages(&ids)?;
    for (conversation_id, attachments) in files {
        let names = attachment_file_names(&attachments);
        if let Err(error) = attachments::delete_files(&app, &conversation_id, &names) {
            log::warn!("Could not remove attachment files for deleted messages: {error}");
        }
    }
    Ok(())
}

fn attachment_file_names(attachments: &[StoredAttachment]) -> Vec<String> {
    attachments
        .iter()
        .flat_map(|attachment| {
            [
                attachment.file_name.clone(),
                attachment.preview_name.clone(),
            ]
        })
        .flatten()
        .collect()
}

/// The conversation the quick overlay should show. Every quick chat is a normal UUID
/// conversation; this pointer only selects which one is open in the overlay.
#[tauri::command]
pub fn quick_conversation_id(storage: State<'_, Storage>) -> Result<Option<String>, String> {
    storage.quick_conversation_id()
}

#[tauri::command]
pub fn set_quick_conversation_id(
    storage: State<'_, Storage>,
    id: Option<String>,
) -> Result<(), String> {
    storage.set_quick_conversation_id(id.as_deref())
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
pub fn delete_conversation(
    app: AppHandle,
    storage: State<'_, Storage>,
    id: String,
) -> Result<(), String> {
    // Remove the folder first so a failed delete cannot leave a conversation row that points at
    // missing files.
    attachments::delete_conversation(&app, &id)?;
    storage.delete(&id)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationsDeletedPayload {
    ids: Vec<String>,
}

/// Removes unarchived conversations that contain no messages, excluding the ids the caller is
/// still using. The check runs against SQLite, so an unloaded conversation with older messages is
/// never touched.
#[tauri::command]
pub fn delete_empty_conversations(
    app: AppHandle,
    storage: State<'_, Storage>,
    keep_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let ids = storage.empty_conversation_ids(&keep_ids)?;
    let mut deleted = Vec::new();

    for id in ids {
        // Remove the folder first, matching delete_conversation: a failed cleanup leaves the row
        // intact instead of pointing at missing files.
        if let Err(error) = attachments::delete_conversation(&app, &id) {
            log::warn!("Could not delete empty conversation attachments for {id}: {error}");
            continue;
        }
        if let Err(error) = storage.delete(&id) {
            log::warn!("Could not delete empty conversation {id}: {error}");
            continue;
        }
        deleted.push(id);
    }

    if !deleted.is_empty() {
        let _ = app.emit(
            event::CONVERSATIONS_DELETED,
            ConversationsDeletedPayload {
                ids: deleted.clone(),
            },
        );
    }

    Ok(deleted)
}

#[tauri::command]
pub fn clear_conversations(app: AppHandle, storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear()?;
    attachments::delete_all(&app)?;
    let _ = app.emit(crate::utils::event::CHAT_CLEARED, ());
    Ok(())
}
