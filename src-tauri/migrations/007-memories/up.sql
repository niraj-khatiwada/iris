-- Persistent memory: short, auto-learned facts about the user. Sourced from typed conversation
-- text only; sensitive content is filtered before it reaches this table.
--
-- Updating a remembered fact inserts a new current row and marks the old one inactive with
-- `superseded_by` pointing at its replacement. That keeps a small version chain so the latest
-- learned batch can be undone without losing the fact it replaced.
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_conversation_id TEXT,
    source_message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    paused INTEGER NOT NULL DEFAULT 0,
    user_edited INTEGER NOT NULL DEFAULT 0,
    superseded_by TEXT,
    batch_id TEXT
);

CREATE INDEX memories_active_updated
    ON memories(active, updated_at DESC);
