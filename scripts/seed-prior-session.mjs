/**
 * Seed a prior session into Postgres for retrieval testing.
 *
 * Usage (local):
 *   DATABASE_URL=postgres://... node scripts/seed-prior-session.mjs
 *   DATABASE_URL=postgres://... node scripts/seed-prior-session.mjs path/to/session.json
 *
 * Default fixture: scripts/fixtures/august-two-laptop-session.json
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath =
  process.argv[2] ?? join(root, "scripts/fixtures/august-two-laptop-session.json");

const databaseUrl =
  process.env.DATABASE_URL ?? process.env.PAIRRELAY_DATABASE_URL ?? process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("Set DATABASE_URL (or PAIRRELAY_DATABASE_URL) to your Postgres connection string.");
  process.exit(1);
}

const SCHEMA_SQL = `
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
`;

async function main() {
  const raw = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(raw);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(SCHEMA_SQL);

    await pool.query(
      `INSERT INTO sessions (
         session_id, created_at, expires_at, join_token,
         context_repo, context_branch, context_files
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         context_repo = EXCLUDED.context_repo,
         context_branch = EXCLUDED.context_branch`,
      [
        fixture.session_id,
        fixture.created_at,
        fixture.expires_at,
        fixture.join_token ?? "seeded",
        fixture.context?.repo ?? "",
        fixture.context?.branch ?? "",
        JSON.stringify(fixture.context?.files ?? []),
      ],
    );

    let seq = 0;
    for (const message of fixture.messages ?? []) {
      seq += 1;
      await pool.query(
        `INSERT INTO messages (session_id, role, content, author, timestamp, seq)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id, seq) DO UPDATE SET
           content = EXCLUDED.content,
           author = EXCLUDED.author,
           timestamp = EXCLUDED.timestamp`,
        [
          fixture.session_id,
          message.role,
          message.content,
          message.author,
          message.timestamp,
          seq,
        ],
      );
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM messages WHERE session_id = $1`,
      [fixture.session_id],
    );

    console.log(`Seeded session ${fixture.session_id}`);
    console.log(`  repo: ${fixture.context?.repo}`);
    console.log(`  expires_at: ${fixture.expires_at}`);
    console.log(`  messages: ${count.rows[0]?.n ?? 0}`);
    console.log("");
    console.log("Try retrieval with a matching query, e.g.:");
    console.log('  query: "hello MCP laptop"');
    console.log("  include_prior_sessions: true");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
