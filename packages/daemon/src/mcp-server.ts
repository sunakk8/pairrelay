import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { generateSessionSummary, readCredentials } from "@pairrelay/shared";
import { SessionClient } from "./session-client.js";
import { clearSessionCache, readActiveSession, readSessionCache } from "./cache.js";

const PostMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]).optional(),
  author: z.string().optional(),
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
