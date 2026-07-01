import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  type ActiveSessionConfig,
  type ClientEvent,
  type RelayEvent,
  type Session,
  type SessionMessage,
  formatAuthHeader,
  parseRelayEvent,
  serializeClientEvent,
} from "@pairrelay/shared";
import { writeSessionCache } from "./cache.js";

export interface SessionClientOptions {
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  onReconnecting?: (attempt: number) => void;
}

export interface SessionClientEvents {
  snapshot: [Session];
  message: [SessionMessage];
  participant: [string];
  left: [string];
  connected: [];
  disconnected: [];
  reconnecting: [number];
  reconnected: [];
  error: [Error];
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;

export class SessionClient extends EventEmitter<SessionClientEvents> {
  private ws: WebSocket | null = null;
  private session: Session | null = null;
  private shouldReconnect: boolean;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectAttempts: number;

  constructor(
    private readonly activeConfig: ActiveSessionConfig,
    options: SessionClientOptions = {},
  ) {
    super();
    this.shouldReconnect = options.reconnect ?? false;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    if (options.onReconnecting) {
      this.on("reconnecting", options.onReconnecting);
    }
  }

  get currentSession(): Session | null {
    return this.session;
  }

  get config(): ActiveSessionConfig {
    return this.activeConfig;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.clearReconnectTimer();
    await this.openSocket();
    this.reconnectAttempts = 0;
  }

  async connectPersistent(): Promise<void> {
    this.shouldReconnect = true;
    await this.connect();
  }

  async postMessage(
    content: string,
    role: SessionMessage["role"] = "user",
    author?: string,
  ): Promise<SessionMessage> {
    const message: SessionMessage = {
      role,
      content,
      author: author ?? this.activeConfig.participant_id,
      timestamp: new Date().toISOString(),
    };

    const event: ClientEvent = {
      type: "message.append",
      message,
    };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to relay");
    }

    this.ws.send(serializeClientEvent(event));
    return message;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
  }

  async leave(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serializeClientEvent({ type: "participant.leave" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): Promise<void> {
    const wsUrl = this.buildWsUrl();
    const headers: Record<string, string> = {};
    if (this.activeConfig.api_key) {
      headers.Authorization = formatAuthHeader(this.activeConfig.api_key);
    }
    this.ws = new WebSocket(wsUrl, { headers });

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }

      const ws = this.ws;
      let settled = false;

      ws.once("open", () => {
        settled = true;
        this.emit("connected");
        if (this.reconnectAttempts > 0) {
          this.emit("reconnected");
        }
        resolve();
      });

      ws.once("error", (error) => {
        if (!settled) {
          settled = true;
          this.emit("error", error);
          reject(error);
        }
      });

      ws.on("message", (data) => {
        void this.handleMessage(data.toString());
      });

      ws.on("close", () => {
        this.ws = null;
        this.emit("disconnected");
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30_000);
    this.emit("reconnecting", this.reconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((error) => {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private buildWsUrl(): string {
    const base = this.activeConfig.relay_url.replace(/^http/, "ws");
    const url = new URL(`${base}/ws/${this.activeConfig.session_id}`);
    url.searchParams.set("participant", this.activeConfig.participant_id);
    if (this.activeConfig.join_token) {
      url.searchParams.set("token", this.activeConfig.join_token);
    }
    return url.toString();
  }

  private async handleMessage(raw: string): Promise<void> {
    let event: RelayEvent;
    try {
      event = parseRelayEvent(raw);
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      return;
    }

    switch (event.type) {
      case "session.snapshot":
        this.session = event.session;
        await writeSessionCache(event.session);
        this.emit("snapshot", event.session);
        break;
      case "message.append":
        if (this.session) {
          const exists = this.session.messages.some(
            (m) => m.timestamp === event.message.timestamp && m.content === event.message.content,
          );
          if (!exists) {
            this.session.messages.push(event.message);
            await writeSessionCache(this.session);
          }
        }
        this.emit("message", event.message);
        break;
      case "participant.join":
        this.emit("participant", event.participant);
        break;
      case "participant.leave":
        if (this.session) {
          this.session.participants = this.session.participants.filter(
            (id) => id !== event.participant,
          );
          await writeSessionCache(this.session);
        }
        this.emit("left", event.participant);
        break;
    }
  }
}
