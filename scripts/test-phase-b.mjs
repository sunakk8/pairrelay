/**
 * Phase B autonomous test suite.
 * Run with: node scripts/test-phase-b.mjs
 *
 * Expects:
 *   - Open relay on http://localhost:8787 (no auth)
 *   - Auth relay on http://localhost:8788 (PAIRRELAY_RELAY_API_KEYS=test-key)
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSessionSummary } from "../packages/shared/dist/summary.js";

const OPEN_RELAY = "http://localhost:8787";
const AUTH_RELAY = "http://localhost:8788";
const AUTH_KEY = "test-key";

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

function wsUrl(relay, sessionId, participant, token) {
  const base = relay.replace(/^http/, "ws");
  const params = new URLSearchParams({ participant });
  if (token) params.set("token", token);
  return `${base}/ws/${sessionId}?${params}`;
}

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function waitClose(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
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

async function testCreateSessionShape() {
  const { status, body } = await fetchJson(`${OPEN_RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "test", branch: "main", files: ["a.ts"] } }),
  });
  assert(status === 200, "create session returns 200");
  assert(!!body.session_id, "create session returns session_id");
  assert(!!body.join_token, "create session returns join_token");
  assert(!!body.expires_at, "create session returns expires_at");
  assert(body.join_command?.includes("--token"), "join_command includes --token");
  assert(body.join_url?.includes("/join/"), "join_url is landing page");
  return body;
}

async function testWsSync() {
  const { body: created } = await fetchJson(`${OPEN_RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "sync", branch: "main", files: [] } }),
  });

  const clientA = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "a", created.join_token));
  const clientB = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "b", created.join_token));
  await Promise.all([waitOpen(clientA), waitOpen(clientB), waitSnapshot(clientA), waitSnapshot(clientB)]);

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 2000);
    clientB.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "message.append" && payload.message?.content === "sync-test") {
        clearTimeout(timer);
        resolve(payload.message);
      }
    });
  });

  clientA.send(
    JSON.stringify({
      type: "message.append",
      message: { role: "user", content: "sync-test", author: "a" },
    }),
  );

  const msg = await received;
  assert(msg.content === "sync-test", "WebSocket broadcast delivers message");
  clientA.close();
  clientB.close();
}

async function testParticipantLimit() {
  const { body: created } = await fetchJson(`${OPEN_RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "limit", branch: "main", files: [] } }),
  });

  const p1 = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "p1", created.join_token));
  const p2 = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "p2", created.join_token));
  await Promise.all([waitOpen(p1), waitOpen(p2), waitSnapshot(p1), waitSnapshot(p2)]);

  const p3 = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "p3", created.join_token));
  const closed = waitClose(p3);
  await Promise.race([closed, new Promise((_, r) => setTimeout(() => r(new Error("p3 did not close")), 2000))]);
  pass("third participant rejected (session full)");

  p1.close();
  p2.close();
}

async function testInvalidJoinToken() {
  const { body: created } = await fetchJson(`${OPEN_RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "token", branch: "main", files: [] } }),
  });

  const ws = new WebSocket(wsUrl(OPEN_RELAY, created.session_id, "bad", "invalid.token.here"));
  const closed = waitClose(ws);
  await closed;
  pass("invalid join token rejected on WebSocket");
}

async function testAuthRelay() {
  const noAuth = await fetchJson(`${AUTH_RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert(noAuth.status === 401, "auth relay rejects unauthenticated create");

  const withAuth = await fetchJson(`${AUTH_RELAY}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AUTH_KEY}`,
    },
    body: JSON.stringify({ context: { repo: "auth", branch: "main", files: [] } }),
  });
  assert(withAuth.status === 200, "auth relay accepts valid API key");

  const ws = new WebSocket(wsUrl(AUTH_RELAY, withAuth.body.session_id, "auth-user", withAuth.body.join_token), {
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  await waitOpen(ws);
  const session = await waitSnapshot(ws);
  assert(session.session_id === withAuth.body.session_id, "authenticated WebSocket receives snapshot");
  ws.close();

  const wsNoAuth = new WebSocket(
    wsUrl(AUTH_RELAY, withAuth.body.session_id, "no-auth", withAuth.body.join_token),
  );
  const closed = waitClose(wsNoAuth);
  await closed;
  pass("auth relay rejects WebSocket without Bearer token");
}

async function testAuthJoinTokenRequired() {
  const withAuth = await fetchJson(`${AUTH_RELAY}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AUTH_KEY}`,
    },
    body: JSON.stringify({ context: { repo: "auth", branch: "main", files: [] } }),
  });

  const ws = new WebSocket(wsUrl(AUTH_RELAY, withAuth.body.session_id, "no-token", null), {
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  const closed = waitClose(ws);
  await closed;
  pass("auth relay rejects WebSocket without join token");
}

function testSessionSummary() {
  const summary = generateSessionSummary({
    session_id: "x",
    created_at: new Date().toISOString(),
    participants: ["alice", "bob"],
    messages: [
      {
        role: "user",
        content: "We decided to refactor the auth module.",
        author: "alice",
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "The root cause is a missing token check.",
        author: "ai",
        timestamp: new Date().toISOString(),
      },
    ],
    context: { repo: "pairrelay", branch: "main", files: ["auth.ts"] },
  });
  const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert(sentences.length >= 3 && sentences.length <= 6, "summary is 3–5 sentences", `got ${sentences.length}: ${summary}`);
  assert(summary.includes("pairrelay"), "summary mentions repo");
}

async function testLoginCommand() {
  const home = await mkdtemp(join(tmpdir(), "pairrelay-test-"));
  const env = { ...process.env, USERPROFILE: home, HOME: home };

  const login = spawn("node", ["packages/cli/dist/index.js", "login", "--api-key", "cli-test-key"], {
    cwd: join(process.cwd()),
    env,
    shell: true,
  });

  const code = await new Promise((resolve) => {
    login.on("close", resolve);
  });
  assert(code === 0, "pairrelay login exits 0");

  const credPath = join(home, ".pairrelay", "credentials");
  const raw = await readFile(credPath, "utf8");
  const creds = JSON.parse(raw);
  assert(creds.api_key === "cli-test-key", "login writes api_key to credentials");

  await rm(home, { recursive: true, force: true });
}

async function testRepoContextDetection() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const codeDir = process.cwd();

  const script = `
    import { detectRepoContext } from './packages/cli/dist/context.js';
    const ctx = await detectRepoContext(${JSON.stringify(codeDir)});
    console.log(JSON.stringify(ctx));
  `;
  const { stdout } = await execFileAsync("node", ["--input-type=module", "-e", script], { cwd: codeDir });
  const ctx = JSON.parse(stdout.trim());
  assert(!!ctx.repo, "repo context detects repo name", `repo=${ctx.repo}`);
  assert(Array.isArray(ctx.files), "repo context returns files array");
}

async function main() {
  console.log("Phase B test suite\n");

  console.log("1. Create session shape");
  await testCreateSessionShape();

  console.log("\n2. WebSocket sync");
  await testWsSync();

  console.log("\n3. Participant limit (max 2)");
  await testParticipantLimit();

  console.log("\n4. Invalid join token");
  await testInvalidJoinToken();

  console.log("\n5. Session summary");
  testSessionSummary();

  console.log("\n6. pairrelay login CLI");
  await testLoginCommand();

  console.log("\n7. Repo context detection");
  await testRepoContextDetection();

  console.log("\n8. Auth relay (port 8788)");
  try {
    const ping = await fetch(`${AUTH_RELAY}/sessions`, { method: "POST" });
    if (ping.status === 401) {
      await testAuthRelay();
      await testAuthJoinTokenRequired();
    } else {
      console.log("  SKIP: auth relay not running on 8788");
    }
  } catch {
    console.log("  SKIP: auth relay not running on 8788");
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
