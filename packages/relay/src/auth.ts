import { parseBearerToken } from "@pairrelay/shared";
import { githubOAuthEnabled, validateApiKeyWithOAuth } from "./github-auth.js";

export interface RelayAuthConfig {
  apiKeys: Set<string>;
  secret: string;
}

export function loadRelayAuthConfig(): RelayAuthConfig {
  const rawKeys = process.env.PAIRRELAY_RELAY_API_KEYS ?? "";
  const apiKeys = new Set(
    rawKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  const secret = process.env.PAIRRELAY_RELAY_SECRET ?? "pairrelay-local-dev-secret";
  return { apiKeys, secret };
}

export function authRequired(config: RelayAuthConfig): boolean {
  return config.apiKeys.size > 0 || githubOAuthEnabled();
}

export function validateApiKey(config: RelayAuthConfig, apiKey: string | null): boolean {
  if (!authRequired(config)) {
    return true;
  }
  return validateApiKeyWithOAuth(config, apiKey);
}

export function extractApiKey(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers.authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  return parseBearerToken(value);
}
