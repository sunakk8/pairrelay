import type { Session, SessionContext, SessionMessage } from "@pairrelay/shared";
import { JOIN_TOKEN_TTL_MS, SESSION_IDLE_TTL_MS } from "@pairrelay/shared";

const MAX_PARTICIPANTS = 2;

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

export interface StoredSession extends Session {
  join_token: string;
  expires_at: string;
}

export class SessionStore {
  private sessions = new Map<string, StoredSession>();
  private connections = new Map<string, Set<string>>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  createSession(sessionId: string, context: SessionContext, joinToken: string): StoredSession {
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
    return session;
  }

  getSession(sessionId: string): StoredSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    if (this.isExpired(session)) {
      this.deleteSession(sessionId);
      return undefined;
    }
    return session;
  }

  isExpired(session: StoredSession): boolean {
    return Date.now() > new Date(session.expires_at).getTime();
  }

  addParticipant(sessionId: string, participantId: string): StoredSession {
    const session = this.requireSession(sessionId);
    const connected = this.connections.get(sessionId)!;

    this.clearIdleTimer(sessionId);

    if (!connected.has(participantId)) {
      if (connected.size >= MAX_PARTICIPANTS) {
        throw new Error("Session is full (max 2 participants)");
      }
    }

    if (!session.participants.includes(participantId)) {
      session.participants.push(participantId);
    }

    connected.add(participantId);
    return session;
  }

  leaveParticipant(sessionId: string, participantId: string): void {
    const connected = this.connections.get(sessionId);
    connected?.delete(participantId);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.participants = session.participants.filter((id) => id !== participantId);
    }

    if (connected && connected.size === 0) {
      this.scheduleIdleExpiry(sessionId);
    }
  }

  appendMessage(sessionId: string, message: SessionMessage): SessionMessage {
    const session = this.requireSession(sessionId);
    session.messages.push(message);
    return message;
  }

  private scheduleIdleExpiry(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      const connected = this.connections.get(sessionId);
      if (session && connected && connected.size === 0) {
        session.expires_at = new Date().toISOString();
        this.deleteSession(sessionId);
      }
      this.idleTimers.delete(sessionId);
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

  private deleteSession(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    this.sessions.delete(sessionId);
    this.connections.delete(sessionId);
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found or expired: ${sessionId}`);
    }
    return session;
  }
}
