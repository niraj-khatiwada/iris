-- Small key/value store for app state that belongs with the database, such as the id of the
-- conversation the quick overlay is currently showing.
CREATE TABLE app_meta (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
