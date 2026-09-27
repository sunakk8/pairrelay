import { startMcpServer } from "@pairrelay/daemon";

/** Start stdio MCP for Cursor (`pairrelay mcp` in .cursor/mcp.json). */
export async function runMcp(): Promise<void> {
  await startMcpServer();
}
