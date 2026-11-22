-- Per-message JSON metadata. The first field is `ai_model`, the model that produced an assistant
-- reply; the JSON shape leaves room for later analysis fields without another schema change.
ALTER TABLE messages ADD COLUMN metadata TEXT;
