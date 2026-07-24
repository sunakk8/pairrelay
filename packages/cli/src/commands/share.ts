import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { ACTIVE_SESSION_PATH, type ActiveSessionConfig, readCredentials } from "@pairrelay/shared";
import { SessionClient, writeActiveSession, clearActiveSession } from "@pairrelay/daemon";
import { detectRepoContext } from "../context.js";
import { createSession, resolveRelayUrl } from "../relay-api.js";

export interface ShareOptions {
  local?: boolean;
  relayUrl?: string;
}

export async function runShare(options: ShareOptions): Promise<void> {
  const relayUrl = await resolveRelayUrl(options.relayUrl);
  const credentials = await readCredentials();
  const context = await detectRepoContext();
  const created = await createSession(relayUrl, context);

  const config: ActiveSessionConfig = {
    session_id: created.session_id,
    relay_url: created.relay_url ?? relayUrl,
    participant_id: `${hostname()}-${randomUUID().slice(0, 6)}`,
    join_token: created.join_token,
    api_key: credentials?.api_key,
  };

  await writeActiveSession(config);
  console.log(`Active session written: ${ACTIVE_SESSION_PATH}`);
  console.log(`  session_id: ${created.session_id}`);

  const client = new SessionClient(config, { reconnect: true });
  attachClientLogging(client, "share");

  await client.connectPersistent();

  console.log("");
  console.log("Session shared.");
  console.log(`  Session ID:  ${created.session_id}`);
  console.log(`  Relay:       ${config.relay_url}`);
  console.log(`  Expires:     ${created.expires_at}`);
  console.log(`  Join page:   ${created.join_url}`);
  console.log(`  Join cmd:    ${created.join_command}`);
  if (context.repo) {
    console.log(`  Repo:        ${context.repo} (${context.branch})`);
    if (context.files.length > 0) {
      console.log(`  Files:       ${context.files.length} tracked (showing up to ${context.files.length})`);
    }
  }
  console.log("");
  console.log("Keeping relay connection open. Press Ctrl+C or run `pairrelay leave` to exit.");

  await waitForShutdown(async () => {
    await client.leave();
    await clearActiveSession();
    console.log("Left session.");
  });
}

function attachClientLogging(client: SessionClient, label: string): void {
  client.on("message", (message) => {
    console.log(`[${label}] ${message.author}: ${message.content}`);
  });
  client.on("participant", (participant) => {
    console.log(`[${label}] participant joined: ${participant}`);
  });
  client.on("left", (participant) => {
    console.log(`[${label}] participant left: ${participant}`);
  });
  client.on("error", (error) => {
    console.error(`[${label}] error:`, error.message);
  });
  client.on("reconnecting", (attempt) => {
    console.log(`[${label}] reconnecting (attempt ${attempt})...`);
  });
  client.on("reconnected", () => {
    console.log(`[${label}] reconnected — session state synced`);
  });
}

function waitForShutdown(onShutdown: () => void | Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = () => {
      void Promise.resolve(onShutdown()).then(resolve);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

export { attachClientLogging, waitForShutdown };
