import { type ChildProcess, spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "pino";
import type { McpConfig } from "../config/schema.js";
import { ToolExecutionError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { McpConnection, NamespacedTool, ToolCallResult } from "./types.js";

const NAMESPACE_SEPARATOR = "__";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("client-manager");
  }
  return log;
};

/**
 * Manages connections to downstream MCP servers.
 */
export class ClientManager {
  private connections = new Map<string, McpConnection>();
  private processes = new Map<string, ChildProcess>();

  /**
   * Initialise connections to all configured MCP servers.
   * Failures are logged but don't prevent other servers from connecting.
   */
  async init(mcpConfigs: Record<string, McpConfig>): Promise<void> {
    const entries = Object.entries(mcpConfigs);
    getLog().info({ count: entries.length }, "Initialising MCP connections");

    await Promise.all(
      entries.map(([serverId, config]) => this.connectServer(serverId, config)),
    );

    const connected = [...this.connections.values()].filter(
      (c) => c.status === "connected",
    ).length;
    getLog().info(
      { connected, total: entries.length },
      "MCP initialisation complete",
    );
  }

  private async connectServer(
    serverId: string,
    config: McpConfig,
  ): Promise<void> {
    getLog().debug(
      { serverId, command: config.command },
      "Connecting to MCP server",
    );

    try {
      const client = new Client({
        name: `slipsnisse-${serverId}`,
        version: "1.0.0",
      });
      const transport = this.createTransport(serverId, config);

      await client.connect(transport);

      const { tools } = await client.listTools();
      getLog().debug({ serverId, toolCount: tools.length }, "Discovered tools");

      this.connections.set(serverId, {
        serverId,
        client,
        tools,
        status: "connected",
        config,
      });
    } catch (err) {
      getLog().error(
        { serverId, error: (err as Error).message },
        "Failed to connect to MCP server",
      );
      this.connections.set(serverId, {
        serverId,
        client: null as unknown as Client,
        tools: [],
        status: "failed",
        config,
      });
    }
  }

  private createTransport(serverId: string, config: McpConfig) {
    if (config.transport === "sse") {
      if (!config.url) {
        throw new Error(`SSE transport requires url for server: ${serverId}`);
      }
      return new SSEClientTransport(new URL(config.url));
    }

    // Stdio transport
    const envRecord: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        envRecord[key] = value;
      }
    }
    if (config.env) {
      Object.assign(envRecord, config.env);
    }

    const proc = spawn(config.command, config.args, {
      env: envRecord,
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const message = data.toString();
      getLog().debug({ serverId, stderr: message }, "MCP stderr");
    });

    proc.on("exit", (code: number | null) => {
      const conn = this.connections.get(serverId);
      if (code !== 0 && code !== null) {
        getLog().error({ serverId, exitCode: code }, "MCP process crashed");
        if (conn) {
          conn.status = "failed";
        }
      } else {
        getLog().warn({ serverId, exitCode: code }, "MCP process exited");
        if (conn) {
          conn.status = "disconnected";
        }
      }
    });

    this.processes.set(serverId, proc);

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }

  /**
   * Get available tools filtered by internal_tools config.
   * Returns namespaced tools for use by the subagent.
   */
  getAvailableTools(internalTools: Record<string, string[]>): NamespacedTool[] {
    const result: NamespacedTool[] = [];

    for (const [serverId, toolNames] of Object.entries(internalTools)) {
      const conn = this.connections.get(serverId);
      if (!conn || conn.status !== "connected") {
        getLog().warn({ serverId }, "Skipping unavailable MCP server");
        continue;
      }

      for (const toolName of toolNames) {
        const tool = conn.tools.find((t) => t.name === toolName);
        if (!tool) {
          getLog().warn({ serverId, toolName }, "Tool not found on server");
          continue;
        }

        result.push({
          namespacedName: `${serverId}${NAMESPACE_SEPARATOR}${toolName}`,
          originalName: toolName,
          serverId,
          description: tool.description || "",
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
    }

    return result;
  }

  /**
   * Call a tool by its namespaced name.
   */
  async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const sepIndex = namespacedName.indexOf(NAMESPACE_SEPARATOR);
    if (sepIndex === -1) {
      throw new Error(`Invalid namespaced tool name: ${namespacedName}`);
    }
    const serverId = namespacedName.slice(0, sepIndex);
    const toolName = namespacedName.slice(
      sepIndex + NAMESPACE_SEPARATOR.length,
    );

    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new ToolExecutionError("MCP_UNAVAILABLE", "Unknown MCP server", {
        serverId,
      });
    }
    if (conn.status !== "connected") {
      throw new ToolExecutionError(
        "MCP_UNAVAILABLE",
        `MCP server unavailable: ${serverId} (status: ${conn.status})`,
        { serverId, status: conn.status },
      );
    }

    getLog().debug({ serverId, toolName, args }, "Calling tool");

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });
      return {
        content: result.content,
        isError: result.isError === true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLog().error(
        { serverId, toolName, error: message },
        "MCP tool call failed",
      );
      throw new ToolExecutionError(
        "LLM_ERROR",
        `MCP tool call failed: ${message}`,
        {
          serverId,
          toolName,
        },
      );
    }
  }

  /**
   * Check if all servers for a tool config are available.
   */
  hasRequiredServers(internalTools: Record<string, string[]>): boolean {
    return Object.keys(internalTools).every((serverId) => {
      const conn = this.connections.get(serverId);
      return conn?.status === "connected";
    });
  }

  /**
   * Shutdown all connections and kill child processes.
   */
  async shutdown(): Promise<void> {
    getLog().info("Shutting down MCP connections");

    for (const [serverId, conn] of this.connections) {
      if (conn.status === "connected") {
        try {
          await conn.client.close();
        } catch (err) {
          getLog().error(
            { serverId, error: (err as Error).message },
            "Error closing client",
          );
        }
      }
    }

    for (const [serverId, proc] of this.processes) {
      if (!proc.killed) {
        getLog().debug({ serverId }, "Killing MCP process");
        proc.kill();
      }
    }

    this.connections.clear();
    this.processes.clear();
  }
}
