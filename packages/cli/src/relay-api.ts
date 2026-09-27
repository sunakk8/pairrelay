import type { CreateSessionResponse, RetrieveContextResult, Session, SessionContext } from "@pairrelay/shared";
import { formatAuthHeader, readCredentials } from "@pairrelay/shared";

async function authHeaders(): Promise<Record<string, string>> {
  const credentials = await readCredentials();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credentials?.api_key) {
    headers.authorization = formatAuthHeader(credentials.api_key);
  }
  return headers;
}

/** POST /sessions — host path. Returns join token, join URL, and CLI command. */
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

export async function retrieveSessionContext(
  relayUrl: string,
  sessionId: string,
  query: string,
  options: { includeHistory?: boolean; limit?: number } = {},
): Promise<RetrieveContextResult> {
  const headers = await authHeaders();
  const url = new URL(`${relayUrl}/sessions/${sessionId}/retrieve`);
  url.searchParams.set("q", query);
  if (options.includeHistory) {
    url.searchParams.set("include_history", "true");
  }
  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to retrieve context: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as RetrieveContextResult;
}

/** Flag → credentials.relay_url → localhost. */
export async function resolveRelayUrl(override?: string): Promise<string> {
  if (override) {
    return override;
  }
  const credentials = await readCredentials();
  return credentials?.relay_url ?? "http://localhost:8787";
}
