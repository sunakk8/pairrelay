import { startMcpServer } from "@pairrelay/daemon";

export async function runMcp(): Promise<void> {
  await startMcpServer();
}
