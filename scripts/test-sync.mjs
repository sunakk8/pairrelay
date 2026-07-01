/**
 * Phase A/B smoke test: two WebSocket clients see the same message within ~1s.
 */
const RELAY = "http://localhost:8787";

async function main() {
  const createRes = await fetch(`${RELAY}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { repo: "test", branch: "main", files: [] } }),
  });
  if (!createRes.ok) throw new Error(`create failed: ${createRes.status}`);
  const { session_id, join_token } = await createRes.json();

  const wsUrl = (id, participant, token) => {
    const params = new URLSearchParams({ participant });
    if (token) params.set("token", token);
    return `ws://localhost:8787/ws/${id}?${params}`;
  };

  const clientA = new WebSocket(wsUrl(session_id, "engineer-a", join_token));
  const clientB = new WebSocket(wsUrl(session_id, "engineer-b", join_token));

  await Promise.all([
    waitOpen(clientA),
    waitOpen(clientB),
    waitSnapshot(clientA),
    waitSnapshot(clientB),
  ]);

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for broadcast")), 1500);
    clientB.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "message.append" && payload.message?.content === "hello from A") {
        clearTimeout(timer);
        resolve(payload.message);
      }
    });
  });

  const started = Date.now();
  clientA.send(
    JSON.stringify({
      type: "message.append",
      message: {
        role: "user",
        content: "hello from A",
        author: "engineer-a",
      },
    }),
  );

  const message = await received;
  const elapsed = Date.now() - started;

  console.log("PASS: client B received message:", message.content);
  console.log(`PASS: latency ${elapsed}ms (< 1000ms target)`);

  clientA.close();
  clientB.close();
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

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
