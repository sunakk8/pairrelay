import { readFile, writeFile } from "node:fs/promises";
import { CREDENTIALS_PATH, PAIRRELAY_DIR } from "./paths.js";

export interface PairrelayCredentials {
  api_key: string;
  relay_url?: string;
}

export async function ensurePairrelayDir(): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(PAIRRELAY_DIR, { recursive: true });
}

export async function readCredentials(): Promise<PairrelayCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    const parsed = JSON.parse(raw) as PairrelayCredentials;
    if (!parsed.api_key) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCredentials(credentials: PairrelayCredentials): Promise<void> {
  await ensurePairrelayDir();
  await writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function formatAuthHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
