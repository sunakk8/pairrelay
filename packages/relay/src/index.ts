#!/usr/bin/env node
import { DEFAULT_RELAY_PORT } from "@pairrelay/shared";
import { createRelayServer } from "./server.js";
import { authRequired, loadRelayAuthConfig } from "./auth.js";

const port = Number(process.env.PAIRRELAY_RELAY_PORT ?? DEFAULT_RELAY_PORT);
const host = process.env.PAIRRELAY_RELAY_HOST ?? "0.0.0.0";
const auth = loadRelayAuthConfig();

const { app, relayPublicUrl, githubOAuthEnabled } = await createRelayServer({
  host: "localhost",
  port,
  auth,
  publicUrl: process.env.PAIRRELAY_RELAY_PUBLIC_URL,
});

try {
  await app.listen({ port, host });
  console.log(`pairrelay relay listening on http://localhost:${port}`);
  console.log(`Public URL: ${relayPublicUrl}`);
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
