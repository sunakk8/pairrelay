import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  ACTIVE_SESSION_PATH,
  PAIRRELAY_DIR,
  SESSION_CACHE_PATH,
  type ActiveSessionConfig,
  type Session,
} from "@pairrelay/shared";

export async function ensurePairrelayDir(): Promise<void> {
  await mkdir(PAIRRELAY_DIR, { recursive: true });
}

export async function clearSessionCache(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(SESSION_CACHE_PATH);
  } catch {
    // no session cache file
  }
}

/**
 * Persist the active session and drop any stale session-cache.json so MCP
 * cannot serve a previous session after share/join switches sessions.
 */
export async function writeActiveSession(config: ActiveSessionConfig): Promise<void> {
  await ensurePairrelayDir();
  await clearSessionCache();
  await writeFile(ACTIVE_SESSION_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function readActiveSession(): Promise<ActiveSessionConfig | null> {
  try {
    const raw = await readFile(ACTIVE_SESSION_PATH, "utf8");
    return JSON.parse(raw) as ActiveSessionConfig;
  } catch {
    return null;
  }
}

export async function writeSessionCache(session: Session): Promise<void> {
  await ensurePairrelayDir();
  await writeFile(SESSION_CACHE_PATH, JSON.stringify(session, null, 2), "utf8");
}

export async function clearActiveSession(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(ACTIVE_SESSION_PATH);
  } catch {
    // no active session file
  }
}

export async function readSessionCache(): Promise<Session | null> {
  try {
    const raw = await readFile(SESSION_CACHE_PATH, "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}
