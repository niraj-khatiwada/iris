-- Spoken summaries produced for automatic read-aloud.
--
-- The summary is written by the backend as soon as automatic playback prepares, which can be
-- slightly before the frontend has mirrored the completed reply. There is deliberately no foreign
-- key to `messages`: a summary must not be lost in that window. The triggers keep this table in
-- step with message edits and deletes instead.
CREATE TABLE message_summaries (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX message_summaries_by_conversation
    ON message_summaries(conversation_id);

CREATE TRIGGER messages_summary_delete AFTER DELETE ON messages BEGIN
    DELETE FROM message_summaries WHERE message_id = old.id;
END;

CREATE TRIGGER messages_summary_content_update
AFTER UPDATE OF content ON messages
WHEN old.content <> new.content
BEGIN
    DELETE FROM message_summaries WHERE message_id = old.id;
END;
