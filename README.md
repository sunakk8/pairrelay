# pairrelay

Live shared AI coding sessions for engineering teams. Connect Cursor (or any MCP client) to a teammate's session via CLI + WebSocket relay.

## Install

```bash
npm install -g pairrelay
```

From source (development):

```bash
git clone https://github.com/sunakk8/pairrelay.git
cd pairrelay
pnpm install
pnpm build
pnpm setup
cd packages/cli && pnpm link --global
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

Optional auth:

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

## Cloud deploy (two laptops)

The relay is a WebSocket server — both laptops connect to the **same hosted relay** instead of one machine exposing a LAN port.

### Fly.io vs Railway

| | **Fly.io** (recommended) | **Railway** |
|---|---|---|
| WebSockets | First-class, long-lived connections | Supported |
| Idle behavior | `auto_stop_machines = off` in `fly.toml` keeps sessions alive | Service stays up on paid plans |
| Setup | `fly launch` + `fly secrets set` | Connect repo, set env vars |
| Public URL | Auto: `https://<app>.fly.dev` | Auto: `https://<id>.up.railway.app` |

**Recommendation: Fly.io** for pairrelay — WebSocket sessions can run for hours and Fly is built around persistent connections. Railway is fine for a quick test if you already use it.

### 1. Deploy the relay

**Fly.io:**

```bash
fly launch          # picks Dockerfile + fly.toml; choose a unique app name
fly secrets set \
  PAIRRELAY_RELAY_API_KEYS="your-team-key" \
  PAIRRELAY_RELAY_SECRET="$(openssl rand -hex 32)"
fly deploy
```

**Railway:** New project → Deploy from GitHub → set the same secrets from `.env.example` in the Railway dashboard → deploy.

`PAIRRELAY_RELAY_PUBLIC_URL` is optional on both platforms (auto-detected from `FLY_APP_NAME` or `RAILWAY_PUBLIC_DOMAIN`).

### 2. Configure both laptops

On **each** machine:

```bash
pairrelay login --relay-url https://your-relay.fly.dev --api-key your-team-key
```

Copy `mcp.json.example` into Cursor MCP settings (see above).

### 3. Start a session

**Laptop A (host):**

```bash
pairrelay share --relay-url https://your-relay.fly.dev
```

Copy the `Join cmd` line from the output.

**Laptop B (joiner):**

```bash
pairrelay join <session-id> --token <token> --relay-url https://your-relay.fly.dev
```

Both laptops keep `share` / `join` running in a terminal. Ask Cursor to call `pairrelay_get_session` or `pairrelay_post_message`.

## Publish to npm (maintainers)

Publishes three packages: `@pairrelay/shared`, `@pairrelay/daemon`, and `pairrelay`.

**One-time setup:**
1. Create the `@pairrelay` org at [npmjs.com](https://www.npmjs.com/org/create) (free for public packages)
2. Log in: `npm login`
3. Add your npm user to the `@pairrelay` org

**Publish a new version** (bump `0.1.1` in all three `package.json` files first):

```bash
pnpm publish:npm
```

Uses `--no-git-checks` so you can publish without committing first. Commit/tag releases when you're ready to track them in git.

**Laptop B — install or update:**

```bash
npm install -g pairrelay@latest
pairrelay --help
```

## Requirements

- Node.js 20+
- pnpm 10+
- Cursor with MCP enabled (or any MCP stdio client)
