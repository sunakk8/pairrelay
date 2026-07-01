import type { CreateSessionResponse, Session, SessionContext } from "@pairrelay/shared";
import { formatAuthHeader, readCredentials } from "@pairrelay/shared";

async function authHeaders(): Promise<Record<string, string>> {
  const credentials = await readCredentials();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credentials?.api_key) {
    headers.authorization = formatAuthHeader(credentials.api_key);
  }
  return headers;
}

export async function createSession(
  relayUrl: string,
  context: SessionContext,
): Promise<CreateSessionResponse> {
  const response = await fetch(`${relayUrl}/sessions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ context }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as CreateSessionResponse;
}

export async function getSession(relayUrl: string, sessionId: string): Promise<Session> {
  const headers = await authHeaders();
  const response = await fetch(`${relayUrl}/sessions/${sessionId}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Session;
}

export async function resolveRelayUrl(override?: string): Promise<string> {
  if (override) {
    return override;
  }
  const credentials = await readCredentials();
  return credentials?.relay_url ?? "http://localhost:8787";
}
