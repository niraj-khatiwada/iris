use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
                    error TEXT
                );

                CREATE INDEX IF NOT EXISTS messages_by_conversation
                    ON messages(conversation_id, created_at);
                ",
            )
            .map_err(|error| format!("Could not prepare the Iris database: {error}"))?;

        // Older databases predate archiving.
        let has_archived_at = connection
            .prepare("PRAGMA table_info(conversations)")
            .and_then(|mut statement| {
                let columns = statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(columns.iter().any(|column| column == "archived_at"))
            })
            .map_err(|error| error.to_string())?;
        if !has_archived_at {
            connection
                .execute(
                    "ALTER TABLE conversations ADD COLUMN archived_at INTEGER",
                    [],
                )
                .map_err(|error| format!("Could not add conversation archiving: {error}"))?;
        }

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
                    (id, conversation_id, role, content, created_at, status, error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    message.id,
                    conversation.id,
                    message.role,
                    message.content,
                    message.created_at,
                    message.status,
                    message.error
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
            "SELECT id, role, content, created_at, status, error
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
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(messages)
}
