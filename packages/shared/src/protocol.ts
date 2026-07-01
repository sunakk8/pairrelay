import type { Session, SessionMessage } from "./types.js";

export type RelayEvent =
  | { type: "session.snapshot"; session: Session }
  | { type: "message.append"; message: SessionMessage }
  | { type: "participant.join"; participant: string }
  | { type: "participant.leave"; participant: string };

export type ClientEvent =
  | { type: "message.append"; message: Omit<SessionMessage, "timestamp"> & { timestamp?: string } }
  | { type: "participant.leave" };

export function parseRelayEvent(data: string): RelayEvent {
  const parsed = JSON.parse(data) as RelayEvent;
  if (!parsed?.type) {
    throw new Error("Invalid relay event: missing type");
  }
  return parsed;
}

export function serializeRelayEvent(event: RelayEvent): string {
  return JSON.stringify(event);
}

export function serializeClientEvent(event: ClientEvent): string {
  return JSON.stringify(event);
}
