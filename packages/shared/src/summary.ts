import type { Session, SessionMessage } from "./types.js";

const MAX_SUMMARY_MESSAGES = 20;

function isDecisionMessage(message: SessionMessage): boolean {
  const text = message.content.toLowerCase();
  const signals = [
    "decided",
    "decision",
    "let's",
    "we should",
    "agreed",
    "conclusion",
    "root cause",
    "fix",
    "because",
    "therefore",
    "instead",
    "approach",
  ];
  return signals.some((signal) => text.includes(signal));
}

function truncate(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function summarizeMessage(message: SessionMessage): string {
  const prefix =
    message.role === "assistant"
      ? "The assistant"
      : message.author
        ? `${message.author}`
        : "A participant";
  return `${prefix}: ${truncate(message.content, 160)}`;
}

/**
 * Rule-based session summary for Phase B (no LLM).
 * Produces 3–5 sentences from recent transcript + repo context.
 */
export function generateSessionSummary(session: Session): string {
  const sentences: string[] = [];

  const { repo, branch } = session.context;
  if (repo) {
    sentences.push(
      branch
        ? `Shared session on repository "${repo}" (branch ${branch}).`
        : `Shared session on repository "${repo}".`,
    );
  } else {
    sentences.push("Shared live debugging session.");
  }

  if (session.participants.length > 0) {
    sentences.push(`Participants: ${session.participants.join(", ")}.`);
  }

  const messages = session.messages;
  if (messages.length === 0) {
    sentences.push("No messages have been posted yet.");
    return sentences.slice(0, 5).join(" ");
  }

  const recent = messages.slice(-MAX_SUMMARY_MESSAGES);
  const decisionLike = recent.filter(isDecisionMessage);
  const highlights = (decisionLike.length > 0 ? decisionLike : recent.slice(-5)).slice(-3);

  for (const message of highlights) {
    sentences.push(summarizeMessage(message));
  }

  const last = messages[messages.length - 1]!;
  if (!highlights.includes(last)) {
    sentences.push(`Latest update: ${truncate(last.content, 140)}`);
  }

  return sentences.slice(0, 5).join(" ");
}
