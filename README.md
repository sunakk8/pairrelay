# pairrelay

Live shared AI coding sessions for engineering teams. Connect Cursor (or any MCP client) to a teammate’s session via CLI + WebSocket relay.

## Install

```bash
npm install -g pairrelay
```

Requires Node.js 20+.

## Set up

Point the CLI at your team’s relay and authenticate (one time per machine):

```bash
pairrelay login --relay-url https://pairrelay.fly.dev --api-key YOUR_TEAM_KEY
```

Use the relay URL and API key your team admin gave you.

## Cursor MCP

This repo includes a project MCP config at [`.cursor/mcp.json`](.cursor/mcp.json). After installing the CLI, reload MCP in Cursor (or restart Cursor).

You should see these tools:

- `pairrelay_get_session`
- `pairrelay_post_message`
- `pairrelay_get_session_summary`

Prefer a global Cursor config? Copy [`mcp.json.example`](mcp.json.example) into your user MCP settings.

## Share a session (host)

In a terminal, leave this running:

```bash
pairrelay share
```

Send your teammate the **Join cmd** (or join page URL) from the output.

## Join a session

In a terminal, leave this running:

```bash
pairrelay join <session-id> --token <token> --relay-url https://pairrelay.fly.dev
```

(If you already ran `pairrelay login` with the relay URL, you can omit `--relay-url`.)

## Use it in Cursor

With `share` or `join` still running:

1. Ask your agent to call `pairrelay_post_message` to write to the shared session.
2. Ask your agent to call `pairrelay_get_session` to read the shared transcript.

Both sides’ agents can read and write the same live session.

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
