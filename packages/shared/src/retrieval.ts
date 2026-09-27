import type { Session, SessionMessage } from "./types.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "it",
  "this",
  "that",
  "with",
  "from",
  "as",
  "by",
  "be",
  "are",
  "was",
  "were",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "do",
  "does",
  "did",
  "we",
  "you",
  "i",
  "me",
  "my",
  "our",
  "your",
]);

export interface RetrievedMessage extends SessionMessage {
  score: number;
  source: "current_session" | "prior_session";
  session_id?: string;
}

export interface RetrieveContextOptions {
  limit?: number;
  priorMessages?: Array<SessionMessage & { session_id?: string }>;
}

export interface RetrieveContextResult {
  query: string;
  results: RetrievedMessage[];
  formatted: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function scoreMessage(message: SessionMessage, queryTerms: string[], corpusDf: Map<string, number>): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const content = message.content.toLowerCase();
  const tokens = tokenize(message.content);
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = tokenCounts.get(term) ?? 0;
    if (tf === 0) {
      continue;
    }
    const df = corpusDf.get(term) ?? 1;
    const idf = Math.log(1 + tokens.length / df);
    score += (tf / Math.max(tokens.length, 1)) * idf;
    if (content.includes(term)) {
      score += 0.25;
    }
  }

  if (message.role === "assistant") {
    score *= 1.05;
  }

  return score;
}

function buildCorpusDf(messages: SessionMessage[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const message of messages) {
    const seen = new Set(tokenize(message.content));
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

/**
 * Lightweight lexical retrieval over session messages (BM25-ish TF-IDF).
 * Used by MCP `pairrelay_retrieve_context` — not neural embeddings.
 */
export function retrieveRelevantMessages(
  messages: SessionMessage[],
  query: string,
  options: { limit?: number; source?: RetrievedMessage["source"]; session_id?: string } = {},
): RetrievedMessage[] {
  const limit = options.limit ?? 5;
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || messages.length === 0) {
    return [];
  }

  const corpusDf = buildCorpusDf(messages);
  const scored = messages
    .map((message) => ({
      ...message,
      score: scoreMessage(message, queryTerms, corpusDf),
      source: options.source ?? ("current_session" as const),
      session_id: options.session_id,
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export function formatRetrievalResults(query: string, results: RetrievedMessage[]): string {
  if (results.length === 0) {
    return `No messages matched query: "${query}"`;
  }

  const lines = results.map((m, i) => {
    const prefix = m.source === "prior_session" && m.session_id ? `[prior ${m.session_id.slice(0, 8)}]` : "";
    const author = m.author || m.role;
    return `${i + 1}. ${prefix}${author}: ${m.content}`.trim();
  });

  return `Retrieved context for "${query}":\n${lines.join("\n")}`;
}

export function retrieveSessionContext(
  session: Session,
  query: string,
  options: RetrieveContextOptions = {},
): RetrieveContextResult {
  const limit = options.limit ?? 5;
  const current = retrieveRelevantMessages(session.messages, query, {
    limit,
    source: "current_session",
    session_id: session.session_id,
  });

  const priorPool = options.priorMessages ?? [];
  const prior = retrieveRelevantMessages(priorPool, query, {
    limit,
    source: "prior_session",
  });

  const merged = [...current, ...prior]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    query,
    results: merged,
    formatted: formatRetrievalResults(query, merged),
  };
}
