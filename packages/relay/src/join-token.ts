import { createHmac, timingSafeEqual } from "node:crypto";
import { JOIN_TOKEN_TTL_MS } from "@pairrelay/shared";

export interface JoinTokenPayload {
  session_id: string;
  exp: number;
}

function encodePayload(payload: JoinTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encoded: string): JoinTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as JoinTokenPayload;
    if (!parsed.session_id || typeof parsed.exp !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signJoinToken(sessionId: string, secret: string, createdAt = Date.now()): string {
  const payload: JoinTokenPayload = {
    session_id: sessionId,
    exp: createdAt + JOIN_TOKEN_TTL_MS,
  };
  const encoded = encodePayload(payload);
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyJoinToken(
  token: string,
  sessionId: string,
  secret: string,
): { valid: boolean; reason?: string } {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "Malformed join token" };
  }

  const [encoded, sig] = parts as [string, string];
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "Invalid join token signature" };
  }

  const payload = decodePayload(encoded);
  if (!payload) {
    return { valid: false, reason: "Invalid join token payload" };
  }

  if (payload.session_id !== sessionId) {
    return { valid: false, reason: "Join token does not match session" };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, reason: "Join link has expired" };
  }

  return { valid: true };
}

export function joinTokenExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + JOIN_TOKEN_TTL_MS).toISOString();
}
