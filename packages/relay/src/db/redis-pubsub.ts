import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";

const CHANNEL = "pairrelay:relay-events";

export interface RelayEventEnvelope {
  origin: string;
  sessionId: string;
  payload: string;
}

/**
 * Cross-machine WebSocket fanout. The publishing machine already broadcast locally;
 * subscribers apply the event to local store state and broadcast to their sockets.
 */
export class RelayEventBus {
  private readonly origin = randomUUID();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    // Without a listener, ioredis "error" events become unhandled and crash the process.
    this.publisher.on("error", (err) => {
      console.error("[redis] pubsub publisher error:", err.message);
    });
    this.subscriber.on("error", (err) => {
      console.error("[redis] pubsub subscriber error:", err.message);
    });
  }

  get instanceId(): string {
    return this.origin;
  }

  async start(onEvent: (envelope: RelayEventEnvelope) => void): Promise<void> {
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on("message", (_channel, raw) => {
      try {
        const envelope = JSON.parse(raw) as RelayEventEnvelope;
        if (envelope.origin === this.origin) {
          return;
        }
        onEvent(envelope);
      } catch {
        // ignore malformed pub/sub payloads
      }
    });
  }

  async publish(sessionId: string, payload: string): Promise<void> {
    const envelope: RelayEventEnvelope = {
      origin: this.origin,
      sessionId,
      payload,
    };
    await this.publisher.publish(CHANNEL, JSON.stringify(envelope));
  }

  async close(): Promise<void> {
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}
