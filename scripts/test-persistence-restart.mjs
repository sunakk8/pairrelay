/**
 * Phase 2A: kill the relay mid-session → restart → transcript still there.
 *
 * Requires local Redis + Postgres:
 *   DATABASE_URL=postgres://localhost/pairrelay
 *   REDIS_URL=redis://127.0.0.1:6379
 *
 * Run: node scripts/test-persistence-restart.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.PAIRRELAY_DATABASE_URL ?? "postgres://localhost/pairrelay";
const REDIS_URL = process.env.REDIS_URL ?? process.env.PAIRRELAY_REDIS_URL ?? "redis://127.0.0.1:6379";

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  PASS: ${name}`);
}

function fail(name, detail) {
  failed++;
  console.error(`  FAIL: ${name} — ${detail}`);
}

function assert(condition, name, detail = "assertion failed") {
  if (condition) pass(name);
  else fail(name, detail);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address()?.port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function startRelay(port) {
  const child = spawn("node", ["packages/relay/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PAIRRELAY_RELAY_PORT: String(port),
      PAIRRELAY_RELAY_HOST: "127.0.0.1",
      DATABASE_URL,
      REDIS_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay startup timeout\n${stderr}`)), 12000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`relay exited early code=${code}\n${stderr}`));
      }
    });
  });

  return { child, ready, getStderr: () => stderr };
}

function stopRelay(child) {
  return new Promise((resolve) => {
    child.on("exit", () => resolve());
    child.kill("SIGKILL");
    setTimeout(resolve, 2000);
  });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function waitSnapshot(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener(
      "message",
      (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "session.snapshot") resolve(payload.session);
        else reject(new Error(`expected snapshot, got ${payload.type}`));
      },
      { once: true },
    );
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function waitClose(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
  });
}

async function main() {
  console.log("Phase 2A persistence restart survival\n");
  console.log(`  DATABASE_URL=${DATABASE_URL}`);
  console.log(`  REDIS_URL=${REDIS_URL}\n`);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  console.log("1. Start relay with Redis + Postgres");
  let relay = startRelay(port);
  await relay.ready;
  const health = await fetchJson(`${base}/health`);
  assert(health.status === 200 && health.body?.ok === true, "health ok");
  assert(health.body?.persistence === true, "health reports persistence enabled", JSON.stringify(health.body));

  console.log("\n2. Create session and append messages over WebSocket");
  const { status, body: created } = await fetchJson(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "persist-test", branch: "main", files: ["a.ts"] } }),
  });
  assert(status === 200, "create session");

  const wsUrl = `${base.replace(/^http/, "ws")}/ws/${created.session_id}?participant=engineer-a&token=${created.join_token}`;
  const ws = new WebSocket(wsUrl);
  await waitOpen(ws);
  await waitSnapshot(ws);

  const contents = ["msg-one", "msg-two", "survive-restart"];
  for (const content of contents) {
    ws.send(
      JSON.stringify({
        type: "message.append",
        message: { role: "user", content, author: "engineer-a" },
      }),
    );
  }
  // Allow write-through to Redis + Postgres
  await new Promise((r) => setTimeout(r, 300));

  const before = await fetchJson(`${base}/sessions/${created.session_id}`);
  assert(
    contents.every((c) => before.body?.messages?.some((m) => m.content === c)),
    "messages present before kill",
    JSON.stringify(before.body?.messages?.map((m) => m.content)),
  );

  ws.close();
  await waitClose(ws);

  console.log("\n3. Kill relay process (simulates Fly app machine death)");
  await stopRelay(relay.child);

  console.log("\n4. Start fresh relay process (same Redis + Postgres)");
  relay = startRelay(port);
  await relay.ready;

  console.log("\n5. Reconnect and verify transcript");
  const after = await fetchJson(`${base}/sessions/${created.session_id}`);
  assert(after.status === 200, "session found after restart", `status=${after.status}`);
  assert(after.body?.context?.repo === "persist-test", "context survived");
  for (const content of contents) {
    assert(
      after.body?.messages?.some((m) => m.content === content),
      `message "${content}" survived restart`,
    );
  }

  const ws2 = new WebSocket(
    `${base.replace(/^http/, "ws")}/ws/${created.session_id}?participant=engineer-b&token=${created.join_token}`,
  );
  await waitOpen(ws2);
  const snap = await waitSnapshot(ws2);
  assert(
    contents.every((c) => snap.messages.some((m) => m.content === c)),
    "WS snapshot includes full transcript after restart",
  );
  assert(snap.participants.includes("engineer-b"), "rejoining participant listed");
  ws2.close();
  await waitClose(ws2);

  // Postgres-only cold path: flush Redis key then hydrate
  console.log("\n6. Cold hydrate from Postgres when Redis misses");
  const { execFileSync } = await import("node:child_process");
  execFileSync("redis-cli", ["del", `pairrelay:session:${created.session_id}`], { stdio: "pipe" });

  // New process so memory is empty too
  await stopRelay(relay.child);
  relay = startRelay(port);
  await relay.ready;

  const cold = await fetchJson(`${base}/sessions/${created.session_id}`);
  assert(cold.status === 200, "session hydrates from Postgres after Redis miss");
  assert(
    contents.every((c) => cold.body?.messages?.some((m) => m.content === c)),
    "Postgres hydrate restores messages",
  );

  await stopRelay(relay.child);

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
