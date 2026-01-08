import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "../config/schema.js";

export type TransportType = "stdio" | "sse";

export interface McpConnection {
  serverId: string;
  client: Client;
  tools: Tool[];
  status: "connected" | "failed" | "disconnected";
  config: McpConfig;
}

export interface NamespacedTool {
  /** Namespaced name: serverId__toolName */
  namespacedName: string;
  /** Original tool name */
  originalName: string;
  /** Server ID this tool belongs to */
  serverId: string;
  /** Tool description */
  description: string;
  /** Input schema */
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: unknown;
  isError?: boolean;
}
