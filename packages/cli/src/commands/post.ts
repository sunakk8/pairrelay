import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { SessionMessage } from "@pairrelay/shared";
import { readCredentials } from "@pairrelay/shared";
import { SessionClient, readActiveSession } from "@pairrelay/daemon";

export interface PostOptions {
  role?: SessionMessage["role"];
  author?: string;
}

export async function runPost(content: string, options: PostOptions = {}): Promise<void> {
  const active = await readActiveSession();
  if (!active) {
    throw new Error(
      "No active session. Run `pairrelay share` or `pairrelay join <id>` first.",
    );
  }

  const credentials = await readCredentials();
  const config = {
    ...active,
    participant_id: `${hostname()}-post-${randomUUID().slice(0, 6)}`,
    api_key: active.api_key ?? credentials?.api_key,
  };

  const client = new SessionClient(config);
  await client.connect();

  const message = await client.postMessage(content, options.role ?? "user", options.author);
  client.disconnect();

  console.log(`Posted: ${message.author}: ${message.content}`);
}
