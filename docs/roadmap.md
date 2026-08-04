# pairrelay roadmap

Living plan for what ships next. RAG is on the roadmap but **not** for the current stage.

## Where we are

**Phase 1 (MVP) — complete**

- Core product: WebSocket relay, CLI `share` / `join`, MCP tools, auth, join tokens, landing page
- Hosted relay: `https://pairrelay.fly.dev`
- CLI on npm: `pairrelay@0.1.1`
- Two-laptop CLI share/join validated
- Agent↔agent MCP smoke test passed (A post → B get, and reverse)
- Project MCP config is sticky at `.cursor/mcp.json` (tracked in git)

```text
Phase1 MVP (done) → Phase2A persistence
    → Phase2B RAG (session memory, then repo)
    → Phase3 teams + metrics
```

---

## Immediate next

1. **Phase 2A — Persistence** (see below)
2. Optional release hygiene: confirm Fly secrets; keep **exactly 1** Fly machine until persistence exists; tag/publish if needed

**Phase 1 definition of done (met):** a teammate can `npm i -g pairrelay`, join a hosted session, and both Cursor agents can read/write the shared transcript via MCP.

---

## Phase 2 — Persistence + RAG (planned)

Goal: sessions survive relay restarts, and agents can pull *relevant* shared context instead of only a live transcript dump.

### 2A — Persistence (prerequisite for RAG)

- Store sessions and messages (e.g. Postgres)
- Survive relay restart; unlock >1 Fly machine later
- Session history available to joiners / MCP

### 2B — RAG over shared context (not now)

Not a generic “chat with your repo” feature. RAG feeds the **shared pairing session** so both agents see the same retrieved context.

| Capability | What it does |
|------------|----------------|
| Session-memory RAG | Retrieve relevant past decisions/messages from this or prior sessions |
| Optional repo RAG | Index file chunks; both agents see the same snippets in the shared transcript |
| MCP tool | e.g. `pairrelay_retrieve_context(query)` → results visible to both sides |

**Order:** persistence → embeddings/index → MCP retrieve tool → (later) repo chunking.

### 2C — Better handoff

- Augment or replace the rule-based summary with an LLM summary grounded in retrieved session memory

---

## Phase 3 — Teams and productization

- Real org/team auth (beyond a shared API key)
- Multi-participant sessions (>2) if needed
- Usage metrics (sessions, messages, sync latency p50/p95)
- Optional deeper IDE sync (files / agent state beyond transcript)

---

## Out of scope right now

- Implementing RAG
- Building persistence
- Team/org auth

Phase 1 is complete. Next implementation work is Phase 2A persistence.

---

## Suggested sequence

1. Start Phase 2 with **persistence only**
2. Add **session-memory RAG + MCP retrieve** once transcripts are stored
3. Repo RAG and teams after that

---

## Metrics path

| Stage | Quantifiable signals |
|-------|----------------------|
| Today | Sub-1s WebSocket sync (automated tests); npm + Fly shipping artifacts |
| After Phase 2 | Persisted session counts; retrieval latency; joins using retrieve |
| After Phase 3 | Sessions/day, downloads, latency percentiles |
