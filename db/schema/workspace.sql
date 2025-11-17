CREATE TABLE workspace (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type VARCHAR(50),
    title TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE workspace_metadata (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER REFERENCES workspace(id),
    meta_key TEXT,
    meta_value TEXT
);
ALTER TABLE workspace_metadata
  ADD CONSTRAINT workspace_metadata_unique_key
  UNIQUE (workspace_id, meta_key);
