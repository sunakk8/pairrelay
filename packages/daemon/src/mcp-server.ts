import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { generateSessionSummary, formatAuthHeader, readCredentials, retrieveSessionContext } from "@pairrelay/shared";
import { SessionClient } from "./session-client.js";
import { clearSessionCache, readActiveSession, readSessionCache } from "./cache.js";

const PostMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]).optional(),
  author: z.string().optional(),
});

const RetrieveContextSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  include_prior_sessions: z.boolean().optional(),
  post_to_session: z.boolean().optional(),
});

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "pairrelay", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "pairrelay_get_session",
        description:
          "Return the full shared session transcript and repo context as JSON.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "pairrelay_get_session_summary",
        description:
          "Return a 3–5 sentence rule-based summary of decisions and context in the shared session.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "pairrelay_post_message",
        description:
          "Append a message to the shared session and broadcast it to all participants via the relay.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "Message body" },
            role: {
              type: "string",
              enum: ["user", "assistant", "system"],
              description: "Message role (default: user)",
            },
            author: {
              type: "string",
              description: "Author label (default: this participant id)",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "pairrelay_retrieve_context",
        description:
          "Retrieve the most relevant messages from the shared session (and optionally prior sessions on the same repo) for a natural-language query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What context to find (e.g. auth bug decisions)" },
            limit: {
              type: "number",
              description: "Max messages to return (default 5, max 20)",
            },
            include_prior_sessions: {
              type: "boolean",
              description: "Search persisted prior sessions for the same repo (requires relay persistence)",
            },
            post_to_session: {
              type: "boolean",
              description: "Post the formatted retrieval summary into the shared session",
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // MCP is a separate process from share/join. It reads ~/.pairrelay files the
    // persistent WS client writes; it does not hold the live socket itself.
    async function resolveSession() {
      const active = await readActiveSession();
      const cached = await readSessionCache();
      if (cached && active && cached.session_id !== active.session_id) {
        // Stale cache from a previous join/share — drop it so MCP cannot serve the old session.
        await clearSessionCache();
        return { session: null, active, staleCacheSessionId: cached.session_id };
      }
      const session =
        cached && active && cached.session_id === active.session_id ? cached : null;
      return { session, active, staleCacheSessionId: null as string | null };
    }

    switch (request.params.name) {
      case "pairrelay_get_session": {
        const { session, active, staleCacheSessionId } = await resolveSession();
        if (!session) {
          if (!active) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active session. Run `pairrelay share` or `pairrelay join <id>` first.",
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    session_id: active.session_id,
                    note: staleCacheSessionId
                      ? `Cleared stale cache for ${staleCacheSessionId}. Ensure join/share is running for ${active.session_id}, then retry.`
                      : "Session not synced yet. Ensure `pairrelay share` or `pairrelay join` is running.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
        };
      }

      case "pairrelay_get_session_summary": {
        const { session, active } = await resolveSession();
        if (!session) {
          if (!active) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active session. Run `pairrelay share` or `pairrelay join <id>` first.",
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: "Session not loaded yet. Ensure `pairrelay share` or `pairrelay join` is running.",
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: generateSessionSummary(session) }],
        };
      }

      case "pairrelay_post_message": {
        const active = await readActiveSession();
        if (!active) {
          return {
            content: [
              {
                type: "text",
                text: "No active session. Run `pairrelay share` or `pairrelay join <id>` first.",
              },
            ],
            isError: true,
          };
        }

        const credentials = await readCredentials();
        // Short-lived socket just to send; share/join keeps the persistent connection.
        const client = new SessionClient({
          ...active,
          api_key: active.api_key ?? credentials?.api_key,
        });

        const args = PostMessageSchema.parse(request.params.arguments ?? {});
        try {
          await client.connect();
          const message = await client.postMessage(args.content, args.role, args.author);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, message }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          };
        } finally {
          client.disconnect();
        }
      }

      case "pairrelay_retrieve_context": {
        const { session, active } = await resolveSession();
        if (!session || !active) {
          return {
            content: [
              {
                type: "text",
                text: "No active session. Run `pairrelay share` or `pairrelay join <id>` first.",
              },
            ],
            isError: true,
          };
        }

        const args = RetrieveContextSchema.parse(request.params.arguments ?? {});
        const credentials = await readCredentials();
        const relayUrl = active.relay_url ?? credentials?.relay_url ?? "http://localhost:8787";
        let result = retrieveSessionContext(session, args.query, { limit: args.limit ?? 5 });

        if (args.include_prior_sessions && session.context.repo) {
          try {
            const url = new URL(`${relayUrl}/sessions/${active.session_id}/retrieve`);
            url.searchParams.set("q", args.query);
            url.searchParams.set("include_history", "true");
            url.searchParams.set("limit", String(args.limit ?? 5));
            const headers: Record<string, string> = {};
            const apiKey = active.api_key ?? credentials?.api_key;
            if (apiKey) {
              headers.authorization = formatAuthHeader(apiKey);
            }
            const response = await fetch(url, { headers });
            if (response.ok) {
              result = (await response.json()) as typeof result;
            }
          } catch {
            // Fall back to local session-only retrieval.
          }
        }

        if (args.post_to_session) {
          const client = new SessionClient({
            ...active,
            api_key: active.api_key ?? credentials?.api_key,
          });
          try {
            await client.connect();
            await client.postMessage(result.formatted, "system", "pairrelay-retrieval");
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              isError: true,
            };
          } finally {
            client.disconnect();
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
