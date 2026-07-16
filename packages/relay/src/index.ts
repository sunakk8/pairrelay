#!/usr/bin/env node
import { createRelayServer } from "./server.js";
import { authRequired, loadRelayAuthConfig } from "./auth.js";
import { resolvePublicUrl, resolveRelayPort } from "./deploy-env.js";

const port = resolveRelayPort();
const host = process.env.PAIRRELAY_RELAY_HOST ?? "0.0.0.0";
const auth = loadRelayAuthConfig();

const { app, relayPublicUrl, githubOAuthEnabled } = await createRelayServer({
  host: "localhost",
  port,
  auth,
  publicUrl: resolvePublicUrl(),
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
