-- Seed August two-laptop test session for prior-session retrieval.
INSERT INTO sessions (
  session_id, created_at, expires_at, join_token,
  context_repo, context_branch, context_files
) VALUES (
  '7658a568-5342-4c69-b0de-75ff82ae3587',
  '2026-08-04T20:59:38.074Z',
  '2026-09-10T00:00:00.000Z',
  'seeded-for-retrieval-test',
  'pairrelay',
  'backup/cloud-deploy-npm-0.1.1',
  '[]'::jsonb
) ON CONFLICT (session_id) DO UPDATE SET
  expires_at = EXCLUDED.expires_at,
  context_repo = EXCLUDED.context_repo,
  context_branch = EXCLUDED.context_branch;

INSERT INTO messages (session_id, role, content, author, timestamp, seq) VALUES
  ('7658a568-5342-4c69-b0de-75ff82ae3587', 'user', 'Hello from laptop A (Mac) — can you see this?', 'Sunjeets-MacBook-Pro.local-14a75a', '2026-08-04T21:02:47.814Z', 1),
  ('7658a568-5342-4c69-b0de-75ff82ae3587', 'assistant', 'Yes — received on laptop B (Windows). Hello back from LAPTOP-94920H9H.', 'LAPTOP-94920H9H-e4caac', '2026-08-04T21:05:08.035Z', 2),
  ('7658a568-5342-4c69-b0de-75ff82ae3587', 'assistant', 'Hello from laptop A agent via MCP (pairrelay_post_message).', 'Sunjeets-MacBook-Pro.local-14a75a', '2026-08-04T21:13:19.928Z', 3),
  ('7658a568-5342-4c69-b0de-75ff82ae3587', 'assistant', 'Hello from laptop B agent via MCP (pairrelay_post_message).', 'LAPTOP-94920H9H-e4caac', '2026-08-04T21:21:30.995Z', 4)
ON CONFLICT (session_id, seq) DO UPDATE SET
  content = EXCLUDED.content,
  author = EXCLUDED.author,
  timestamp = EXCLUDED.timestamp;

SELECT session_id, context_repo, expires_at FROM sessions WHERE session_id = '7658a568-5342-4c69-b0de-75ff82ae3587';
SELECT COUNT(*)::int AS message_count FROM messages WHERE session_id = '7658a568-5342-4c69-b0de-75ff82ae3587';
