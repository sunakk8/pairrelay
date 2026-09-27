/**
 * Phase 2B: lexical retrieval over session messages.
 * Run with: pnpm test:phase-2b
 */
import { retrieveSessionContext } from "../packages/shared/dist/retrieval.js";

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  PASS: ${name}`);
}

function fail(name, detail) {
  failed++;
  console.error(`  FAIL: ${name} — ${detail}`);
}

function assert(condition, name, detail = "assertion failed") {
  if (condition) pass(name);
  else fail(name, detail);
}

function testRetrievalRanksAuthMessage() {
  const session = {
    session_id: "s1",
    created_at: new Date().toISOString(),
    participants: ["a"],
    context: { repo: "pairrelay", branch: "main", files: [] },
    messages: [
      {
        role: "user",
        content: "We decided the auth bug is in join-token verification.",
        author: "alice",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "The landing page copy looks fine.",
        author: "ai",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
    ],
  };

  const result = retrieveSessionContext(session, "auth bug join token", { limit: 2 });
  assert(result.results.length >= 1, "returns at least one match");
  assert(
    result.results[0]?.content.includes("auth bug"),
    "top result is auth-related",
    result.results[0]?.content,
  );
  assert(result.formatted.includes("auth bug"), "formatted output mentions query topic");
}

function testRetrievalIncludesPriorSessions() {
  const session = {
    session_id: "current",
    created_at: new Date().toISOString(),
    participants: ["a"],
    context: { repo: "pairrelay", branch: "main", files: [] },
    messages: [],
  };

  const priorMessages = [
    {
      session_id: "prior-1",
      role: "user",
      content: "Root cause: HMAC secret mismatch on Fly.",
      author: "bob",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ];

  const result = retrieveSessionContext(session, "HMAC secret Fly", {
    limit: 3,
    priorMessages,
  });
  assert(result.results.length === 1, "finds prior session message", `got ${result.results.length}`);
  assert(result.results[0]?.source === "prior_session", "marks prior session source");
}

async function main() {
  console.log("Phase 2B retrieval test suite\n");
  testRetrievalRanksAuthMessage();
  testRetrievalIncludesPriorSessions();

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
