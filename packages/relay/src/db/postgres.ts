import pg from "pg";

import type { SessionContext, SessionMessage } from "@pairrelay/shared";

import type { StoredSession } from "../store.js";

const { Pool } = pg;

/**
 * Durable session row + ordered message log. Embedded so Docker/`pnpm deploy`
 * does not need a loose .sql file. ON CONFLICT makes writes retry-safe.
 */
export const SCHEMA_SQL = `
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
`;

export interface PostgresStore {
  pool: pg.Pool;
  migrate(): Promise<void>;
  insertSession(session: StoredSession): Promise<void>;
  updateExpiresAt(sessionId: string, expiresAt: string): Promise<void>;
  appendMessage(sessionId: string, message: SessionMessage, seq: number): Promise<void>;
  loadSession(sessionId: string): Promise<StoredSession | undefined>;
  searchMessagesForRepo(
    repo: string,
    excludeSessionId: string,
    limit: number,
  ): Promise<Array<SessionMessage & { session_id: string }>>;
  deleteSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

export function createPostgresStore(databaseUrl: string): PostgresStore {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    pool,

    async migrate(): Promise<void> {
      await pool.query(SCHEMA_SQL);
    },

    async insertSession(session: StoredSession): Promise<void> {
      // DO NOTHING on conflict: create is retry-safe if Redis wrote but PG did not.
      await pool.query(
        `INSERT INTO sessions (
           session_id, created_at, expires_at, join_token,
           context_repo, context_branch, context_files
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id) DO NOTHING`,
        [
          session.session_id,
          session.created_at,
          session.expires_at,
          session.join_token,
          session.context.repo,
          session.context.branch,
          JSON.stringify(session.context.files),
        ],
      );
    },

    async updateExpiresAt(sessionId: string, expiresAt: string): Promise<void> {
      await pool.query(`UPDATE sessions SET expires_at = $2 WHERE session_id = $1`, [
        sessionId,
        expiresAt,
      ]);
    },

    async appendMessage(sessionId: string, message: SessionMessage, seq: number): Promise<void> {
      // UNIQUE (session_id, seq) + DO NOTHING: duplicate persist after crash is a no-op.
      await pool.query(
        `INSERT INTO messages (session_id, role, content, author, timestamp, seq)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id, seq) DO NOTHING`,
        [sessionId, message.role, message.content, message.author, message.timestamp, seq],
      );
    },

    async loadSession(sessionId: string): Promise<StoredSession | undefined> {
      const sessionRes = await pool.query<{
        session_id: string;
        created_at: Date;
        expires_at: Date;
        join_token: string;
        context_repo: string;
        context_branch: string;
        context_files: string[] | string;
      }>(
        `SELECT session_id, created_at, expires_at, join_token,
                context_repo, context_branch, context_files
         FROM sessions WHERE session_id = $1`,
        [sessionId],
      );
      if (sessionRes.rowCount === 0) {
        return undefined;
      }
      const row = sessionRes.rows[0]!;
      const messagesRes = await pool.query<{
        role: SessionMessage["role"];
        content: string;
        author: string;
        timestamp: Date;
      }>(
        `SELECT role, content, author, timestamp
         FROM messages WHERE session_id = $1 ORDER BY seq ASC`,
        [sessionId],
      );

      const files =
        typeof row.context_files === "string"
          ? (JSON.parse(row.context_files) as string[])
          : row.context_files;

      const context: SessionContext = {
        repo: row.context_repo,
        branch: row.context_branch,
        files: Array.isArray(files) ? files : [],
      };

      return {
        session_id: row.session_id,
        created_at: new Date(row.created_at).toISOString(),
        expires_at: new Date(row.expires_at).toISOString(),
        join_token: row.join_token,
        participants: [],
        messages: messagesRes.rows.map((m) => ({
          role: m.role,
          content: m.content,
          author: m.author,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
        context,
      };
    },

    async searchMessagesForRepo(
      repo: string,
      excludeSessionId: string,
      limit: number,
    ): Promise<Array<SessionMessage & { session_id: string }>> {
      if (!repo) {
        return [];
      }
      const res = await pool.query<{
        session_id: string;
        role: SessionMessage["role"];
        content: string;
        author: string;
        timestamp: Date;
      }>(
        `SELECT m.session_id, m.role, m.content, m.author, m.timestamp
         FROM messages m
         JOIN sessions s ON s.session_id = m.session_id
         WHERE s.context_repo = $1
           AND m.session_id != $2
           AND s.expires_at > NOW()
         ORDER BY m.timestamp DESC
         LIMIT $3`,
        [repo, excludeSessionId, limit],
      );
      return res.rows.map((row) => ({
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        author: row.author,
        timestamp: new Date(row.timestamp).toISOString(),
      }));
    },

    async deleteSession(sessionId: string): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE session_id = $1`, [sessionId]);
    },

    async close(): Promise<void> {
      await pool.end();
    },

    async ping(): Promise<boolean> {
      try {
        const res = await pool.query("SELECT 1 AS ok");
        return res.rowCount === 1;
      } catch {
        return false;
      }
    },
  };
}
