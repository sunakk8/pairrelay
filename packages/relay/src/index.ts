#!/usr/bin/env node
import { createRelayServer } from "./server.js";
import { authRequired, loadRelayAuthConfig } from "./auth.js";
import { resolvePublicUrl, resolveRelayPort } from "./deploy-env.js";

const port = resolveRelayPort();
const host = process.env.PAIRRELAY_RELAY_HOST ?? "0.0.0.0";
const auth = loadRelayAuthConfig();

const { app, store, relayPublicUrl, githubOAuthEnabled, eventBus } = await createRelayServer({
  host: "localhost",
  port,
  auth,
  publicUrl: resolvePublicUrl(),
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down relay`);
  try {
    await app.close();
    await eventBus?.close();
    await store.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port, host });
  console.log(`pairrelay relay listening on http://localhost:${port}`);
  console.log(`Public URL: ${relayPublicUrl}`);
  if (store.persistenceEnabled) {
    const backends = await store.healthCheck();
    console.log(
      `Persistence: enabled (redis=${backends.redis ?? "off"}, postgres=${backends.postgres ?? "off"}, pubsub=${eventBus !== null})`,
    );
  } else {
    console.log("Persistence: disabled (memory-only)");
  }
  if (authRequired(auth)) {
    console.log("Auth: enabled (PAIRRELAY_RELAY_API_KEYS and/or GitHub OAuth)");
  } else {
    console.log("Auth: disabled (set PAIRRELAY_RELAY_API_KEYS or GitHub OAuth to enable)");
  }
  if (githubOAuthEnabled) {
    console.log("GitHub OAuth: enabled");
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
