use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    /// Inline image data URL for legacy messages. New attachments use local files.
    #[serde(default)]
    pub data_url: String,
    /// Original file inside `<app data>/attachments/<conversation>/`.
    #[serde(default)]
    pub file_name: Option<String>,
    /// Resized image JPEG used for sending and thumbnails.
    #[serde(default)]
    pub preview_name: Option<String>,
    /// Reused across later turns instead of uploading the document again.
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
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
    /// JSON metadata for future analysis; assistant replies store the model used.
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
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

/// Sidebar metadata without messages; the message list fetches pages separately.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub archived_at: Option<i64>,
}

/// One cached spoken summary for an assistant message, used by the history window's summary view.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSpokenSummary {
    pub message_id: String,
    pub summary: String,
}

/// Provenance for one selection action. The selected text is in the user message; this is the
/// durable record of where it came from and what the user asked Iris to do with it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionMetadata {
    pub message_id: String,
    pub conversation_id: String,
    pub source_app: String,
    #[serde(default)]
    pub source_bundle_id: Option<String>,
    pub source_pid: i32,
    pub action: String,
    pub character_count: usize,
    pub truncated: bool,
    pub from_clipboard: bool,
}

/// One page of messages, oldest-first, plus the cursor needed to load the page before it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessagePage {
    pub messages: Vec<StoredMessage>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

/// A conversation whose title matched the search query.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConversationHit {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub archived: bool,
}

/// A message whose body matched the query, with enough context to render one result row.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMessageHit {
    pub conversation_id: String,
    pub conversation_title: String,
    pub message_id: String,
    pub role: String,
    pub snippet: String,
    pub created_at: i64,
    pub archived: bool,
}

/// Title matches and message matches are kept separate so the sidebar can group them.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub conversations: Vec<SearchConversationHit>,
    pub messages: Vec<SearchMessageHit>,
}

/// The single credential row Iris uses for every outbound request. The keys are provider-neutral,
/// so one row covers chat, read-aloud, and voice input.
const API_KEY_CREDENTIAL: &str = "api-key";
/// The conversation the quick overlay is currently showing. Every quick chat is a normal UUID
/// conversation; this key only remembers which one the overlay should open next.
const QUICK_CONVERSATION_META: &str = "quick-conversation";
/// Older builds used one fixed row for the quick overlay. `Storage::open` renames it once.
const LEGACY_QUICK_CONVERSATION_ID: &str = "iris:quick";

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

        let storage = Self {
            connection: Mutex::new(connection),
        };
        // The quick overlay used to share one fixed `iris:quick` conversation. Give it a real UUID
        // and move its attachments folder before inline images are migrated into that folder.
        if let Err(error) = storage.migrate_quick_conversation(app) {
            log::warn!("Could not migrate the quick conversation: {error}");
        }
        // Older builds kept resized images inline. Move them to the conversation folders so the
        // new asset URLs, downloads, and per-conversation deletion work for existing history too.
        if let Err(error) = storage.migrate_inline_images(app) {
            log::warn!("Could not migrate inline image attachments: {error}");
        }
        Ok(storage)
    }

    /// Gives a pre-UUID `iris:quick` row a generated conversation id and remembers that id in
    /// `app_meta`. Runs once; later launches only make sure any leftover legacy folder is folded
    /// into the current quick conversation.
    fn migrate_quick_conversation(&self, app: &AppHandle) -> Result<(), String> {
        let current = self.quick_conversation_id()?;
        if let Some(current) = current {
            crate::core::attachments::adopt_quick_folders(app, &current)?;
            return Ok(());
        }

        let new_id = uuid::Uuid::new_v4().to_string();
        if !self.rename_legacy_quick_conversation(&new_id)? {
            return Ok(());
        }
        crate::core::attachments::adopt_quick_folders(app, &new_id)?;
        Ok(())
    }

    /// Moves the fixed legacy quick row (and its messages) onto a new id. Returns false when
    /// there is no legacy row, which makes the migration safe to run on every launch.
    fn rename_legacy_quick_conversation(&self, new_id: &str) -> Result<bool, String> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM conversations WHERE id = ?1)",
                params![LEGACY_QUICK_CONVERSATION_ID],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Ok(false);
        }

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO conversations (id, title, created_at, updated_at, archived_at)
                 SELECT ?1, title, created_at, updated_at, archived_at
                 FROM conversations WHERE id = ?2",
                params![new_id, LEGACY_QUICK_CONVERSATION_ID],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE messages SET conversation_id = ?1 WHERE conversation_id = ?2",
                params![new_id, LEGACY_QUICK_CONVERSATION_ID],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM conversations WHERE id = ?1",
                params![LEGACY_QUICK_CONVERSATION_ID],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO app_meta (name, value) VALUES (?1, ?2)
                 ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                params![QUICK_CONVERSATION_META, new_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(true)
    }

    /// The conversation the quick overlay should open. `None` means the overlay still needs to
    /// create one.
    pub fn quick_conversation_id(&self) -> Result<Option<String>, String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row(
                "SELECT value FROM app_meta WHERE name = ?1",
                params![QUICK_CONVERSATION_META],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    /// Remembers the overlay's current conversation. Passing `None` clears the pointer.
    pub fn set_quick_conversation_id(&self, id: Option<&str>) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match id {
            Some(id) => connection
                .execute(
                    "INSERT INTO app_meta (name, value) VALUES (?1, ?2)
                     ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                    params![QUICK_CONVERSATION_META, id],
                )
                .map(|_| ())
                .map_err(|error| error.to_string()),
            None => connection
                .execute(
                    "DELETE FROM app_meta WHERE name = ?1",
                    params![QUICK_CONVERSATION_META],
                )
                .map(|_| ())
                .map_err(|error| error.to_string()),
        }
    }

    /// One-time (idempotent) move of legacy data URLs into the local attachment store. The old
    /// data is the resized JPEG, so it becomes both the original and the preview file.
    fn migrate_inline_images(&self, app: &AppHandle) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let rows = {
            let mut statement = connection
                .prepare(
                    "SELECT id, conversation_id, attachments FROM messages
                     WHERE attachments LIKE '%dataUrl%'",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };

        for (message_id, conversation_id, json) in rows {
            let mut attachments: Vec<StoredAttachment> =
                serde_json::from_str(&json).unwrap_or_default();
            let mut changed = false;
            for attachment in &mut attachments {
                if attachment.file_name.is_some() || attachment.data_url.is_empty() {
                    continue;
                }
                let Some((media_type, data)) = attachment.data_url.split_once(";base64,") else {
                    continue;
                };
                let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) else {
                    continue;
                };
                if bytes.is_empty() {
                    continue;
                }
                let extension = if media_type.contains("png") {
                    "png"
                } else if media_type.contains("webp") {
                    "webp"
                } else {
                    "jpg"
                };
                let disk_name = format!("image.{extension}");
                match crate::core::attachments::store(
                    app,
                    &conversation_id,
                    &attachment.id,
                    &disk_name,
                    "image",
                    &bytes,
                    Some(&bytes),
                ) {
                    Ok(files) => {
                        attachment.data_url.clear();
                        attachment.file_name = Some(files.file_name);
                        attachment.preview_name = files.preview_name;
                        attachment.size = Some(bytes.len() as u64);
                        changed = true;
                    }
                    Err(error) => {
                        log::warn!(
                            "Could not move inline image {} to the attachment store: {error}",
                            attachment.id
                        );
                    }
                }
            }
            if changed {
                let json =
                    serde_json::to_string(&attachments).map_err(|error| error.to_string())?;
                connection
                    .execute(
                        "UPDATE messages SET attachments = ?1 WHERE id = ?2",
                        params![json, message_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    pub fn load(&self) -> Result<Vec<StoredConversationSummary>, String> {
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

        let conversations = statement
            .query_map([], |row| {
                Ok(StoredConversationSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    archived_at: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(conversations)
    }

    /// Loads one page of messages, oldest first. `before` is the cursor returned by the previous
    /// page; the initial page passes `None` and gets the newest messages.
    pub fn load_message_page(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        limit: usize,
    ) -> Result<StoredMessagePage, String> {
        let limit = limit.clamp(1, 500) as i64;
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let mut rows: Vec<(StoredMessage, i64)>;
        if let Some(cursor) = before {
            let (created_at, rowid) = parse_cursor(cursor)?;
            let mut statement = connection
                .prepare(
                    "SELECT rowid, id, role, content, created_at, status, error, attachments,
                            metadata
                     FROM messages
                     WHERE conversation_id = ?1
                       AND (created_at < ?2 OR (created_at = ?2 AND rowid < ?3))
                     ORDER BY created_at DESC, rowid DESC
                     LIMIT ?4",
                )
                .map_err(|error| error.to_string())?;
            rows = statement
                .query_map(
                    params![conversation_id, created_at, rowid, limit + 1],
                    row_from_page,
                )
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
        } else {
            let mut statement = connection
                .prepare(
                    "SELECT rowid, id, role, content, created_at, status, error, attachments,
                            metadata
                     FROM messages
                     WHERE conversation_id = ?1
                     ORDER BY created_at DESC, rowid DESC
                     LIMIT ?2",
                )
                .map_err(|error| error.to_string())?;
            rows = statement
                .query_map(params![conversation_id, limit + 1], row_from_page)
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
        }

        let has_more = rows.len() as i64 > limit;
        rows.truncate(limit as usize);
        let next_cursor = if has_more {
            rows.last()
                .map(|(message, rowid)| format!("{}:{}", message.created_at, rowid))
        } else {
            None
        };
        rows.reverse();

        Ok(StoredMessagePage {
            messages: rows.into_iter().map(|(message, _)| message).collect(),
            next_cursor,
            has_more,
        })
    }

    /// Every message in a conversation, for the agent's full context while the UI is paginated.
    pub fn load_all_messages(&self, conversation_id: &str) -> Result<Vec<StoredMessage>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        messages_for(&connection, conversation_id)
    }

    /// Full-text search over conversation titles and message bodies. Matching words get FTS5
    /// prefix queries, so typing half a word already finds it; the caller never sees raw FTS
    /// syntax errors.
    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResults, String> {
        let expression = fts_expression(query);
        if expression.is_empty() {
            return Ok(SearchResults {
                conversations: Vec::new(),
                messages: Vec::new(),
            });
        }

        let limit = limit.clamp(1, 100) as i64;
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let conversations = {
            let mut statement = connection
                .prepare(
                    "SELECT c.id, c.title, c.updated_at, c.archived_at
                     FROM conversations_fts
                     JOIN conversations c ON c.rowid = conversations_fts.rowid
                     WHERE conversations_fts MATCH ?1
                     ORDER BY bm25(conversations_fts), c.updated_at DESC
                     LIMIT ?2",
                )
                .map_err(|error| error.to_string())?;

            let rows = statement
                .query_map(params![expression, limit], |row| {
                    Ok(SearchConversationHit {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        updated_at: row.get(2)?,
                        archived: row.get::<_, Option<i64>>(3)?.is_some(),
                    })
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };

        let messages = {
            let mut statement = connection
                .prepare(
                    "SELECT m.conversation_id, c.title, m.id, m.role, m.created_at, c.archived_at,
                            snippet(messages_fts, 0, char(2), char(3), '…', 14)
                     FROM messages_fts
                     JOIN messages m ON m.rowid = messages_fts.rowid
                     JOIN conversations c ON c.id = m.conversation_id
                     WHERE messages_fts MATCH ?1
                     ORDER BY bm25(messages_fts), m.created_at DESC
                     LIMIT ?2",
                )
                .map_err(|error| error.to_string())?;

            let rows = statement
                .query_map(params![expression, limit], |row| {
                    Ok(SearchMessageHit {
                        conversation_id: row.get(0)?,
                        conversation_title: row.get(1)?,
                        message_id: row.get(2)?,
                        role: row.get(3)?,
                        created_at: row.get(4)?,
                        archived: row.get::<_, Option<i64>>(5)?.is_some(),
                        snippet: row.get(6)?,
                    })
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };

        Ok(SearchResults {
            conversations,
            messages,
        })
    }

    /// Upserts one conversation's metadata without touching its messages.
    pub fn save_summary(&self, summary: &StoredConversationSummary) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "INSERT INTO conversations (id, title, created_at, updated_at, archived_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    archived_at = excluded.archived_at",
                params![
                    summary.id,
                    summary.title,
                    summary.created_at,
                    summary.updated_at,
                    summary.archived_at
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Upserts one message without deleting messages that the UI has not loaded yet.
    pub fn save_message(
        &self,
        conversation_id: &str,
        message: &StoredMessage,
    ) -> Result<(), String> {
        let attachments = attachments_json(&message.attachments)?;
        let metadata = metadata_json(&message.metadata)?;
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "INSERT INTO messages
                    (id, conversation_id, role, content, created_at, status, error, metadata,
                     attachments)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    conversation_id = excluded.conversation_id,
                    role = excluded.role,
                    content = excluded.content,
                    created_at = excluded.created_at,
                    status = excluded.status,
                    error = excluded.error,
                    metadata = excluded.metadata,
                    attachments = excluded.attachments",
                params![
                    message.id,
                    conversation_id,
                    message.role,
                    message.content,
                    message.created_at,
                    message.status,
                    message.error,
                    metadata,
                    attachments
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// The spoken summary cached for one assistant message, if automatic read-aloud already
    /// generated one.
    pub fn spoken_summary(&self, message_id: &str) -> Result<Option<String>, String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row(
                "SELECT summary FROM message_summaries WHERE message_id = ?1",
                params![message_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    /// Every cached spoken summary in a conversation, oldest first. The history window uses this
    /// to decide whether its "Show summary" toggle is available and which messages it affects.
    pub fn spoken_summaries(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<StoredSpokenSummary>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut statement = connection
            .prepare(
                "SELECT message_id, summary
                 FROM message_summaries
                 WHERE conversation_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|error| error.to_string())?;

        let summaries = statement
            .query_map(params![conversation_id], |row| {
                Ok(StoredSpokenSummary {
                    message_id: row.get(0)?,
                    summary: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(summaries)
    }

    /// Stores provenance for a selection action. The frontend may not have mirrored the created
    /// user message yet, so there is no foreign key; a delete trigger handles cleanup.
    pub fn save_selection_metadata(&self, metadata: &SelectionMetadata) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "INSERT INTO selection_metadata
                    (message_id, conversation_id, source_app, source_bundle_id, source_pid, action,
                     character_count, truncated, from_clipboard, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(message_id) DO UPDATE SET
                    conversation_id = excluded.conversation_id,
                    source_app = excluded.source_app,
                    source_bundle_id = excluded.source_bundle_id,
                    source_pid = excluded.source_pid,
                    action = excluded.action,
                    character_count = excluded.character_count,
                    truncated = excluded.truncated,
                    from_clipboard = excluded.from_clipboard,
                    created_at = excluded.created_at",
                params![
                    metadata.message_id,
                    metadata.conversation_id,
                    metadata.source_app,
                    metadata.source_bundle_id,
                    metadata.source_pid,
                    metadata.action,
                    metadata.character_count as i64,
                    metadata.truncated,
                    metadata.from_clipboard,
                    now_ms()
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Selection provenance for one conversation, oldest first. Used by tests today and available
    /// for a future source badge in History.
    pub fn selection_metadata(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<SelectionMetadata>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut statement = connection
            .prepare(
                "SELECT message_id, conversation_id, source_app, source_bundle_id, source_pid,
                        action, character_count, truncated, from_clipboard
                 FROM selection_metadata
                 WHERE conversation_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![conversation_id], |row| {
                Ok(SelectionMetadata {
                    message_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    source_app: row.get(2)?,
                    source_bundle_id: row.get(3)?,
                    source_pid: row.get(4)?,
                    action: row.get(5)?,
                    character_count: row.get::<_, i64>(6)? as usize,
                    truncated: row.get(7)?,
                    from_clipboard: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(rows)
    }

    /// Stores the spoken summary used by automatic read-aloud. The webview may not have mirrored
    /// the completed assistant message yet, so this table deliberately has no foreign key; a
    /// delete trigger keeps it in step with the message instead.
    pub fn save_spoken_summary(
        &self,
        conversation_id: &str,
        message_id: &str,
        summary: &str,
    ) -> Result<(), String> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "INSERT INTO message_summaries
                    (message_id, conversation_id, summary, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(message_id) DO UPDATE SET
                    conversation_id = excluded.conversation_id,
                    summary = excluded.summary,
                    created_at = excluded.created_at",
                params![message_id, conversation_id, summary, now_ms()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Local attachment names for messages that are about to be deleted, so their files can be
    /// removed as well.
    pub fn attachments_for_messages(
        &self,
        ids: &[String],
    ) -> Result<Vec<(String, Vec<StoredAttachment>)>, String> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut statement = connection
            .prepare("SELECT conversation_id, attachments FROM messages WHERE id = ?1")
            .map_err(|error| error.to_string())?;
        let mut found = Vec::new();
        for id in ids {
            let row = statement.query_row(params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            });
            match row {
                Ok((conversation_id, attachments)) => {
                    let attachments = attachments_from(attachments);
                    if !attachments.is_empty() {
                        found.push((conversation_id, attachments));
                    }
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(found)
    }

    pub fn delete_messages(&self, ids: &[String]) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for id in ids {
            transaction
                .execute("DELETE FROM messages WHERE id = ?1", params![id])
                .map_err(|error| error.to_string())?;
            // The triggers also do this; the explicit deletes also cover rows written before the
            // message itself existed.
            transaction
                .execute(
                    "DELETE FROM message_summaries WHERE message_id = ?1",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "DELETE FROM selection_metadata WHERE message_id = ?1",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
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
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        connection
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM message_summaries WHERE conversation_id = ?1",
                params![id],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM selection_metadata WHERE conversation_id = ?1",
                params![id],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM app_meta WHERE name = ?1 AND value = ?2",
                params![QUICK_CONVERSATION_META, id],
            )
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
            .execute_batch(
                "DELETE FROM messages;
                 DELETE FROM message_summaries;
                 DELETE FROM selection_metadata;
                 DELETE FROM conversations;
                 DELETE FROM app_meta WHERE name = 'quick-conversation';",
            )
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

/// Turns arbitrary user input into a quoted FTS5 prefix expression. Only alphanumeric runs are
/// kept, so quotes, `*`, `NEAR`, and other operators can never reach the MATCH parser.
fn fts_expression(query: &str) -> String {
    query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .take(12)
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_cursor(cursor: &str) -> Result<(i64, i64), String> {
    let (created_at, rowid) = cursor
        .split_once(':')
        .ok_or_else(|| "Invalid message cursor.".to_string())?;
    let created_at = created_at
        .parse::<i64>()
        .map_err(|_| "Invalid message cursor.".to_string())?;
    let rowid = rowid
        .parse::<i64>()
        .map_err(|_| "Invalid message cursor.".to_string())?;
    Ok((created_at, rowid))
}

fn row_from_page(row: &rusqlite::Row<'_>) -> rusqlite::Result<(StoredMessage, i64)> {
    let rowid = row.get(0)?;
    Ok((
        StoredMessage {
            id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
            status: row.get(5)?,
            error: row.get(6)?,
            metadata: metadata_from(row.get(8)?),
            attachments: attachments_from(row.get(7)?),
        },
        rowid,
    ))
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

fn metadata_json(metadata: &Option<serde_json::Value>) -> Result<Option<String>, String> {
    metadata
        .as_ref()
        .map(|value| {
            serde_json::to_string(value)
                .map_err(|error| format!("Could not encode message metadata: {error}"))
        })
        .transpose()
}

fn metadata_from(value: Option<String>) -> Option<serde_json::Value> {
    value.and_then(|json| serde_json::from_str(&json).ok())
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
    transaction
        .execute(
            "DELETE FROM message_summaries WHERE conversation_id = ?1",
            params![conversation.id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM selection_metadata WHERE conversation_id = ?1",
            params![conversation.id],
        )
        .map_err(|error| error.to_string())?;

    for message in &conversation.messages {
        transaction
            .execute(
                "INSERT INTO messages
                    (id, conversation_id, role, content, created_at, status, error, metadata,
                     attachments)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    message.id,
                    conversation.id,
                    message.role,
                    message.content,
                    message.created_at,
                    message.status,
                    message.error,
                    metadata_json(&message.metadata)?,
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
            "SELECT id, role, content, created_at, status, error, attachments, metadata
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
                metadata: metadata_from(row.get(7)?),
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

    fn message(id: &str, created_at: i64, content: &str) -> super::StoredMessage {
        super::StoredMessage {
            id: id.to_string(),
            role: "user".to_string(),
            content: content.to_string(),
            created_at,
            status: "complete".to_string(),
            error: None,
            metadata: None,
            attachments: Vec::new(),
        }
    }

    #[test]
    fn message_pages_and_incremental_saves_preserve_history() {
        let storage = storage();
        let conversation = super::StoredConversation {
            id: "c1".to_string(),
            title: "Talk".to_string(),
            created_at: 0,
            updated_at: 5,
            archived_at: None,
            messages: (0..5)
                .map(|index| message(&format!("m{index}"), index, &format!("m{index}")))
                .collect(),
        };
        storage.save(&conversation).expect("save conversation");

        let summaries = storage.load().expect("summaries");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, "Talk");

        let newest = storage
            .load_message_page("c1", None, 2)
            .expect("newest page");
        assert_eq!(
            newest
                .messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["m3", "m4"]
        );
        assert!(newest.has_more);

        let older = storage
            .load_message_page("c1", newest.next_cursor.as_deref(), 2)
            .expect("older page");
        assert_eq!(
            older
                .messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["m1", "m2"]
        );
        assert!(older.has_more);

        let oldest = storage
            .load_message_page("c1", older.next_cursor.as_deref(), 2)
            .expect("oldest page");
        assert_eq!(oldest.messages.len(), 1);
        assert_eq!(oldest.messages[0].id, "m0");
        assert!(!oldest.has_more);
        assert!(oldest.next_cursor.is_none());

        // A single message update must not delete the unloaded pages.
        storage
            .save_message("c1", &message("m1", 1, "edited"))
            .expect("update one message");
        let all = storage.load_all_messages("c1").expect("all messages");
        assert_eq!(all.len(), 5);
        assert_eq!(all[1].content, "edited");

        storage
            .delete_messages(&["m2".to_string()])
            .expect("delete one message");
        assert_eq!(
            storage.load_all_messages("c1").expect("after delete").len(),
            4
        );
    }

    #[test]
    fn message_metadata_round_trips() {
        let storage = storage();
        let mut reply = message("m1", 1, "A reply");
        reply.role = "assistant".to_string();
        reply.metadata = Some(serde_json::json!({ "ai_model": "deepseek-flash" }));
        let conversation = super::StoredConversation {
            id: "c1".to_string(),
            title: "Talk".to_string(),
            created_at: 0,
            updated_at: 1,
            archived_at: None,
            messages: vec![reply],
        };
        storage.save(&conversation).expect("save");

        let all = storage.load_all_messages("c1").expect("all messages");
        assert_eq!(
            all[0].metadata,
            Some(serde_json::json!({ "ai_model": "deepseek-flash" }))
        );

        let page = storage
            .load_message_page("c1", None, 10)
            .expect("message page");
        assert_eq!(
            page.messages[0].metadata,
            Some(serde_json::json!({ "ai_model": "deepseek-flash" }))
        );
    }

    #[test]
    fn spoken_summaries_survive_status_saves_and_follow_message_changes() {
        let storage = storage();
        let conversation = super::StoredConversation {
            id: "c1".to_string(),
            title: "Talk".to_string(),
            created_at: 0,
            updated_at: 1,
            archived_at: None,
            messages: vec![message("m1", 1, "A long reply")],
        };
        storage.save(&conversation).expect("save");

        assert_eq!(storage.spoken_summary("m1").expect("read"), None);
        storage
            .save_spoken_summary("c1", "m1", "A short spoken version.")
            .expect("save summary");
        assert_eq!(
            storage.spoken_summary("m1").expect("read").as_deref(),
            Some("A short spoken version.")
        );
        let summaries = storage.spoken_summaries("c1").expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_id, "m1");
        assert_eq!(summaries[0].summary, "A short spoken version.");

        // A status or identical-content save must not invalidate the cached summary.
        storage
            .save_message("c1", &message("m1", 1, "A long reply"))
            .expect("same content");
        assert!(storage.spoken_summary("m1").expect("read").is_some());

        // Editing the text invalidates it.
        storage
            .save_message("c1", &message("m1", 1, "Changed reply"))
            .expect("edit");
        assert_eq!(storage.spoken_summary("m1").expect("read"), None);

        // Deleting the message clears it too.
        storage
            .save_spoken_summary("c1", "m1", "Again.")
            .expect("save again");
        storage
            .delete_messages(&["m1".to_string()])
            .expect("delete");
        assert_eq!(storage.spoken_summary("m1").expect("read"), None);
        assert!(storage.spoken_summaries("c1").expect("list").is_empty());
    }

    #[test]
    fn selection_metadata_survives_and_follows_message_deletion() {
        let storage = storage();
        let conversation = super::StoredConversation {
            id: "c1".to_string(),
            title: "Talk".to_string(),
            created_at: 0,
            updated_at: 1,
            archived_at: None,
            messages: vec![message("m1", 1, "selected prompt")],
        };
        storage.save(&conversation).expect("save");

        let metadata = super::SelectionMetadata {
            message_id: "m1".to_string(),
            conversation_id: "c1".to_string(),
            source_app: "Brave Browser".to_string(),
            source_bundle_id: Some("com.brave.Browser".to_string()),
            source_pid: 42,
            action: "rewrite".to_string(),
            character_count: 168,
            truncated: false,
            from_clipboard: true,
        };
        storage
            .save_selection_metadata(&metadata)
            .expect("save metadata");

        let loaded = storage.selection_metadata("c1").expect("read metadata");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].source_app, "Brave Browser");
        assert_eq!(loaded[0].action, "rewrite");
        assert_eq!(loaded[0].character_count, 168);
        assert!(loaded[0].from_clipboard);

        // The row is keyed by message, so a retried save replaces rather than duplicates.
        storage
            .save_selection_metadata(&super::SelectionMetadata {
                action: "summarize".to_string(),
                ..metadata
            })
            .expect("replace metadata");
        let loaded = storage.selection_metadata("c1").expect("read replaced");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].action, "summarize");

        storage
            .delete_messages(&["m1".to_string()])
            .expect("delete message");
        assert!(storage
            .selection_metadata("c1")
            .expect("read after delete")
            .is_empty());
    }

    #[test]
    fn search_finds_titles_messages_and_tracks_edits() {
        let storage = storage();
        let conversation = super::StoredConversation {
            id: "chat".to_string(),
            title: "Quarterly planning".to_string(),
            created_at: 0,
            updated_at: 3,
            archived_at: None,
            messages: vec![
                message("m1", 1, "We discussed pagination and the sidebar search."),
                message("m2", 2, "Nothing relevant here."),
            ],
        };
        storage.save(&conversation).expect("save");

        let by_title = storage.search("quarter", 20).expect("title search");
        assert!(by_title.conversations.iter().any(|hit| hit.id == "chat"));
        assert!(!by_title.conversations[0].archived);
        assert!(by_title.messages.is_empty());

        let by_message = storage.search("sidebar", 20).expect("message search");
        assert_eq!(by_message.messages.len(), 1);
        let hit = &by_message.messages[0];
        assert_eq!(hit.conversation_id, "chat");
        assert_eq!(hit.conversation_title, "Quarterly planning");
        assert_eq!(hit.message_id, "m1");
        assert_eq!(hit.role, "user");
        assert!(hit.snippet.contains("sidebar"));

        // Prefix terms work, and raw FTS operators in the input stay plain words.
        assert_eq!(
            storage.search("pagin", 20).expect("prefix").messages.len(),
            1
        );
        assert_eq!(
            storage
                .search("\"sidebar\"* ((", 20)
                .expect("sanitized")
                .messages
                .len(),
            1
        );
        assert!(storage
            .search("+++", 20)
            .expect("punctuation only")
            .messages
            .is_empty());

        // Editing a message replaces its old terms in the index.
        storage
            .save_message("chat", &message("m1", 1, "Replaced with telescope notes."))
            .expect("edit");
        assert!(storage
            .search("sidebar", 20)
            .expect("old term")
            .messages
            .is_empty());
        assert_eq!(
            storage
                .search("telescope", 20)
                .expect("new term")
                .messages
                .len(),
            1
        );

        // Deleting a message removes its hit.
        storage
            .delete_messages(&["m1".to_string()])
            .expect("delete");
        assert!(storage
            .search("telescope", 20)
            .expect("deleted term")
            .messages
            .is_empty());

        // Archived conversations stay searchable and report their state.
        storage
            .save_summary(&super::StoredConversationSummary {
                id: "chat".to_string(),
                title: "Quarterly planning".to_string(),
                created_at: 0,
                updated_at: 9,
                archived_at: Some(9),
            })
            .expect("archive");
        let archived = storage.search("quarter", 20).expect("archived search");
        assert!(archived.conversations[0].archived);
    }

    #[test]
    fn replaced_conversation_titles_reindex() {
        let storage = storage();
        storage
            .save(&super::StoredConversation {
                id: "c1".to_string(),
                title: "Alphabet".to_string(),
                created_at: 0,
                updated_at: 1,
                archived_at: None,
                messages: vec![],
            })
            .expect("save");
        storage
            .save_summary(&super::StoredConversationSummary {
                id: "c1".to_string(),
                title: "Bravo".to_string(),
                created_at: 0,
                updated_at: 2,
                archived_at: None,
            })
            .expect("rename");

        assert!(storage
            .search("alphabet", 20)
            .expect("old title")
            .conversations
            .is_empty());
        assert_eq!(
            storage
                .search("bravo", 20)
                .expect("new title")
                .conversations
                .len(),
            1
        );
    }

    #[test]
    fn the_legacy_quick_conversation_is_renamed_to_a_uuid() {
        let storage = storage();
        storage
            .save(&super::StoredConversation {
                id: "iris:quick".to_string(),
                title: "Quick chat".to_string(),
                created_at: 0,
                updated_at: 1,
                archived_at: None,
                messages: vec![message("m1", 1, "hello")],
            })
            .expect("save");

        let new_id = "81035a29-a320-4589-b1b4-d98d4f008f0f";
        assert!(storage
            .rename_legacy_quick_conversation(new_id)
            .expect("rename"));
        assert_eq!(
            storage.quick_conversation_id().expect("read").as_deref(),
            Some(new_id)
        );
        assert!(storage
            .load_all_messages("iris:quick")
            .expect("old id")
            .is_empty());
        assert_eq!(storage.load_all_messages(new_id).expect("new id").len(), 1);
        assert!(!storage
            .rename_legacy_quick_conversation("other")
            .expect("second run"));
    }

    #[test]
    fn the_quick_conversation_pointer_follows_deletes_and_clear() {
        let storage = storage();
        storage
            .set_quick_conversation_id(Some("quick"))
            .expect("store pointer");
        assert_eq!(
            storage.quick_conversation_id().expect("read").as_deref(),
            Some("quick")
        );

        // Deleting another conversation must leave the pointer alone.
        storage.delete("other").expect("delete other");
        assert!(storage.quick_conversation_id().expect("read").is_some());

        storage
            .save(&super::StoredConversation {
                id: "quick".to_string(),
                title: "Quick chat".to_string(),
                created_at: 0,
                updated_at: 1,
                archived_at: None,
                messages: vec![],
            })
            .expect("save quick");
        storage.delete("quick").expect("delete quick");
        assert_eq!(storage.quick_conversation_id().expect("read"), None);

        storage
            .set_quick_conversation_id(Some("quick-again"))
            .expect("store pointer");
        storage.clear().expect("clear");
        assert_eq!(storage.quick_conversation_id().expect("read"), None);
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
