import { SessionClient, clearActiveSession, readActiveSession } from "@pairrelay/daemon";
import { readCredentials, type ActiveSessionConfig } from "@pairrelay/shared";

export async function runLeave(): Promise<void> {
  const active = await readActiveSession();
  if (!active) {
    console.log("No active session.");
    return;
  }

  const credentials = await readCredentials();
  const config: ActiveSessionConfig = {
    ...active,
    api_key: active.api_key ?? credentials?.api_key,
  };

  const client = new SessionClient(config);
  try {
    await client.connect();
    await client.leave();
  } catch {
    // relay unreachable — still clear local session state
  }

  await clearActiveSession();
  console.log(`Left session ${active.session_id}`);
}
