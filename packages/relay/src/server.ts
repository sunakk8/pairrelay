import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import websocket from "@fastify/websocket";

import type { WebSocket } from "ws";

import {

  type ClientEvent,

  type CreateSessionResponse,

  type SessionContext,

  type SessionMessage,

  serializeRelayEvent,

} from "@pairrelay/shared";

import { SessionStore } from "./store.js";

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

}



function unauthorized(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): unknown {

  return reply.code(401).send({ error: "Unauthorized" });

}



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

  const store = new SessionStore();

  const app = Fastify({ logger: false });

  await app.register(websocket);



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

  function handleSocketLeave(socket: WebSocket): void {
    const meta = socketMeta.get(socket);
    if (!meta) {
      return;
    }
    socketMeta.delete(socket);
    getRoom(meta.sessionId).delete(socket);
    if (countSocketsForParticipant(meta.sessionId, meta.participantId) === 0) {
      store.leaveParticipant(meta.sessionId, meta.participantId);
      broadcast(
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

        return reply.code(403).type("text/html").send(`<h1>Invalid join link</h1><p>${result.reason ?? "Forbidden"}</p>`);

      }



      const session = store.getSession(sessionId);

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

    const session = store.createSession(sessionId, context, joinToken);



    const joinCommand = `pairrelay join ${session.session_id} --token ${joinToken}`;

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



  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {

    if (!requireAuth(request.headers, reply)) {

      return;

    }

    const session = store.getSession(request.params.sessionId);

    if (!session) {

      return reply.code(404).send({ error: "Session not found or expired" });

    }

    const { join_token: _token, ...publicSession } = session;

    return publicSession;

  });



  app.get<{

    Params: { sessionId: string };

    Querystring: { participant?: string; token?: string };

  }>("/ws/:sessionId", { websocket: true }, (socket, request) => {

    const fakeReply = { code: () => ({ send: () => undefined }) };

    if (!requireAuth(request.headers, fakeReply)) {

      socket.close(1008, "Unauthorized");

      return;

    }



    const { sessionId } = request.params;

    const joinToken = request.query.token;



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



    const sessionCheck = store.getSession(sessionId);

    if (!sessionCheck) {

      socket.close(1008, "Session not found or expired");

      return;

    }



    const participantId = request.query.participant ?? `participant-${randomUUID().slice(0, 8)}`;



    let session;

    try {

      session = store.addParticipant(sessionId, participantId);

    } catch (error) {

      socket.close(1008, error instanceof Error ? error.message : "Join failed");

      return;

    }



    getRoom(sessionId).add(socket);
    socketMeta.set(socket, { sessionId, participantId });



    const { join_token: _token, ...publicSession } = session;

    socket.send(

      serializeRelayEvent({

        type: "session.snapshot",

        session: publicSession,

      }),

    );



    broadcast(

      sessionId,

      serializeRelayEvent({

        type: "participant.join",

        participant: participantId,

      }),

      socket,

    );



    socket.on("message", (raw) => {

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



        store.appendMessage(sessionId, message);

        const payload = serializeRelayEvent({ type: "message.append", message });

        broadcast(sessionId, payload);

      } catch {

        // ignore malformed client events

      }

    });



    socket.on("close", () => {

      handleSocketLeave(socket);

    });

  });



  return { app, store, relayPublicUrl, githubOAuthEnabled: githubOAuthEnabled() };

}


