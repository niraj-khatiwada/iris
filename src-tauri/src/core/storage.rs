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

        let connection = Connection::open(directory.join("iris.db"))
            .map_err(|error| format!("Could not open the Iris database: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        prepare(&connection)?;

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
        connection
            .execute("DELETE FROM conversations", [])
            .map_err(|error| error.to_string())?;
        // Rebuild the file and drop old WAL frames so a cleared conversation is not recoverable.
        connection
            .execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| error.to_string())?;
        Ok(())
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

    /// Drops every credential row. Used by Reset Iris; Clear conversations leaves the key alone.
    pub fn clear_credentials(&self) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute("DELETE FROM credential", [])
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// Creates the current schema and upgrades databases written by older builds.
fn prepare(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                    REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                attachments TEXT
            );

            CREATE INDEX IF NOT EXISTS messages_by_conversation
                ON messages(conversation_id, created_at);

            CREATE TABLE IF NOT EXISTS credential (
                name TEXT PRIMARY KEY,
                api_key TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| format!("Could not prepare the Iris database: {error}"))?;

    // Older databases predate archiving and image attachments.
    if !has_column(connection, "conversations", "archived_at")? {
        connection
            .execute(
                "ALTER TABLE conversations ADD COLUMN archived_at INTEGER",
                [],
            )
            .map_err(|error| format!("Could not add conversation archiving: {error}"))?;
    }
    if !has_column(connection, "messages", "attachments")? {
        connection
            .execute("ALTER TABLE messages ADD COLUMN attachments TEXT", [])
            .map_err(|error| format!("Could not add message attachments: {error}"))?;
    }

    Ok(())
}

fn now_ms() -> i64 {    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(columns.iter().any(|name| name == column))
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
    use super::{prepare, Storage};
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// An in-memory database keeps the credential tests away from the real iris.db.
    fn storage() -> Storage {
        let connection = Connection::open_in_memory().expect("open an in-memory database");
        prepare(&connection).expect("create the schema");
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

        storage.clear_credentials().expect("clear credentials");
        assert!(!storage.has_api_key());
    }
}
