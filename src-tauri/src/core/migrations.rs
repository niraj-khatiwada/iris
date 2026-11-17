use std::sync::LazyLock;

use include_dir::{include_dir, Dir};
use rusqlite::Connection;
use rusqlite_migration::Migrations;

/// `src-tauri/migrations/<version>-<name>/up.sql`, applied in version order.
///
/// Migrations are append-only: add a new folder, never edit or reorder one that has shipped.
/// The version lives in SQLite's `user_version`, so there is no bookkeeping table.
static MIGRATIONS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/migrations");

static MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::from_directory(&MIGRATIONS_DIR).expect("the migrations directory is valid")
});

/// Brings the database up to the current schema, running only the migrations it has not seen.
///
/// A file written before schema versioning has the current tables but `user_version = 0`. It is
/// adopted as version 1 in place, adding only the columns an older build lacked, so existing
/// conversations and the API key survive the upgrade. Dropping it would silently erase history.
pub fn prepare(connection: &mut Connection) -> Result<(), String> {
    if is_unversioned(connection)? {
        adopt_unversioned(connection)?;
    }
    upgrade(connection)
}

/// Runs every migration the database has not seen yet.
pub fn upgrade(connection: &mut Connection) -> Result<(), String> {
    MIGRATIONS
        .to_latest(connection)
        .map_err(|error| format!("Could not upgrade the Iris database: {error}"))
}

/// Stamps a pre-versioning database as version 1 without running the initial migration again.
/// The initial schema already matches what those builds created; only the later additions need to
/// be backfilled before the version is recorded.
fn adopt_unversioned(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not adopt the Iris database: {error}"))?;

    // Tables introduced after those early builds still need to exist.
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
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
            );",
        )
        .map_err(|error| format!("Could not adopt the Iris database: {error}"))?;

    add_column_if_missing(&transaction, "conversations", "archived_at INTEGER")?;
    add_column_if_missing(&transaction, "messages", "attachments TEXT")?;

    transaction
        .execute_batch("PRAGMA user_version = 1;")
        .map_err(|error| format!("Could not record the Iris schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not adopt the Iris database: {error}"))?;

    log::info!("Adopted the pre-versioning Iris database as schema version 1");
    Ok(())
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    definition: &str,
) -> Result<(), String> {
    let column = definition
        .split_whitespace()
        .next()
        .ok_or_else(|| "An empty column definition is not valid.".to_string())?;
    if has_column(connection, table, column)? {
        return Ok(());
    }

    connection
        .execute(&format!("ALTER TABLE {table} ADD COLUMN {definition}"), [])
        .map_err(|error| format!("Could not add {table}.{column}: {error}"))?;
    Ok(())
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(columns.iter().any(|name| name == column))
}

/// Drops every table, compacts the file, and forgets the schema version so the next `prepare`
/// rebuilds from scratch. Reset Iris uses this: clearing rows alone would leave a versioned schema
/// behind that a later migration could not reconcile.
pub fn reset(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "DROP TABLE IF EXISTS messages_fts;
             DROP TABLE IF EXISTS conversations_fts;
             DROP TABLE IF EXISTS messages;
             DROP TABLE IF EXISTS conversations;
             DROP TABLE IF EXISTS credential;
             PRAGMA user_version = 0;
             VACUUM;
             PRAGMA wal_checkpoint(TRUNCATE);",
        )
        .map_err(|error| format!("Could not reset the Iris database: {error}"))
}

/// Whether this file predates schema versioning: tables exist but no version was ever written.
/// Those files are adopted as version 1 instead of being migrated from scratch.
pub fn is_unversioned(connection: &Connection) -> Result<bool, String> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("Could not read the Iris database version: {error}"))?;
    let has_tables = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversations'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    Ok(version == 0 && has_tables)
}

#[cfg(test)]
mod tests {
    use super::{is_unversioned, prepare, reset, upgrade, MIGRATIONS};
    use rusqlite::Connection;

    fn columns(connection: &Connection, table: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("read the table");
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("columns")
            .collect::<Result<Vec<_>, _>>()
            .expect("column names")
    }

    fn version(connection: &Connection) -> i64 {
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read the version")
    }

    /// A malformed migration directory (a typo, a duplicate version) fails here instead of at launch.
    #[test]
    fn the_migration_directory_is_valid() {
        MIGRATIONS.validate().expect("valid migrations");
    }

    #[test]
    fn a_fresh_database_gets_the_full_schema() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        upgrade(&mut connection).expect("upgrade");

        assert_eq!(
            columns(&connection, "conversations"),
            ["id", "title", "created_at", "updated_at", "archived_at"]
        );
        assert_eq!(
            columns(&connection, "messages"),
            [
                "id",
                "conversation_id",
                "role",
                "content",
                "created_at",
                "status",
                "error",
                "attachments"
            ]
        );
        assert_eq!(
            columns(&connection, "credential"),
            ["name", "api_key", "updated_at"]
        );

        let index: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'messages_by_conversation'",
                [],
                |row| row.get(0),
            )
            .expect("read the index");
        assert_eq!(index, 1);

        // The search migration adds one external-content FTS table per searchable table.
        let fts: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN ('conversations_fts', 'messages_fts')",
                [],
                |row| row.get(0),
            )
            .expect("read the FTS tables");
        assert_eq!(fts, 2);
        assert_eq!(version(&connection), 2);
    }

    /// Opening the app twice must not re-run anything or fail on an existing table.
    #[test]
    fn upgrading_twice_is_a_no_op() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        upgrade(&mut connection).expect("first upgrade");
        upgrade(&mut connection).expect("second upgrade");
        assert_eq!(version(&connection), 2);
    }

    /// The version lives in the file, not in memory: reopening an upgraded database must count as
    /// already migrated rather than trying to create the tables again.
    #[test]
    fn the_version_survives_reopening_the_file() {
        let path =
            std::env::temp_dir().join(format!("iris-migration-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);

        {
            let mut connection = Connection::open(&path).expect("open the database file");
            upgrade(&mut connection).expect("first upgrade");
            assert_eq!(version(&connection), 2);
        }
        {
            let mut connection = Connection::open(&path).expect("reopen the database file");
            upgrade(&mut connection).expect("second upgrade");
            assert_eq!(version(&connection), 2);
        }

        let _ = std::fs::remove_file(&path);
    }

    /// A database from before versioning keeps its conversations. It is stamped as version 1 in
    /// place; i.e. the columns added by later builds are backfilled without re-running the initial
    /// `CREATE TABLE` statements.
    #[test]
    fn an_unversioned_database_is_adopted_without_losing_history() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL
                        REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT
                 );
                 INSERT INTO conversations (id, title, created_at, updated_at)
                    VALUES ('c1', 'Old chat', 1, 1);
                 INSERT INTO messages
                    (id, conversation_id, role, content, created_at, status)
                    VALUES ('m1', 'c1', 'user', 'hello', 1, 'complete');",
            )
            .expect("legacy schema");

        assert!(
            is_unversioned(&connection).expect("detect"),
            "tables with no version must be detected"
        );

        prepare(&mut connection).expect("adopt the legacy schema");

        assert_eq!(version(&connection), 2);
        assert!(
            columns(&connection, "conversations").contains(&"archived_at".to_string()),
            "adoption must add archived_at"
        );
        assert!(
            columns(&connection, "messages").contains(&"attachments".to_string()),
            "adoption must add attachments"
        );
        assert_eq!(
            columns(&connection, "credential"),
            ["name", "api_key", "updated_at"]
        );

        let title: String = connection
            .query_row(
                "SELECT title FROM conversations WHERE id = 'c1'",
                [],
                |row| row.get(0),
            )
            .expect("conversation survived");
        assert_eq!(title, "Old chat");
        let content: String = connection
            .query_row("SELECT content FROM messages WHERE id = 'm1'", [], |row| {
                row.get(0)
            })
            .expect("message survived");
        assert_eq!(content, "hello");
    }

    /// The release immediately before versioning already had the full schema and the credential
    /// table. Adopting it must not touch a single row.
    #[test]
    fn a_current_unversioned_database_keeps_its_key_and_conversations() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        upgrade(&mut connection).expect("create the current schema");
        connection
            .execute_batch(
                "INSERT INTO conversations (id, title, created_at, updated_at)
                    VALUES ('c1', 'Recent chat', 1, 1);
                 INSERT INTO credential (name, api_key, updated_at)
                    VALUES ('api-key', 'sk-live', 1);
                 DROP TRIGGER conversations_fts_insert;
                 DROP TRIGGER conversations_fts_delete;
                 DROP TRIGGER conversations_fts_update;
                 DROP TRIGGER messages_fts_insert;
                 DROP TRIGGER messages_fts_delete;
                 DROP TRIGGER messages_fts_update;
                 DROP TABLE conversations_fts;
                 DROP TABLE messages_fts;
                 PRAGMA user_version = 0;",
            )
            .expect("simulate the pre-versioning release");

        prepare(&mut connection).expect("adopt");

        assert_eq!(version(&connection), 2);
        let api_key: String = connection
            .query_row(
                "SELECT api_key FROM credential WHERE name = 'api-key'",
                [],
                |row| row.get(0),
            )
            .expect("credential survived");
        assert_eq!(api_key, "sk-live");
        let conversations: i64 = connection
            .query_row("SELECT count(*) FROM conversations", [], |row| row.get(0))
            .expect("count");
        assert_eq!(conversations, 1);
    }

    /// Reset Iris drops the schema and starts from an empty, modern file.
    #[test]
    fn resetting_then_reopening_rebuilds_the_schema() {
        let path = std::env::temp_dir().join(format!("iris-reset-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);

        {
            let mut connection = Connection::open(&path).expect("open the database file");
            upgrade(&mut connection).expect("first upgrade");
            connection
                .execute_batch(
                    "INSERT INTO conversations (id, title, created_at, updated_at)
                        VALUES ('c1', 'Chat', 1, 1);",
                )
                .expect("insert");
            reset(&connection).expect("reset");
            assert_eq!(version(&connection), 0);
        }

        {
            let mut connection = Connection::open(&path).expect("reopen the database file");
            assert!(
                !is_unversioned(&connection).expect("check"),
                "a reset file has no tables, so it must not look unversioned"
            );
            prepare(&mut connection).expect("rebuild after reset");
            assert_eq!(version(&connection), 2);

            let remaining: i64 = connection
                .query_row("SELECT count(*) FROM conversations", [], |row| row.get(0))
                .expect("count");
            assert_eq!(remaining, 0, "reset must not keep conversations");
        }

        let _ = std::fs::remove_file(&path);
    }

    /// Deleting a conversation removes its messages, which is what reset and delete rely on.
    #[test]
    fn messages_cascade_with_their_conversation() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        upgrade(&mut connection).expect("upgrade");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys");
        connection
            .execute_batch(
                "INSERT INTO conversations (id, title, created_at, updated_at)
                    VALUES ('c1', 'Chat', 1, 1);
                 INSERT INTO messages
                    (id, conversation_id, role, content, created_at, status)
                    VALUES ('m1', 'c1', 'user', 'hello', 1, 'complete');",
            )
            .expect("insert");

        connection
            .execute("DELETE FROM conversations WHERE id = 'c1'", [])
            .expect("delete");

        let remaining: i64 = connection
            .query_row("SELECT count(*) FROM messages", [], |row| row.get(0))
            .expect("count");
        assert_eq!(remaining, 0);
    }
}
