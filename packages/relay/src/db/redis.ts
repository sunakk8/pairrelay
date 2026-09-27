/**
 * Hot cache of the full session JSON (messages included). TTL tracks expires_at
 * so Redis does not outlive the join-token / idle window.
 */
import { Redis, type Redis as RedisClient } from "ioredis";

import type { StoredSession } from "../store.js";

const KEY_PREFIX = "pairrelay:session:";

export interface RedisSessionCache {
  client: RedisClient;
  get(sessionId: string): Promise<StoredSession | undefined>;
  set(session: StoredSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

function ttlSeconds(session: StoredSession): number {
  const ms = new Date(session.expires_at).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(ms / 1000));
}

export function createRedisSessionCache(redisUrl: string): RedisSessionCache {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  // Without a listener, ioredis "error" events become unhandled and crash the process.
  client.on("error", (err) => {
    console.error("[redis] session cache error:", err.message);
  });

  return {
    client,

    async get(sessionId: string): Promise<StoredSession | undefined> {
      const raw = await client.get(key(sessionId));
      if (!raw) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as StoredSession;
      } catch {
        // Corrupt blob: drop it so the next read falls through to Postgres.
        await client.del(key(sessionId));
        return undefined;
      }
    },

    async set(session: StoredSession): Promise<void> {
      await client.set(key(session.session_id), JSON.stringify(session), "EX", ttlSeconds(session));
    },

    async delete(sessionId: string): Promise<void> {
      await client.del(key(sessionId));
    },

    async close(): Promise<void> {
      await client.quit();
    },

    async ping(): Promise<boolean> {
      try {
        const res = await client.ping();
        return res === "PONG";
      } catch {
        return false;
      }
    },
  };
}
