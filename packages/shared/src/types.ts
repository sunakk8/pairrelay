export type MessageRole = "user" | "assistant" | "system";

export interface SessionMessage {
  role: MessageRole;
  content: string;
  author: string;
  timestamp: string;
}

/** Repo snapshot attached at share time (name, branch, up to ~30 file paths). */
export interface SessionContext {
  repo: string;
  branch: string;
  files: string[];
}

/** Transcript + repo context as stored on the relay and in session-cache.json. */
export interface Session {
  session_id: string;
  created_at: string;
  participants: string[];
  messages: SessionMessage[];
  context: SessionContext;
}

/** Pointer this machine is connected to (active-session.json). MCP tools read this. */
export interface ActiveSessionConfig {
  session_id: string;
  relay_url: string;
  participant_id: string;
  join_token?: string;
  api_key?: string;
}

/** POST /sessions body returned to `pairrelay share`. */
export interface CreateSessionResponse {
  session_id: string;
  join_url: string;
  join_command: string;
  join_token: string;
  relay_url: string;
  expires_at: string;
}
