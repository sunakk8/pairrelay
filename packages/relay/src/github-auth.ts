import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RelayAuthConfig } from "./auth.js";

export interface GitHubAuthConfig {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
}

export interface OAuthState {
  cliPort: number;
  nonce: string;
}

export interface IssuedApiKey {
  apiKey: string;
  githubLogin: string;
  email: string | null;
  createdAt: string;
}

const oauthStates = new Map<string, OAuthState>();
const issuedKeys = new Map<string, IssuedApiKey>();

export function loadGitHubAuthConfig(): GitHubAuthConfig | null {
  const clientId = process.env.PAIRRELAY_GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.PAIRRELAY_GITHUB_CLIENT_SECRET?.trim();
  const publicUrl = (
    process.env.PAIRRELAY_RELAY_PUBLIC_URL ?? `http://localhost:${process.env.PAIRRELAY_RELAY_PORT ?? 8787}`
  ).replace(/\/$/, "");

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, publicUrl };
}

export function githubOAuthEnabled(): boolean {
  return loadGitHubAuthConfig() !== null;
}

export function createOAuthState(cliPort: number): string {
  const nonce = randomBytes(16).toString("hex");
  const state = `${cliPort}:${nonce}`;
  oauthStates.set(state, { cliPort, nonce });
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
  return state;
}

export function consumeOAuthState(state: string): OAuthState | null {
  const parsed = oauthStates.get(state);
  oauthStates.delete(state);
  return parsed ?? null;
}

export function buildGitHubAuthorizeUrl(config: GitHubAuthConfig, state: string): string {
  const redirectUri = `${config.publicUrl}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGitHubCode(
  config: GitHubAuthConfig,
  code: string,
): Promise<{ login: string; email: string | null }> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${config.publicUrl}/auth/github/callback`,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) {
    throw new Error(tokenBody.error ?? "GitHub did not return an access token");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "pairrelay-relay",
    },
  });

  if (!userRes.ok) {
    throw new Error(`GitHub user fetch failed: ${userRes.status}`);
  }

  const user = (await userRes.json()) as { login: string; email?: string | null };

  let email = user.email ?? null;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "pairrelay-relay",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      email = primary?.email ?? null;
    }
  }

  return { login: user.login, email };
}

export function issueApiKey(githubLogin: string, email: string | null, secret: string): IssuedApiKey {
  const apiKey = `pr_${randomBytes(24).toString("base64url")}`;
  const record: IssuedApiKey = {
    apiKey,
    githubLogin,
    email,
    createdAt: new Date().toISOString(),
  };
  issuedKeys.set(apiKey, record);
  return record;
}

export function isIssuedApiKey(apiKey: string): boolean {
  return issuedKeys.has(apiKey);
}

export function validateApiKeyWithOAuth(authConfig: RelayAuthConfig, apiKey: string | null): boolean {
  if (!apiKey) {
    return false;
  }
  if (authConfig.apiKeys.has(apiKey)) {
    return true;
  }
  return issuedKeys.has(apiKey);
}

export function signCliCallback(apiKey: string, secret: string): string {
  return createHmac("sha256", secret).update(apiKey).digest("base64url");
}

export function verifyCliCallback(apiKey: string, sig: string, secret: string): boolean {
  const expected = signCliCallback(apiKey, secret);
  if (expected.length !== sig.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
