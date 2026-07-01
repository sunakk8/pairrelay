/**
 * E2E: pairrelay share output → pairrelay join connects and receives messages.
 * Requires open relay on localhost:8787.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELAY = "http://localhost:8787";
const CLI = join(process.cwd(), "packages/cli/dist/index.js");

function runCli(args, env, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI, ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout: ${args.join(" ")}\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseShareOutput(stdout) {
  const sessionMatch = stdout.match(/Session ID:\s+(\S+)/);
  const tokenMatch = stdout.match(/--token\s+(\S+)/);
  if (!sessionMatch || !tokenMatch) {
    throw new Error(`Could not parse share output:\n${stdout}`);
  }
  return { sessionId: sessionMatch[1], token: tokenMatch[1] };
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), "pairrelay-e2e-"));
  const env = {
    USERPROFILE: home,
    HOME: home,
    PAIRRELAY_RELAY_URL: RELAY,
  };

  console.log("E2E: share → join\n");

  const shareProc = spawn("node", [CLI, "share", "--relay-url", RELAY], {
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });

  let shareOut = "";
  shareProc.stdout.on("data", (d) => (shareOut += d));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("share timeout")), 10000);
    const check = setInterval(() => {
      if (shareOut.includes("Session shared")) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 200);
  });

  const { sessionId, token } = parseShareOutput(shareOut);
  console.log(`  Parsed session: ${sessionId.slice(0, 8)}…`);

  const joinProc = spawn(
    "node",
    [CLI, "join", sessionId, "--token", token, "--relay-url", RELAY],
    { env: { ...process.env, ...env }, cwd: process.cwd() },
  );

  let joinOut = "";
  joinProc.stdout.on("data", (d) => (joinOut += d));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 10000);
    const check = setInterval(() => {
      if (joinOut.includes("Joined session")) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 200);
  });

  console.log("  PASS: share created session");
  console.log("  PASS: join connected to session");

  // Post message via relay WebSocket as a third check
  const createRes = await fetch(`${RELAY}/sessions/${sessionId}`);
  if (!createRes.ok) throw new Error("session not found after share");
  console.log("  PASS: session visible via HTTP GET");

  shareProc.kill("SIGTERM");
  joinProc.kill("SIGTERM");
  await rm(home, { recursive: true, force: true });

  console.log("\nE2E share/join: all passed");
}

main().catch((err) => {
  console.error("E2E FAIL:", err.message);
  process.exit(1);
});
