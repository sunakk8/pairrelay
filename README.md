# pairrelay

Live shared AI coding sessions for engineering teams. Connect Cursor (or any MCP client) to a teammate’s session via CLI + WebSocket relay.

## How it works

1. You run a **relay** (a small server that holds the shared session).
2. Each person installs the **CLI** and connects with `share` or `join`.
3. Cursor talks to that session through **MCP** tools.

You can use the public demo relay, or deploy your own (recommended for real use).

## 1. Install the CLI

```bash
npm install -g pairrelay
```

Requires Node.js 20+.

## 2. Run a relay

### Option A — Use the demo relay

```text
https://pairrelay.fly.dev
```

Fine for trying pairrelay. For your own team, deploy your own relay (Option B) so you control the API key and uptime.

### Option B — Deploy your own relay (Fly.io)

From this repo (with [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed and logged in):

```bash
git clone https://github.com/sunakk8/pairrelay.git
cd pairrelay
fly launch          # uses the included Dockerfile + fly.toml
fly secrets set \
  PAIRRELAY_RELAY_API_KEYS="pick-a-team-key" \
  PAIRRELAY_RELAY_SECRET="$(openssl rand -hex 32)"
fly deploy
fly scale count 1   # important: sessions are in-memory — use exactly 1 machine
```

Your relay URL will look like `https://<your-app>.fly.dev`. Check it:

```bash
curl https://<your-app>.fly.dev/health
# {"ok":true}
```

Give teammates that URL and the API key you set as `PAIRRELAY_RELAY_API_KEYS`.

## 3. Log in (each machine)

```bash
pairrelay login --relay-url https://<your-app>.fly.dev --api-key YOUR_TEAM_KEY
```

## 4. Cursor MCP

This repo includes a project MCP config at [`.cursor/mcp.json`](.cursor/mcp.json). After installing the CLI, reload MCP in Cursor (or restart Cursor).

Tools:

- `pairrelay_get_session`
- `pairrelay_post_message`
- `pairrelay_get_session_summary`

Prefer a global Cursor config? Copy [`mcp.json.example`](mcp.json.example) into your user MCP settings.

## 5. Share a session (host)

Leave this terminal running:

```bash
pairrelay share
```

Send your teammate the **Join cmd** (or join page URL) from the output.

## 6. Join a session

Leave this terminal running:

```bash
pairrelay join <session-id> --token <token>
```

Add `--relay-url https://<your-app>.fly.dev` if you didn’t log in with that URL yet.

## 7. Use it in Cursor

With `share` / `join` still running:

1. Ask your agent to `pairrelay_post_message` to write to the shared session.
2. Ask your agent to `pairrelay_get_session` to read the shared transcript.

Both sides’ agents read and write the same live session.

## Commands

| Command | Description |
|---------|-------------|
| `pairrelay login` | Save relay URL and API key |
| `pairrelay share` | Create and host a shared session |
| `pairrelay join <id>` | Join an existing session |
| `pairrelay post <msg>` | Post a message from the CLI |
| `pairrelay leave` | Leave the active session |
| `pairrelay mcp` | Start the MCP server (used by Cursor) |

## Tips

- Keep the `share` / `join` terminal open while pairing — that process holds the relay connection and updates local session state for MCP.
- If Cursor shows an old session, run `pairrelay leave`, delete `~/.pairrelay/session-cache.json` if needed, re-join, and reload MCP.
- The browser join page is install/join instructions only — live messages appear in the CLI and via MCP, not on that page.
- Until the relay has durable storage, keep **one** Fly machine (`fly scale count 1`) so every join hits the same session memory.
