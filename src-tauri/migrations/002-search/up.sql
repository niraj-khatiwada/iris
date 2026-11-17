-- Full-text search over conversation titles and message bodies.
-- External-content tables index the existing rows instead of storing a second copy, and the
-- triggers keep them in sync with every metadata or message change.
CREATE VIRTUAL TABLE conversations_fts USING fts5(
    title,
    content='conversations',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

-- Seed the index before the triggers exist, so these inserts are not indexed twice.
INSERT INTO conversations_fts(rowid, title) SELECT rowid, title FROM conversations;
INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;

CREATE TRIGGER conversations_fts_insert AFTER INSERT ON conversations BEGIN
    INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER conversations_fts_delete AFTER DELETE ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, title)
        VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER conversations_fts_update AFTER UPDATE OF title ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, title)
        VALUES ('delete', old.rowid, old.title);
    INSERT INTO conversations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
