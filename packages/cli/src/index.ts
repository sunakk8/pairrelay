#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_RELAY_URL } from "@pairrelay/shared";
import { runShare } from "./commands/share.js";
import { runJoin } from "./commands/join.js";
import { runMcp } from "./commands/mcp.js";
import { runLogin } from "./commands/login.js";
import { runPost } from "./commands/post.js";
import { runLeave } from "./commands/leave.js";

const program = new Command();

program
  .name("pairrelay")
  .description("Live shared AI coding sessions via MCP + WebSocket relay")
  .version("0.1.0");

program
  .command("login")
  .description("Authenticate with pairrelay (GitHub OAuth or API key)")
  .option("--github", "Log in via GitHub OAuth (opens browser)")
  .option("--api-key <key>", "API key (non-interactive fallback)")
  .option("--relay-url <url>", "Default relay URL", DEFAULT_RELAY_URL)
  .action(async (options: { github?: boolean; apiKey?: string; relayUrl: string }) => {
    await runLogin({ github: options.github, apiKey: options.apiKey, relayUrl: options.relayUrl });
  });

program
  .command("share")
  .description("Create a session on the relay and connect this machine")
  .option("--local", "Use local relay (http://localhost:8787)")
  .option("--relay-url <url>", "Relay base URL")
  .action(async (options: { local?: boolean; relayUrl?: string }) => {
    const relayUrl = options.local ? DEFAULT_RELAY_URL : options.relayUrl;
    await runShare({ relayUrl });
  });

program
  .command("join")
  .description("Join an existing session on the relay")
  .argument("<session-id>", "Session UUID from pairrelay share")
  .option("--token <token>", "Signed join token from share link")
  .option("--relay-url <url>", "Relay base URL")
  .action(async (sessionId: string, options: { relayUrl?: string; token?: string }) => {
    await runJoin(sessionId, { relayUrl: options.relayUrl, token: options.token });
  });

program
  .command("post")
  .description("Post a message to the active shared session")
  .argument("<message>", "Message content")
  .option("--role <role>", "Message role (user, assistant, system)", "user")
  .option("--author <author>", "Author label")
  .action(async (message: string, options: { role: string; author?: string }) => {
    const role = options.role as "user" | "assistant" | "system";
    await runPost(message, { role, author: options.author });
  });

program
  .command("leave")
  .description("Leave the active shared session and clear local session state")
  .action(async () => {
    await runLeave();
  });

program
  .command("mcp")
  .description("Start the local MCP server (stdio) for Cursor")
  .action(async () => {
    await runMcp();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
