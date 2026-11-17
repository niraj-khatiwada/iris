use base64::Engine;
use tauri::AppHandle;

use crate::core::attachments::{self, StoredAttachmentFiles};

fn decode(value: String) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(value.as_bytes())
        .map_err(|_| "The attachment data is invalid.".to_string())
}

/// Writes the original attachment, plus the resized image preview, into the conversation folder.
#[tauri::command]
pub async fn store_attachment(
    app: AppHandle,
    conversation_id: String,
    attachment_id: String,
    name: String,
    kind: String,
    original_data: String,
    preview_data: Option<String>,
) -> Result<StoredAttachmentFiles, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let original = decode(original_data)?;
        let preview = preview_data.map(decode).transpose()?;
        attachments::store(
            &app,
            &conversation_id,
            &attachment_id,
            &name,
            &kind,
            &original,
            preview.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Could not save the attachment: {error}"))?
}

/// Absolute path used by the asset protocol to display a stored image.
#[tauri::command]
pub fn attachment_path(
    app: AppHandle,
    conversation_id: String,
    file_name: String,
) -> Result<String, String> {
    let path = attachments::path_for(&app, &conversation_id, &file_name)?;
    if !path.is_file() {
        return Err("The attachment file is missing.".to_string());
    }
    Ok(path.to_string_lossy().to_string())
}

/// Fallback for environments where the asset protocol cannot serve a stored image.
#[tauri::command]
pub fn attachment_data_url(
    app: AppHandle,
    conversation_id: String,
    file_name: String,
    media_type: String,
) -> Result<String, String> {
    let path = attachments::path_for(&app, &conversation_id, &file_name)?;
    let bytes =
        std::fs::read(path).map_err(|error| format!("Could not read the attachment: {error}"))?;
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{media_type};base64,{data}"))
}

/// Copies a stored attachment to the destination chosen in the save dialog.
#[tauri::command]
pub async fn copy_attachment(
    app: AppHandle,
    conversation_id: String,
    file_name: String,
    destination: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments::copy_to(&app, &conversation_id, &file_name, &destination)
    })
    .await
    .map_err(|error| format!("Could not save the attachment: {error}"))?
}

/// Removes draft files that were stored but never sent.
#[tauri::command]
pub fn delete_attachment_files(
    app: AppHandle,
    conversation_id: String,
    file_names: Vec<String>,
) -> Result<(), String> {
    attachments::delete_files(&app, &conversation_id, &file_names)
}
