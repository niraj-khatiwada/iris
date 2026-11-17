CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE TABLE messages (
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

CREATE INDEX messages_by_conversation
    ON messages(conversation_id, created_at);

CREATE TABLE credential (
    name TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
