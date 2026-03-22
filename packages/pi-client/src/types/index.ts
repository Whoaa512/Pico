export * from "./stream-events";
export * from "./chat-message";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  retryAttempt: number;
  nextRetryAt: number | null;
  lastDisconnectReason: string | null;
  disconnectedAt: number | null;
}

export interface AgentSessionInfo {
  session_id: string;
  session_file: string;
  workspace_id: string;
  cwd: string;
  model?: ModelInfo | null;
  thinking_level?: string;
  process_alive: boolean;
}

export interface SessionListItem {
  id: string;
  cwd: string;
  created_at: string;
  last_active: number;
  version: number;
  display_name?: string | null;
  message_count: number;
  file_path: string;
}

export interface PaginatedSessions {
  items: SessionListItem[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export interface PiClientConfig {
  serverUrl: string;
  accessToken: string;
  /** Called when the SSE stream gets a 401. Should attempt to refresh the token. */
  onAuthError?: () => void;
  /**
   * Called when an API call gets a 401. Should refresh the token, call
   * updateToken(), and return true. The failed request will be retried.
   */
  onApiAuthError?: () => Promise<boolean>;
  transport?: "sse" | "ws";
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

import type { ModelInfo } from "./stream-events";
