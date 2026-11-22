-- Provenance for selection actions: which app the text came from, what action was chosen, and how
-- the selection was read. The selected text itself lives in the user message prompt; this table
-- keeps the structured metadata that should survive restarts.
--
-- The row is written just after the user message is created, which can be before the frontend has
-- mirrored that message. There is deliberately no foreign key; a delete trigger keeps the table in
-- step with message deletion instead.
CREATE TABLE selection_metadata (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    source_app TEXT NOT NULL,
    source_bundle_id TEXT,
    source_pid INTEGER NOT NULL,
    action TEXT NOT NULL,
    character_count INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    from_clipboard INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX selection_metadata_by_conversation
    ON selection_metadata(conversation_id);

CREATE TRIGGER messages_selection_metadata_delete AFTER DELETE ON messages BEGIN
    DELETE FROM selection_metadata WHERE message_id = old.id;
END;
