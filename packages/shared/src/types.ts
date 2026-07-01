export type MessageRole = "user" | "assistant" | "system";

export interface SessionMessage {
  role: MessageRole;
  content: string;
  author: string;
  timestamp: string;
}

export interface SessionContext {
  repo: string;
  branch: string;
  files: string[];
}

export interface Session {
  session_id: string;
  created_at: string;
  participants: string[];
  messages: SessionMessage[];
  context: SessionContext;
}

export interface ActiveSessionConfig {
  session_id: string;
  relay_url: string;
  participant_id: string;
  join_token?: string;
  api_key?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  join_url: string;
  join_command: string;
  join_token: string;
  relay_url: string;
  expires_at: string;
}
