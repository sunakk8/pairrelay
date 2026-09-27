import type { Session, SessionContext, SessionMessage } from "@pairrelay/shared";
import { JOIN_TOKEN_TTL_MS, SESSION_IDLE_TTL_MS } from "@pairrelay/shared";

import { createPostgresStore, type PostgresStore } from "./db/postgres.js";
import { createRedisSessionCache, type RedisSessionCache } from "./db/redis.js";

const MAX_PARTICIPANTS = 2;

/** Tests can shrink idle expiry so they don't wait the production 1h TTL. */
function idleTtlMs(): number {
  const testOverride = process.env.PAIRRELAY_TEST_IDLE_MS;
  if (testOverride) {
    const parsed = Number(testOverride);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return SESSION_IDLE_TTL_MS;
}

/** Session plus join token + expiry — never sent to clients as-is. */
export interface StoredSession extends Session {
  join_token: string;
  expires_at: string;
}

export interface SessionStoreOptions {
  databaseUrl?: string;
  redisUrl?: string;
  /** Injected backends (tests). */
  postgres?: PostgresStore | null;
  redis?: RedisSessionCache | null;
}

/**
 * Session state across three layers:
 *   memory  — live WS process (participants + messages)
 *   Redis   — hot cache of the full session JSON (survives app restart)
 *   Postgres — durable session row + ordered message log
 *
 * Missing DATABASE_URL / REDIS_URL → memory-only (local/dev tests).
 */
export class SessionStore {
  private sessions = new Map<string, StoredSession>();
  /** Currently connected participant IDs (live sockets). Distinct from the persisted roster. */
  private connections = new Map<string, Set<string>>();
  /** Idle-expiry timers: fire after the last participant disconnects. */
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private postgres: PostgresStore | null = null;
  private redis: RedisSessionCache | null = null;
  private redisUrl: string | null = null;

  static async create(options: SessionStoreOptions = {}): Promise<SessionStore> {
    const store = new SessionStore();
    await store.init(options);
    return store;
  }

  private async init(options: SessionStoreOptions): Promise<void> {
    if (options.postgres !== undefined) {
      this.postgres = options.postgres;
    } else {
      const databaseUrl =
        options.databaseUrl ?? process.env.DATABASE_URL ?? process.env.PAIRRELAY_DATABASE_URL;
      if (databaseUrl) {
        this.postgres = createPostgresStore(databaseUrl);
        await this.postgres.migrate();
      }
    }

    if (options.redis !== undefined) {
      this.redis = options.redis;
    } else {
      const redisUrl = options.redisUrl ?? process.env.REDIS_URL ?? process.env.PAIRRELAY_REDIS_URL;
      if (redisUrl) {
        this.redisUrl = redisUrl;
        this.redis = createRedisSessionCache(redisUrl);
      }
    }
  }

  get eventBusRedisUrl(): string | null {
    return this.redisUrl;
  }

  get persistenceEnabled(): boolean {
    return this.postgres !== null || this.redis !== null;
  }

  async createSession(
    sessionId: string,
    context: SessionContext,
    joinToken: string,
  ): Promise<StoredSession> {
    const createdAt = new Date().toISOString();
    const session: StoredSession = {
      session_id: sessionId,
      created_at: createdAt,
      participants: [],
      messages: [],
      context,
      join_token: joinToken,
      expires_at: new Date(Date.now() + JOIN_TOKEN_TTL_MS).toISOString(),
    };
    this.sessions.set(session.session_id, session);
    this.connections.set(session.session_id, new Set());

    // Write-through: Redis first (hot), then Postgres (durable metadata; messages append later).
    await this.redis?.set(session);
    await this.postgres?.insertSession(session);
    return session;
  }

  /** Read path: memory → Redis → hydrate from Postgres. */
  async getSession(sessionId: string): Promise<StoredSession | undefined> {
    const memory = this.sessions.get(sessionId);
    if (memory) {
      if (this.isExpired(memory)) {
        await this.deleteSession(sessionId);
        return undefined;
      }
      return memory;
    }

    const fromRedis = await this.redis?.get(sessionId);
    if (fromRedis) {
      if (this.isExpired(fromRedis)) {
        await this.deleteSession(sessionId);
        return undefined;
      }
      this.hydrateMemory(fromRedis);
      return fromRedis;
    }

    const fromPg = await this.postgres?.loadSession(sessionId);
    if (fromPg) {
      if (this.isExpired(fromPg)) {
        await this.deleteSession(sessionId);
        return undefined;
      }
      this.hydrateMemory(fromPg);
      await this.redis?.set(fromPg);
      return fromPg;
    }

    return undefined;
  }

  isExpired(session: StoredSession): boolean {
    return Date.now() > new Date(session.expires_at).getTime();
  }

  async addParticipant(sessionId: string, participantId: string): Promise<StoredSession> {
    const session = await this.requireSession(sessionId);
    const connected = this.connections.get(sessionId)!;

    this.clearIdleTimer(sessionId);

    // Same participant reconnecting (e.g. daemon restart) does not consume a slot.
    if (!connected.has(participantId)) {
      if (connected.size >= MAX_PARTICIPANTS) {
        throw new Error("Session is full (max 2 participants)");
      }
    }

    if (!session.participants.includes(participantId)) {
      session.participants.push(participantId);
    }

    connected.add(participantId);
    await this.redis?.set(session);
    return session;
  }

  async leaveParticipant(sessionId: string, participantId: string): Promise<void> {
    const connected = this.connections.get(sessionId);
    connected?.delete(participantId);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.participants = session.participants.filter((id) => id !== participantId);
      await this.redis?.set(session);
    }

    // Empty room starts the idle clock; a later join cancels it.
    if (connected && connected.size === 0) {
      this.scheduleIdleExpiry(sessionId);
    }
  }

  /** In-memory append. Caller broadcasts, then persistMessage. */
  appendMessage(sessionId: string, message: SessionMessage): SessionMessage {
    const session = this.requireSessionSync(sessionId);
    session.messages.push(message);
    return message;
  }

  /** After WS broadcast: Redis snapshot → Postgres append (seq = 1-based index in memory). */
  async persistMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    const seq = session.messages.length;
    await this.redis?.set(session);
    await this.postgres?.appendMessage(sessionId, message, seq);
  }

  /**
   * Apply a message received from another relay machine (pub/sub).
   * Updates memory + Redis only — Postgres write happened on the origin machine.
   */
  async replicateMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return;
    }
    const exists = session.messages.some(
      (m) => m.timestamp === message.timestamp && m.content === message.content,
    );
    if (exists) {
      return;
    }
    session.messages.push(message);
    await this.redis?.set(session);
  }

  async searchPriorMessages(
    repo: string,
    excludeSessionId: string,
    limit = 200,
  ): Promise<Array<SessionMessage & { session_id: string }>> {
    if (!this.postgres || !repo) {
      return [];
    }
    return this.postgres.searchMessagesForRepo(repo, excludeSessionId, limit);
  }

  async healthCheck(): Promise<{ redis: boolean | null; postgres: boolean | null }> {
    const redis = this.redis ? await this.redis.ping() : null;
    const postgres = this.postgres ? await this.postgres.ping() : null;
    return { redis, postgres };
  }

  async close(): Promise<void> {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    await this.redis?.close();
    await this.postgres?.close();
  }

  private hydrateMemory(session: StoredSession): void {
    // WS sockets died with the process, so the live roster is empty until clients reconnect.
    session.participants = [];
    this.sessions.set(session.session_id, session);
    if (!this.connections.has(session.session_id)) {
      this.connections.set(session.session_id, new Set());
    }
  }

  /** After idle TTL with nobody connected: stamp expiry, then drop from all layers. */
  private scheduleIdleExpiry(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    const timer = setTimeout(() => {
      void (async () => {
        const session = this.sessions.get(sessionId);
        const connected = this.connections.get(sessionId);
        if (session && connected && connected.size === 0) {
          session.expires_at = new Date().toISOString();
          await this.postgres?.updateExpiresAt(sessionId, session.expires_at);
          await this.deleteSession(sessionId);
        }
        this.idleTimers.delete(sessionId);
      })();
    }, idleTtlMs());
    this.idleTimers.set(sessionId, timer);
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  /** Drop from memory, Redis, and Postgres (idle expiry or already-expired read). */
  private async deleteSession(sessionId: string): Promise<void> {
    this.clearIdleTimer(sessionId);
    this.sessions.delete(sessionId);
    this.connections.delete(sessionId);
    await this.redis?.delete(sessionId);
    await this.postgres?.deleteSession(sessionId);
  }

  private async requireSession(sessionId: string): Promise<StoredSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found or expired: ${sessionId}`);
    }
    return session;
  }

  private requireSessionSync(sessionId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session || this.isExpired(session)) {
      throw new Error(`Session not found or expired: ${sessionId}`);
    }
    return session;
  }
}
