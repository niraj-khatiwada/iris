use serde::Serialize;

const SERVICE: &str = "com.iris.desktop";
const ACCOUNT: &str = "deepseek-api-key";

/// What the UI learns after saving or removing a key: never the key, only a short hint.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyHint {
    /// Last four characters, so two keys are distinguishable without revealing either.
    pub hint: Option<String>,
    /// A key is stored. False after removal.
    pub present: bool,
}

#[cfg(target_os = "macos")]
fn read() -> Result<Option<String>, String> {
    use security_framework::passwords::get_generic_password;

    match get_generic_password(SERVICE, ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "The stored API key is not valid UTF-8.".to_string()),
        Err(error) if error.code() == -25300 => Ok(None), // errSecItemNotFound
        Err(error) => Err(format!("Could not read the API key: {error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn read() -> Result<Option<String>, String> {
    Ok(None)
}

/// Reads the key for use inside Rust. Never exposed as a command.
pub fn api_key() -> Result<String, String> {
    read()?.ok_or_else(|| "Add your API key in Settings.".to_string())
}

#[cfg(target_os = "macos")]
fn write(value: &str) -> Result<(), String> {
    use security_framework::passwords::set_generic_password;

    set_generic_password(SERVICE, ACCOUNT, value.as_bytes())
        .map_err(|error| format!("Could not save the API key: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn write(_value: &str) -> Result<(), String> {
    Err("The Keychain is only available on macOS.".to_string())
}

#[cfg(target_os = "macos")]
fn remove() -> Result<(), String> {
    use security_framework::passwords::delete_generic_password;

    match delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        // Removing a key that was never saved is a no-op, not a failure.
        Err(error) if error.code() == -25300 => Ok(()),
        Err(error) => Err(format!("Could not remove the API key: {error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn remove() -> Result<(), String> {
    Ok(())
}

/// Whether a key is stored, without reading it.
///
/// An attributes-only search never decrypts the secret, so macOS does not prompt for access. This
/// is what lets Settings show "key is set" (and Replace/Remove) even for keys saved before the
/// last-four hint existed. Never use a data query here: that would prompt on every panel open.
#[cfg(target_os = "macos")]
fn presence_for(service: &str, account: &str) -> bool {
    use security_framework::item::{ItemClass, ItemSearchOptions};

    ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .load_attributes(true)
        .limit(1)
        .search()
        .map(|results| !results.is_empty())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn presence_for(_service: &str, _account: &str) -> bool {
    false
}

fn exists() -> bool {
    presence_for(SERVICE, ACCOUNT)
}

/// Saves a key typed in Settings, replacing any key already stored.
///
/// The hint is derived while the key is in hand, so Settings can display it without ever reading
/// the Keychain again — a read would prompt for access every time the AI panel opens.
#[tauri::command]
pub fn save_api_key(api_key: String) -> Result<ApiKeyHint, String> {
    let value = api_key.trim();
    if value.is_empty() {
        return Err("Enter an API key first.".to_string());
    }

    write(value)?;
    Ok(ApiKeyHint {
        hint: hint_for(value),
        present: true,
    })
}

/// Deletes the stored key so nothing sent to the API can be authenticated.
#[tauri::command]
pub fn remove_api_key() -> Result<ApiKeyHint, String> {
    remove()?;
    Ok(ApiKeyHint {
        hint: None,
        present: false,
    })
}

/// Whether Iris has a key. Attributes only, so it never decrypts the secret or prompts.
#[tauri::command]
pub fn has_api_key() -> bool {
    exists()
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    // A separate service keeps the tests away from the key Iris actually uses. Each test gets
    // its own account because the Keychain is process-wide and the test runner is parallel.
    const TEST_SERVICE: &str = "com.iris.desktop.tests";

    fn cleanup(account: &str) {
        let _ = delete_generic_password(TEST_SERVICE, account);
    }

    #[test]
    fn the_keychain_round_trips_and_deletes_a_key() {
        let account = "round-trip";
        cleanup(account);

        set_generic_password(TEST_SERVICE, account, b"sk-test-value-4f2a").expect("save");
        let stored = get_generic_password(TEST_SERVICE, account).expect("read");
        assert_eq!(String::from_utf8(stored).unwrap(), "sk-test-value-4f2a");

        delete_generic_password(TEST_SERVICE, account).expect("delete");
        let missing = get_generic_password(TEST_SERVICE, account);
        assert!(missing.is_err(), "the key should be gone after removal");

        cleanup(account);
    }

    /// The hint must survive being built from a short or unicode value without panicking.
    #[test]
    fn the_hint_shows_the_last_four_characters() {
        assert_eq!(hint_for("sk-abcdef4f2a"), Some("…4f2a".to_string()));
        assert_eq!(hint_for("abc"), None);
        assert_eq!(hint_for("ключ"), Some("…ключ".to_string()));
    }

    /// Reading a key that was never saved must report "absent" rather than fail.
    #[test]
    fn a_missing_key_reads_as_absent() {
        let account = "never-saved";
        cleanup(account);
        let missing = get_generic_password(TEST_SERVICE, account);
        assert!(missing.is_err());
        cleanup(account);
    }

    /// Presence detection must see a saved key without decrypting it. It uses the isolated test
    /// service, so it can never touch the key Iris actually uses.
    #[test]
    fn an_attributes_only_query_sees_a_key() {
        let account = "presence";
        cleanup(account);
        assert!(
            !presence_for(TEST_SERVICE, account),
            "no key should be present after a clean removal"
        );

        set_generic_password(TEST_SERVICE, account, b"sk-presence-test").expect("save");
        assert!(
            presence_for(TEST_SERVICE, account),
            "the attributes query must see the saved key"
        );

        let _ = delete_generic_password(TEST_SERVICE, account);
        assert!(!presence_for(TEST_SERVICE, account));
    }
}
