import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";

import {
  type ClientEvent,
  type CreateSessionResponse,
  type SessionContext,
  type SessionMessage,
  parseRelayEvent,
  retrieveSessionContext,
  serializeRelayEvent,
} from "@pairrelay/shared";

import { SessionStore, type SessionStoreOptions } from "./store.js";
import { RelayEventBus } from "./db/redis-pubsub.js";
import {
  authRequired,
  extractApiKey,
  loadRelayAuthConfig,
  validateApiKey,
  type RelayAuthConfig,
} from "./auth.js";
import { signJoinToken, verifyJoinToken } from "./join-token.js";
import {
  buildGitHubAuthorizeUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeGitHubCode,
  githubOAuthEnabled,
  issueApiKey,
  loadGitHubAuthConfig,
  signCliCallback,
} from "./github-auth.js";
import { renderJoinLandingPage } from "./landing.js";

export interface RelayServerOptions {
  host?: string;
  port?: number;
  auth?: RelayAuthConfig;
  publicUrl?: string;
  store?: SessionStore;
  storeOptions?: SessionStoreOptions;
}

function unauthorized(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): unknown {
  return reply.code(401).send({ error: "Unauthorized" });
}

/** URL put in join links: explicit publicUrl / env, else localhost (never 0.0.0.0). */
function publicRelayUrl(options: RelayServerOptions): string {
  if (options.publicUrl) {
    return options.publicUrl.replace(/\/$/, "");
  }
  const env = process.env.PAIRRELAY_RELAY_PUBLIC_URL?.replace(/\/$/, "");
  if (env) {
    return env;
  }
  const host = options.host === "0.0.0.0" ? "localhost" : (options.host ?? "localhost");
  return `http://${host}:${options.port ?? 8787}`;
}

export async function createRelayServer(options: RelayServerOptions = {}) {
  const authConfig = options.auth ?? loadRelayAuthConfig();
  const relayPublicUrl = publicRelayUrl(options);
  const store = options.store ?? (await SessionStore.create(options.storeOptions ?? {}));
  const app = Fastify({ logger: false });
  await app.register(websocket);

  let eventBus: RelayEventBus | null = null;
  const busUrl = store.eventBusRedisUrl;
  if (busUrl) {
    eventBus = new RelayEventBus(busUrl);
    await eventBus.start((envelope) => {
      void (async () => {
        try {
          const event = parseRelayEvent(envelope.payload);
          if (event.type === "message.append") {
            await store.replicateMessage(envelope.sessionId, event.message);
          }
        } catch {
          // ignore malformed remote events
        }
        broadcast(envelope.sessionId, envelope.payload);
      })();
    });
  }

  app.get("/health", async () => {
    const backends = await store.healthCheck();
    return {
      ok: true,
      persistence: store.persistenceEnabled,
      redis: backends.redis,
      postgres: backends.postgres,
      pubsub: eventBus !== null,
    };
  });

  // In-process WS fanout; cross-machine fanout via Redis pub/sub when configured.
  const roomSockets = new Map<string, Set<WebSocket>>();
  const socketMeta = new Map<WebSocket, { sessionId: string; participantId: string }>();

  function countSocketsForParticipant(sessionId: string, participantId: string): number {
    let count = 0;
    for (const socket of getRoom(sessionId)) {
      if (socketMeta.get(socket)?.participantId === participantId) {
        count++;
      }
    }
    return count;
  }

  /** Drop this socket; only mark the participant gone when they have no remaining sockets. */
  function handleSocketLeave(socket: WebSocket): void {
    const meta = socketMeta.get(socket);
    if (!meta) {
      return;
    }
    socketMeta.delete(socket);
    getRoom(meta.sessionId).delete(socket);
    if (countSocketsForParticipant(meta.sessionId, meta.participantId) === 0) {
      void store.leaveParticipant(meta.sessionId, meta.participantId);
      fanout(
        meta.sessionId,
        serializeRelayEvent({ type: "participant.leave", participant: meta.participantId }),
      );
    }
  }

  function getRoom(sessionId: string): Set<WebSocket> {
    let room = roomSockets.get(sessionId);
    if (!room) {
      room = new Set();
      roomSockets.set(sessionId, room);
    }
    return room;
  }

  function broadcast(sessionId: string, payload: string, except?: WebSocket): void {
    for (const socket of getRoom(sessionId)) {
      if (socket !== except && socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /** Local WS broadcast + optional Redis pub/sub for other relay machines. */
  function fanout(sessionId: string, payload: string, except?: WebSocket): void {
    broadcast(sessionId, payload, except);
    if (eventBus) {
      void eventBus.publish(sessionId, payload);
    }
  }

  /** Bearer API key when auth is configured; no-op for open local relays. */
  function requireAuth(
    headers: Record<string, string | string[] | undefined>,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!authRequired(authConfig)) {
      return true;
    }
    const apiKey = extractApiKey(headers);
    if (!validateApiKey(authConfig, apiKey)) {
      unauthorized(reply);
      return false;
    }
    return true;
  }

  // GitHub OAuth: browser hits the relay, then GitHub, then we bounce the issued key
  // back to the CLI's loopback callback on cli_port.
  app.get<{ Querystring: { cli_port?: string } }>("/auth/github", async (request, reply) => {
    const ghConfig = loadGitHubAuthConfig();
    if (!ghConfig) {
      return reply.code(503).send({ error: "GitHub OAuth is not configured on this relay" });
    }

    const cliPort = Number(request.query.cli_port ?? 0);
    if (!Number.isInteger(cliPort) || cliPort < 1024 || cliPort > 65535) {
      return reply.code(400).send({ error: "cli_port query param required (1024-65535)" });
    }

    const state = createOAuthState(cliPort);
    const url = buildGitHubAuthorizeUrl(ghConfig, state);
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/github/callback",
    async (request, reply) => {
      const ghConfig = loadGitHubAuthConfig();
      if (!ghConfig) {
        return reply.code(503).send({ error: "GitHub OAuth is not configured" });
      }

      const { code, state } = request.query;
      if (!code || !state) {
        return reply.code(400).send({ error: "Missing code or state" });
      }

      const oauthState = consumeOAuthState(state);
      if (!oauthState) {
        return reply.code(400).send({ error: "Invalid or expired OAuth state" });
      }

      try {
        const user = await exchangeGitHubCode(ghConfig, code);
        const issued = issueApiKey(user.login, user.email, authConfig.secret);
        // HMAC so the CLI can trust this redirect came from this relay.
        const sig = signCliCallback(issued.apiKey, authConfig.secret);
        const redirect = new URL(`http://127.0.0.1:${oauthState.cliPort}/callback`);
        redirect.searchParams.set("api_key", issued.apiKey);
        redirect.searchParams.set("sig", sig);
        redirect.searchParams.set("github_login", user.login);
        if (user.email) {
          redirect.searchParams.set("email", user.email);
        }
        return reply.redirect(redirect.toString());
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth failed";
        return reply.code(500).send({ error: message });
      }
    },
  );

  // Browser landing page for a signed join link (install + join command).
  app.get<{ Params: { sessionId: string }; Querystring: { token?: string } }>(
    "/join/:sessionId",
    async (request, reply) => {
      const { sessionId } = request.params;
      const token = request.query.token;

      if (!token) {
        return reply.code(400).type("text/html").send("<h1>Missing join token</h1>");
      }

      const result = verifyJoinToken(token, sessionId, authConfig.secret);
      if (!result.valid) {
        return reply
          .code(403)
          .type("text/html")
          .send(`<h1>Invalid join link</h1><p>${result.reason ?? "Forbidden"}</p>`);
      }

      const session = await store.getSession(sessionId);
      if (!session) {
        return reply.code(404).type("text/html").send("<h1>Session not found or expired</h1>");
      }

      const html = renderJoinLandingPage({
        sessionId,
        token,
        relayUrl: relayPublicUrl,
        expiresAt: session.expires_at,
        repo: session.context.repo || undefined,
        branch: session.context.branch || undefined,
      });
      return reply.type("text/html").send(html);
    },
  );

  // Host: create session, mint join token, return join URL + CLI command.
  app.post<{ Body: { context?: Partial<SessionContext> } }>("/sessions", async (request, reply) => {
    if (!requireAuth(request.headers, reply)) {
      return;
    }

    const context: SessionContext = {
      repo: request.body?.context?.repo ?? "",
      branch: request.body?.context?.branch ?? "",
      files: request.body?.context?.files ?? [],
    };

    const sessionId = randomUUID();
    const joinToken = signJoinToken(sessionId, authConfig.secret);
    const session = await store.createSession(sessionId, context, joinToken);

    const joinCommandBase = `pairrelay join ${session.session_id} --token ${joinToken}`;
    const joinCommand = relayPublicUrl.includes("localhost")
      ? joinCommandBase
      : `${joinCommandBase} --relay-url ${relayPublicUrl}`;

    const joinPageUrl = `${relayPublicUrl}/join/${session.session_id}?token=${encodeURIComponent(joinToken)}`;

    const response: CreateSessionResponse = {
      session_id: session.session_id,
      join_token: joinToken,
      join_url: joinPageUrl,
      join_command: joinCommand,
      relay_url: relayPublicUrl,
      expires_at: session.expires_at,
    };
    return response;
  });

  // REST snapshot (join_token stripped). Live updates go over /ws.
  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
    if (!requireAuth(request.headers, reply)) {
      return;
    }
    const session = await store.getSession(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found or expired" });
    }
    // Never return the join token on the public GET.
    const { join_token: _token, ...publicSession } = session;
    return publicSession;
  });

  app.get<{
    Params: { sessionId: string };
    Querystring: { q?: string; include_history?: string; limit?: string };
  }>("/sessions/:sessionId/retrieve", async (request, reply) => {
    if (!requireAuth(request.headers, reply)) {
      return;
    }

    const query = request.query.q?.trim();
    if (!query) {
      return reply.code(400).send({ error: "q query param required" });
    }

    const session = await store.getSession(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found or expired" });
    }

    const limit = Math.min(Math.max(Number(request.query.limit ?? 5), 1), 20);
    const includeHistory = request.query.include_history === "1" || request.query.include_history === "true";
    let priorMessages: Array<SessionMessage & { session_id: string }> = [];
    if (includeHistory && session.context.repo) {
      priorMessages = await store.searchPriorMessages(session.context.repo, session.session_id, 200);
    }

    const { join_token: _token, ...publicSession } = session;
    const result = retrieveSessionContext(publicSession, query, {
      limit,
      priorMessages,
    });

    return result;
  });

  // Live session channel: API key + join token, then snapshot / join / append / leave.
  app.get<{
    Params: { sessionId: string };
    Querystring: { participant?: string; token?: string };
  }>("/ws/:sessionId", { websocket: true }, async (socket, request) => {
    const fakeReply = { code: () => ({ send: () => undefined }) };
    if (!requireAuth(request.headers, fakeReply)) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const { sessionId } = request.params;
    const joinToken = request.query.token;

    // Secured relay: join token required. Open local relay: token optional but must verify if sent.
    if (authRequired(authConfig)) {
      if (!joinToken) {
        socket.close(1008, "Join token required");
        return;
      }
      const result = verifyJoinToken(joinToken, sessionId, authConfig.secret);
      if (!result.valid) {
        socket.close(1008, result.reason ?? "Invalid join token");
        return;
      }
    } else if (joinToken) {
      const result = verifyJoinToken(joinToken, sessionId, authConfig.secret);
      if (!result.valid) {
        socket.close(1008, result.reason ?? "Invalid join token");
        return;
      }
    }

    const sessionCheck = await store.getSession(sessionId);
    if (!sessionCheck) {
      socket.close(1008, "Session not found or expired");
      return;
    }

    const participantId = request.query.participant ?? `participant-${randomUUID().slice(0, 8)}`;

    let session;
    try {
      session = await store.addParticipant(sessionId, participantId);
    } catch (error) {
      socket.close(1008, error instanceof Error ? error.message : "Join failed");
      return;
    }

    getRoom(sessionId).add(socket);
    socketMeta.set(socket, { sessionId, participantId });

    const { join_token: _token, ...publicSession } = session;
    // Snapshot first so the joiner has transcript/context before live events.
    socket.send(
      serializeRelayEvent({
        type: "session.snapshot",
        session: publicSession,
      }),
    );

    fanout(
      sessionId,
      serializeRelayEvent({
        type: "participant.join",
        participant: participantId,
      }),
      socket,
    );

    socket.on("message", (raw) => {
      void (async () => {
        try {
          const event = JSON.parse(raw.toString()) as ClientEvent;
          if (event.type === "participant.leave") {
            handleSocketLeave(socket);
            socket.close();
            return;
          }
          if (event.type !== "message.append") {
            return;
          }

          const message: SessionMessage = {
            role: event.message.role,
            content: event.message.content,
            author: event.message.author,
            timestamp: event.message.timestamp ?? new Date().toISOString(),
          };

          // Write path: memory → WS broadcast → Redis → Postgres
          store.appendMessage(sessionId, message);
          const payload = serializeRelayEvent({ type: "message.append", message });
          fanout(sessionId, payload);
          await store.persistMessage(sessionId, message);
        } catch {
          // ignore malformed client events
        }
      })();
    });

    socket.on("close", () => {
      handleSocketLeave(socket);
    });
  });

  return { app, store, relayPublicUrl, githubOAuthEnabled: githubOAuthEnabled(), eventBus };
}
