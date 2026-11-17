use serde::Serialize;
use tauri::State;

use crate::core::storage::Storage;

/// What the UI learns after saving or removing a key: never the key, only a short hint.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyHint {
    /// Last four characters, so two keys are distinguishable without revealing either.
    pub hint: Option<String>,
    /// A key is stored. False after removal.
    pub present: bool,
}

/// Saves a key typed in Settings, replacing any key already stored.
///
/// The hint is derived while the key is in hand, so Settings can display it without reading the
/// key back from the database.
#[tauri::command]
pub fn save_api_key(storage: State<'_, Storage>, api_key: String) -> Result<ApiKeyHint, String> {
    let value = api_key.trim();
    if value.is_empty() {
        return Err("Enter an API key first.".to_string());
    }

    storage.save_api_key(value)?;
    Ok(ApiKeyHint {
        hint: hint_for(value),
        present: true,
    })
}

/// Deletes the stored key so nothing sent to the API can be authenticated.
#[tauri::command]
pub fn remove_api_key(storage: State<'_, Storage>) -> Result<ApiKeyHint, String> {
    storage.remove_api_key()?;
    Ok(ApiKeyHint {
        hint: None,
        present: false,
    })
}

/// Whether Iris has a key.
#[tauri::command]
pub fn has_api_key(storage: State<'_, Storage>) -> bool {
    storage.has_api_key()
}

/// Last four characters, so two keys are distinguishable without revealing either.
fn hint_for(value: &str) -> Option<String> {
    let tail: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    if tail.chars().count() == 4 {
        Some(format!("…{tail}"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::hint_for;

    /// The hint must survive being built from a short or unicode value without panicking.
    #[test]
    fn the_hint_shows_the_last_four_characters() {
        assert_eq!(hint_for("sk-abcdef4f2a"), Some("…4f2a".to_string()));
        assert_eq!(hint_for("abc"), None);
        assert_eq!(hint_for("ключ"), Some("…ключ".to_string()));
    }
}
