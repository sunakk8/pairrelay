-- Durable session metadata + ordered message log (source of truth after Redis).
-- seq is unique per session so a retried persist is a no-op.

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  join_token TEXT NOT NULL,
  context_repo TEXT NOT NULL DEFAULT '',
  context_branch TEXT NOT NULL DEFAULT '',
  context_files JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  seq BIGINT NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS messages_session_seq_idx ON messages (session_id, seq);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
