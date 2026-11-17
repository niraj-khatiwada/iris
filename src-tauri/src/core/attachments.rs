use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Local attachments live under `<app data>/attachments/<conversation id>/`.
pub const ATTACHMENTS_DIR: &str = "attachments";
const MAX_FILE_BYTES: usize = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES: usize = 12 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachmentFiles {
    /// Original file, relative to the conversation folder.
    pub file_name: String,
    /// Resized JPEG used for sending and thumbnails; images only.
    pub preview_name: Option<String>,
}

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
    Ok(data.join(ATTACHMENTS_DIR))
}

/// The folder is the SQLite conversation id itself. Ids are generated UUIDs, so the only job
/// here is rejecting a value that would escape the attachments root.
pub fn conversation_folder(id: &str) -> Result<String, String> {
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || id.contains('\\')
        || id.contains('\0')
    {
        return Err("Invalid conversation id.".to_string());
    }
    Ok(id.to_string())
}

pub fn conversation_dir(app: &AppHandle, conversation_id: &str) -> Result<PathBuf, String> {
    Ok(root(app)?.join(conversation_folder(conversation_id)?))
}

/// Older builds stored quick-chat files under `iris_quick` (the colon was sanitized) and later
/// under the literal `iris:quick` id. Both are folded into the UUID that now owns the quick chat.
pub fn adopt_quick_folders(app: &AppHandle, target: &str) -> Result<(), String> {
    for legacy in ["iris_quick", "iris:quick"] {
        if legacy != target {
            move_conversation(app, legacy, target)?;
        }
    }
    Ok(())
}

fn sanitize_attachment_id(id: &str) -> String {
    let sanitized = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(64)
        .collect::<String>();
    if sanitized.is_empty() {
        "attachment".to_string()
    } else {
        sanitized
    }
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            value
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .take(12)
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "bin".to_string())
}

fn safe_original_name(name: &str) -> String {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let sanitized = file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('.')
        .to_string();
    let sanitized = if sanitized.is_empty() {
        "attachment".to_string()
    } else {
        sanitized
    };
    sanitized.chars().take(96).collect()
}

/// Writes the original file and, for images, the resized JPEG that is sent to the model.
/// The original is kept for local retrieval; the preview is what later turns attach.
pub fn store(
    app: &AppHandle,
    conversation_id: &str,
    attachment_id: &str,
    name: &str,
    kind: &str,
    original: &[u8],
    preview: Option<&[u8]>,
) -> Result<StoredAttachmentFiles, String> {
    if original.is_empty() {
        return Err("The attachment is empty.".to_string());
    }
    if original.len() > MAX_FILE_BYTES {
        return Err("The attachment is larger than the 100 MB app limit.".to_string());
    }
    if kind == "image" && preview.is_none() {
        return Err("The image preview is missing.".to_string());
    }
    if let Some(preview) = preview {
        if preview.len() > MAX_PREVIEW_BYTES {
            return Err("The image preview is larger than the app limit.".to_string());
        }
    }

    let directory = conversation_dir(app, conversation_id)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the attachments folder: {error}"))?;

    let id = sanitize_attachment_id(attachment_id);
    let file_name = if kind == "image" {
        format!("{id}-original.{}", extension(name))
    } else {
        format!("{id}-{}", safe_original_name(name))
    };
    let original_path = directory.join(&file_name);
    fs::write(&original_path, original)
        .map_err(|error| format!("Could not save the attachment: {error}"))?;

    let preview_name = match (kind, preview) {
        ("image", Some(preview)) => {
            let name = format!("{id}-preview.jpg");
            if let Err(error) = fs::write(directory.join(&name), preview) {
                let _ = fs::remove_file(&original_path);
                return Err(format!("Could not save the image preview: {error}"));
            }
            Some(name)
        }
        _ => None,
    };

    Ok(StoredAttachmentFiles {
        file_name,
        preview_name,
    })
}

/// Resolves a relative attachment name inside its conversation folder, rejecting traversal.
pub fn path_for(
    app: &AppHandle,
    conversation_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name == ".."
        || file_name == "."
    {
        return Err("Invalid attachment name.".to_string());
    }
    let directory = conversation_dir(app, conversation_id)?;
    let path = directory.join(file_name);
    if !path.starts_with(&directory) {
        return Err("Invalid attachment path.".to_string());
    }
    Ok(path)
}

pub fn delete_files(
    app: &AppHandle,
    conversation_id: &str,
    file_names: &[String],
) -> Result<(), String> {
    for file_name in file_names {
        let path = path_for(app, conversation_id, file_name)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not delete {file_name}: {error}")),
        }
    }
    Ok(())
}

pub fn delete_conversation(app: &AppHandle, conversation_id: &str) -> Result<(), String> {
    let directory = conversation_dir(app, conversation_id)?;
    match fs::remove_dir_all(&directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not delete the conversation attachments: {error}"
        )),
    }
}

pub fn delete_all(app: &AppHandle) -> Result<(), String> {
    match fs::remove_dir_all(root(app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not delete the attachments folder: {error}")),
    }
}

/// Moves one conversation's attachments when quick-chat archiving changes its id. The message rows
/// keep only file names, so moving the folder is enough.
pub fn move_conversation(app: &AppHandle, from: &str, to: &str) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    let from_dir = conversation_dir(app, from)?;
    if !from_dir.exists() {
        return Ok(());
    }
    let to_dir = conversation_dir(app, to)?;
    fs::create_dir_all(&to_dir)
        .map_err(|error| format!("Could not create the attachments folder: {error}"))?;

    for entry in fs::read_dir(&from_dir)
        .map_err(|error| format!("Could not read the attachments folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read an attachment: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let target = to_dir.join(entry.file_name());
        if target.exists() {
            fs::remove_file(&target)
                .map_err(|error| format!("Could not replace an attachment: {error}"))?;
        }
        fs::rename(&path, &target)
            .map_err(|error| format!("Could not move an attachment: {error}"))?;
    }

    match fs::remove_dir(&from_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Ok(()), // A non-empty folder is left in place rather than risking data loss.
    }
}

/// Copies an attachment to a user-picked destination for the download action.
pub fn copy_to(
    app: &AppHandle,
    conversation_id: &str,
    file_name: &str,
    destination: &str,
) -> Result<(), String> {
    let source = path_for(app, conversation_id, file_name)?;
    if !source.is_file() {
        return Err("The attachment file is missing.".to_string());
    }
    let mut target = PathBuf::from(destination);
    if target.is_dir() {
        if let Some(name) = source.file_name() {
            target = target.join(name);
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the download folder: {error}"))?;
    }
    fs::copy(&source, &target)
        .map(|_| ())
        .map_err(|error| format!("Could not save the attachment: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{conversation_folder, safe_original_name};

    #[test]
    fn conversation_folders_use_the_sqlite_id() {
        assert_eq!(
            conversation_folder("81035a29-a320-4589-b1b4-d98d4f008f0f").expect("uuid"),
            "81035a29-a320-4589-b1b4-d98d4f008f0f"
        );
        assert_eq!(
            conversation_folder("iris:quick").expect("legacy id"),
            "iris:quick"
        );
        assert!(conversation_folder("../escape/").is_err());
        assert!(conversation_folder("..").is_err());
        assert!(conversation_folder("").is_err());
    }

    #[test]
    fn original_names_strip_paths_and_control_characters() {
        assert_eq!(safe_original_name("../../report.pdf"), "report.pdf");
        assert_eq!(safe_original_name("my file?.md"), "my file_.md");
        assert_eq!(safe_original_name(""), "attachment");
    }
}
