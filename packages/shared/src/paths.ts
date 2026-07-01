import { homedir } from "node:os";
import { join } from "node:path";

export const PAIRRELAY_DIR = join(homedir(), ".pairrelay");
export const ACTIVE_SESSION_PATH = join(PAIRRELAY_DIR, "active-session.json");
export const SESSION_CACHE_PATH = join(PAIRRELAY_DIR, "session-cache.json");
export const CREDENTIALS_PATH = join(PAIRRELAY_DIR, "credentials");

/** Signed join links expire 24h after session creation (Phase B/C). */
export const JOIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Session expires 1h after all participants disconnect (Phase C). */
export const SESSION_IDLE_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_RELAY_PORT = 8787;
export const DEFAULT_RELAY_URL = `http://localhost:${DEFAULT_RELAY_PORT}`;
