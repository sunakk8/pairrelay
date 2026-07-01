import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { type ActiveSessionConfig, readCredentials } from "@pairrelay/shared";
import { SessionClient, writeActiveSession, clearActiveSession } from "@pairrelay/daemon";
import { getSession, resolveRelayUrl } from "../relay-api.js";
import { attachClientLogging, waitForShutdown } from "./share.js";

export interface JoinOptions {
  relayUrl?: string;
  token?: string;
}

export async function runJoin(
  sessionId: string,
  options: JoinOptions,
): Promise<void> {
  const relayUrl = await resolveRelayUrl(options.relayUrl);
  await getSession(relayUrl, sessionId);

  if (!options.token) {
    console.warn(
      "Warning: no join token provided. This only works with an unsecured local relay.",
    );
  }

  const credentials = await readCredentials();
  const config: ActiveSessionConfig = {
    session_id: sessionId,
    relay_url: relayUrl,
    participant_id: `${hostname()}-${randomUUID().slice(0, 6)}`,
    join_token: options.token,
    api_key: credentials?.api_key,
  };

  await writeActiveSession(config);
  const client = new SessionClient(config, { reconnect: true });
  attachClientLogging(client, "join");

  await client.connectPersistent();

  console.log("");
  console.log(`Joined session ${sessionId}`);
  console.log(`  Relay: ${relayUrl}`);
  console.log("");
  console.log("Keeping relay connection open. Press Ctrl+C or run `pairrelay leave` to exit.");

  await waitForShutdown(async () => {
    await client.leave();
    await clearActiveSession();
    console.log("Left session.");
  });
}
