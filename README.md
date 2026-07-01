# pairrelay

Live shared AI coding sessions for engineering teams. Connect Cursor (or any MCP client) to a teammate's session via CLI + WebSocket relay.

## Install

```bash
npm install -g pairrelay
```

From source:

```bash
git clone https://github.com/sunakk8/pairrelay.git
cd pairrelay
pnpm install
pnpm build
pnpm link --global --filter pairrelay
```

## Quick start

Start the relay (local dev):

```bash
pnpm dev:relay
```

In another terminal:

```bash
pairrelay share
pairrelay join <session-id> --token <token>
```

Optional auth for dogfood:

```bash
export PAIRRELAY_RELAY_API_KEYS="your-team-key"
export PAIRRELAY_RELAY_SECRET="a-long-random-secret"
pairrelay login --api-key your-team-key
```

## Cursor MCP

Copy `mcp.json.example` to `.cursor/mcp.json` (or your user MCP settings) and adjust the path after `pnpm build`:

```json
{
  "mcpServers": {
    "pairrelay": {
      "command": "node",
      "args": ["packages/cli/dist/index.js", "mcp"]
    }
  }
}
```

Workflow:

1. Run `pairrelay share` or `pairrelay join` in a terminal (keeps the relay connection open).
2. In Cursor, ask the agent to call `pairrelay_get_session` or `pairrelay_post_message`.

## Commands

| Command | Description |
|---------|-------------|
| `pairrelay login` | Authenticate (GitHub OAuth or API key) |
| `pairrelay share` | Create and host a shared session |
| `pairrelay join <id>` | Join an existing session |
| `pairrelay post <msg>` | Post to the active session |
| `pairrelay leave` | Disconnect from the active session |
| `pairrelay mcp` | Start MCP server for Cursor |

## Tests

```bash
pnpm build
pnpm test
```

## Requirements

- Node.js 20+
- pnpm 10+
- Cursor with MCP enabled (or any MCP stdio client)
