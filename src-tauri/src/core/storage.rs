use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub attachments: Vec<StoredAttachment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub archived_at: Option<i64>,
    pub messages: Vec<StoredMessage>,
}

/// The single credential row Iris uses for every outbound request. The keys are provider-neutral,
/// so one row covers chat, read-aloud, and voice input.
const API_KEY_CREDENTIAL: &str = "api-key";

/// SQLite-backed conversation storage shared by the overlay and history windows.
pub struct Storage {
    connection: Mutex<Connection>,
}

impl Storage {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Could not create the app data directory: {error}"))?;

        let mut connection = Connection::open(directory.join("iris.db"))
            .map_err(|error| format!("Could not open the Iris database: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        // WAL is a property of the file; foreign keys are a property of each connection, so the
        // key check is re-enabled after the migrations have run.
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;")
            .map_err(|error| format!("Could not prepare the Iris database: {error}"))?;
        crate::core::migrations::prepare(&mut connection)?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| format!("Could not prepare the Iris database: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn load(&self) -> Result<Vec<StoredConversation>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let mut statement = connection
            .prepare(
                "SELECT id, title, created_at, updated_at, archived_at
                 FROM conversations
                 ORDER BY updated_at DESC",
            )
            .map_err(|error| error.to_string())?;

        let mut conversations = statement
            .query_map([], |row| {
                Ok(StoredConversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    archived_at: row.get(4)?,
                    messages: Vec::new(),
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        for conversation in &mut conversations {
            conversation.messages = messages_for(&connection, &conversation.id)?;
        }

        Ok(conversations)
    }

    pub fn save(&self, conversation: &StoredConversation) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        save_in_transaction(&transaction, conversation)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn save_all(&self, conversations: &[StoredConversation]) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for conversation in conversations {
            save_in_transaction(&transaction, conversation)?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Messages cascade from their conversation when foreign keys are on. Deleting both
        // explicitly keeps Clear correct even on a connection where the pragma was never applied.
        connection
            .execute_batch("DELETE FROM messages; DELETE FROM conversations;")
            .map_err(|error| error.to_string())?;
        // Rebuild the file and drop old WAL frames so a cleared conversation is not recoverable.
        connection
            .execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Drops the schema and immediately rebuilds an empty one from the migration files, so the
    /// running app remains usable and the next window reload starts fresh. Reset Iris uses this
    /// instead of `clear`, because a cleared-but-still-versioned file would look migrated while
    /// missing whatever a later migration adds.
    pub fn reset_schema(&self) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::core::migrations::reset(&connection)?;
        crate::core::migrations::upgrade(&mut connection)
    }

    /// Reads the stored API key. `Ok(None)` means no key has been saved yet.
    pub fn api_key(&self) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        match connection.query_row(
            "SELECT api_key FROM credential WHERE name = ?1",
            params![API_KEY_CREDENTIAL],
            |row| row.get::<_, String>(0),
        ) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("Could not read the API key: {error}")),
        }
    }

    /// The key every outbound request is authenticated with.
    pub fn require_api_key(&self) -> Result<String, String> {
        self.api_key()?
            .ok_or_else(|| "Add your API key in Settings.".to_string())
    }

    /// Whether a key is stored. Used by Settings so it can offer Replace/Remove.
    pub fn has_api_key(&self) -> bool {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row(
                "SELECT 1 FROM credential WHERE name = ?1",
                params![API_KEY_CREDENTIAL],
                |_| Ok(()),
            )
            .is_ok()
    }

    /// Saves the key, replacing any key already stored.
    pub fn save_api_key(&self, value: &str) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "INSERT INTO credential (name, api_key, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(name) DO UPDATE SET
                    api_key = excluded.api_key,
                    updated_at = excluded.updated_at",
                params![API_KEY_CREDENTIAL, value, now_ms()],
            )
            .map_err(|error| format!("Could not save the API key: {error}"))?;
        Ok(())
    }

    /// Removes the stored key so nothing sent to the API can be authenticated.
    pub fn remove_api_key(&self) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "DELETE FROM credential WHERE name = ?1",
                params![API_KEY_CREDENTIAL],
            )
            .map_err(|error| format!("Could not remove the API key: {error}"))?;
        Ok(())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn attachments_json(attachments: &[StoredAttachment]) -> Result<Option<String>, String> {
    if attachments.is_empty() {
        return Ok(None);
    }

    serde_json::to_string(attachments)
        .map(Some)
        .map_err(|error| format!("Could not encode message attachments: {error}"))
}

fn attachments_from(value: Option<String>) -> Vec<StoredAttachment> {
    value
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save_in_transaction(
    transaction: &Transaction<'_>,
    conversation: &StoredConversation,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                archived_at = excluded.archived_at",
            params![
                conversation.id,
                conversation.title,
                conversation.created_at,
                conversation.updated_at,
                conversation.archived_at
            ],
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![conversation.id],
        )
        .map_err(|error| error.to_string())?;

    for message in &conversation.messages {
        transaction
            .execute(
                "INSERT INTO messages
                    (id, conversation_id, role, content, created_at, status, error, attachments)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    message.id,
                    conversation.id,
                    message.role,
                    message.content,
                    message.created_at,
                    message.status,
                    message.error,
                    attachments_json(&message.attachments)?
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn messages_for(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<StoredMessage>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, role, content, created_at, status, error, attachments
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|error| error.to_string())?;

    let messages = statement
        .query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                status: row.get(4)?,
                error: row.get(5)?,
                attachments: attachments_from(row.get(6)?),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::Storage;
    use crate::core::migrations::upgrade;
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// An in-memory database keeps the credential tests away from the real iris.db.
    fn storage() -> Storage {
        let mut connection = Connection::open_in_memory().expect("open an in-memory database");
        upgrade(&mut connection).expect("create the schema");
        Storage {
            connection: Mutex::new(connection),
        }
    }

    #[test]
    fn the_api_key_round_trips_and_is_removed() {
        let storage = storage();
        assert!(!storage.has_api_key());
        assert_eq!(storage.api_key().expect("read"), None);
        assert!(storage.require_api_key().is_err());

        storage.save_api_key("sk-first").expect("save");
        assert!(storage.has_api_key());
        assert_eq!(
            storage.api_key().expect("read").as_deref(),
            Some("sk-first")
        );

        // Saving again replaces the row instead of adding a second credential.
        storage.save_api_key("sk-second").expect("replace");
        assert_eq!(
            storage.api_key().expect("read").as_deref(),
            Some("sk-second")
        );

        storage.remove_api_key().expect("remove");
        assert!(!storage.has_api_key());
        assert_eq!(storage.api_key().expect("read"), None);
    }

    #[test]
    fn clearing_conversations_keeps_the_key_but_reset_removes_it() {
        let storage = storage();
        storage.save_api_key("sk-keep").expect("save");

        storage.clear().expect("clear conversations");
        assert!(storage.has_api_key());

        // Reset Iris drops the schema, so the key goes with it.
        storage.reset_schema().expect("reset the schema");
        assert!(!storage.has_api_key());
    }

    /// Reset rebuilds the schema immediately, so the running app is still usable during the
    /// reload and a later launch finds a modern, empty database.
    #[test]
    fn resetting_rebuilds_an_empty_database_that_still_works() {
        let storage = storage();
        storage.save_api_key("sk-old").expect("save");
        storage.reset_schema().expect("reset");

        assert!(!storage.has_api_key());
        assert!(storage.load().expect("load after reset").is_empty());

        storage.save_api_key("sk-new").expect("save after reset");
        assert!(storage.has_api_key());
    }
}
