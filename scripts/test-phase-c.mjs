/**
 * Phase C autonomous test suite.
 * Run with: node scripts/test-phase-c.mjs
 *
 * Expects open relay on http://localhost:8787 (no auth).
 */
import { spawn } from "node:child_process";

const RELAY = "http://localhost:8787";

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
  return { status: res.status, body, text, headers: res.headers };
}

function wsUrl(sessionId, participant, token) {
  const base = RELAY.replace(/^http/, "ws");
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

async function testJoinPageAndResponseShape() {
  const { status, body } = await fetchJson(`${RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "phase-c", branch: "main", files: [] } }),
  });
  assert(status === 200, "create session returns 200");
  assert(body.join_url?.includes("/join/"), "join_url is HTTP landing page", body.join_url);
  assert(body.join_command?.includes("pairrelay join"), "join_command is CLI one-liner", body.join_command);
  assert(body.join_url?.includes("token="), "join_url includes token param");

  const page = await fetch(body.join_url);
  const html = await page.text();
  assert(page.status === 200, "join landing page returns 200");
  assert(html.includes("npm install -g pairrelay"), "landing page has install one-liner");
  assert(html.includes(body.join_command.split(" --token")[0]), "landing page has join command");
  assert(html.includes("phase-c"), "landing page shows repo context");

  return body;
}

async function testReconnectSameParticipant() {
  const { body: created } = await fetchJson(`${RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "reconnect", branch: "main", files: [] } }),
  });

  const participant = "reconnect-user";

  const ws1 = new WebSocket(wsUrl(created.session_id, participant, created.join_token));
  await waitOpen(ws1);
  const snap1 = await waitSnapshot(ws1);

  ws1.send(
    JSON.stringify({
      type: "message.append",
      message: { role: "user", content: "before-disconnect", author: participant },
    }),
  );

  await new Promise((r) => setTimeout(r, 100));
  ws1.close();
  await waitClose(ws1);

  const ws2 = new WebSocket(wsUrl(created.session_id, participant, created.join_token));
  await waitOpen(ws2);
  const snap2 = await waitSnapshot(ws2);

  assert(snap2.messages.some((m) => m.content === "before-disconnect"), "reconnect receives prior messages via snapshot");
  assert(snap1.session_id === snap2.session_id, "same session after reconnect");
  ws2.close();
}

async function testConcurrentParticipantLimitFreesSlot() {
  const { body: created } = await fetchJson(`${RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "slots", branch: "main", files: [] } }),
  });

  const p1 = new WebSocket(wsUrl(created.session_id, "slot-a", created.join_token));
  const p2 = new WebSocket(wsUrl(created.session_id, "slot-b", created.join_token));
  await Promise.all([waitOpen(p1), waitOpen(p2), waitSnapshot(p1), waitSnapshot(p2)]);

  p1.close();
  await waitClose(p1);

  const p3 = new WebSocket(wsUrl(created.session_id, "slot-c", created.join_token));
  await Promise.race([
    waitOpen(p3).then(() => waitSnapshot(p3)),
    waitClose(p3).then(() => {
      throw new Error("p3 rejected unexpectedly");
    }),
  ]);
  pass("slot frees when participant disconnects (max 2 concurrent)");

  p2.close();
  p3.close();
}

async function testParticipantRemovedOnDisconnect() {
  const { body: created } = await fetchJson(`${RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "leave", branch: "main", files: [] } }),
  });

  const participant = "leaver-1";
  const ws = new WebSocket(wsUrl(created.session_id, participant, created.join_token));
  await waitOpen(ws);
  const snap = await waitSnapshot(ws);
  assert(snap.participants.includes(participant), "participant listed while connected");

  ws.close();
  await waitClose(ws);
  await new Promise((r) => setTimeout(r, 100));

  const check = await fetchJson(`${RELAY}/sessions/${created.session_id}`);
  assert(
    !check.body?.participants?.includes(participant),
    "participant removed after disconnect",
    `still in: ${JSON.stringify(check.body?.participants)}`,
  );
}

async function testIdleExpiry() {
  const { createServer } = await import("node:net");
  const freePort = await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address()?.port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

  const relayEnv = {
    ...process.env,
    PAIRRELAY_TEST_IDLE_MS: "200",
    PAIRRELAY_RELAY_PORT: String(freePort),
  };

  const relay = spawn("node", ["packages/relay/dist/index.js"], {
    cwd: process.cwd(),
    env: relayEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("idle relay startup timeout")), 8000);
    relay.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    relay.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("EADDRINUSE")) {
        clearTimeout(timer);
        reject(new Error(text.trim()));
      }
    });
    relay.on("error", reject);
  });

  const idleRelay = `http://localhost:${freePort}`;

  try {
    const { body: created } = await fetchJson(`${idleRelay}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: { repo: "idle", branch: "main", files: [] } }),
    });

    const ws = new WebSocket(
      `${idleRelay.replace(/^http/, "ws")}/ws/${created.session_id}?participant=idle-user&token=${created.join_token}`,
    );
    await waitOpen(ws);
    await waitSnapshot(ws);
    ws.close();
    await waitClose(ws);

    await new Promise((r) => setTimeout(r, 400));

    const check = await fetchJson(`${idleRelay}/sessions/${created.session_id}`);
    assert(check.status === 404, "session expires after all disconnect (idle TTL)");
  } finally {
    relay.kill();
  }
}

async function testGitHubOAuthEndpoints() {
  const noConfig = await fetchJson(`${RELAY}/auth/github?cli_port=9876`);
  assert(noConfig.status === 503, "GitHub OAuth returns 503 when not configured");
}

async function testCliPackageMetadata() {
  const pkg = await import("../packages/cli/package.json", { with: { type: "json" } });
  assert(pkg.default.name === "pairrelay", "CLI package name is pairrelay");
  assert(pkg.default.bin?.pairrelay, "CLI exposes pairrelay bin");
  assert(!pkg.default.private, "CLI package is publishable");
}

async function main() {
  console.log("Phase C test suite\n");

  console.log("1. Join page + response shape");
  await testJoinPageAndResponseShape();

  console.log("\n2. Reconnect same participant (snapshot catch-up)");
  await testReconnectSameParticipant();

  console.log("\n3. Concurrent participant limit frees slot");
  await testConcurrentParticipantLimitFreesSlot();

  console.log("\n4. Participant removed on disconnect");
  await testParticipantRemovedOnDisconnect();

  console.log("\n5. GitHub OAuth endpoints");
  await testGitHubOAuthEndpoints();

  console.log("\n6. CLI package metadata");
  await testCliPackageMetadata();

  console.log("\n7. Idle expiry (isolated relay)");
  try {
    await testIdleExpiry();
  } catch (err) {
    fail("idle expiry test", err.message);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
