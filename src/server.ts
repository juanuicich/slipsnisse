/**
 * MCP Server implementation for Slipsnisse
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodTypeAny, type ZodRawShape } from "zod";
import type { SlipsnisseConfig, ToolConfig } from "./config/schema.js";
import type { ClientManager } from "./mcp/client-manager.js";
import { createLogger } from "./logger.js";
import type { Logger } from "pino";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("server");
  }
  return log;
};

/**
 * Convert JSON Schema to Zod schema.
 * Supports primitive types and objects. Falls back to z.unknown() for unsupported types.
 */
const jsonSchemaToZod = (schema: Record<string, unknown>): ZodTypeAny => {
  if (!schema || typeof schema !== "object") {
    return z.unknown();
  }

  const type = schema.type as string | undefined;

  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      return z.array(items ? jsonSchemaToZod(items) : z.unknown());
    }
    case "object": {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[]) || [];

      if (!properties) {
        return z.record(z.string(), z.unknown());
      }

      const shape: { [key: string]: ZodTypeAny } = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.includes(key) ? zodProp : zodProp.optional();
      }

      return z.object(shape);
    }
    default:
      return z.unknown();
  }
};

/**
 * Create stub handler for composite tools.
 * Returns a function that logs invocation and returns placeholder response.
 */
const createStubHandler = (tool: ToolConfig) => {
  return async (args: Record<string, unknown>) => {
    getLog().info({ tool: tool.name, args }, "Tool invoked (stub handler)");
    return {
      content: [
        {
          type: "text" as const,
          text: `Tool '${tool.name}' invoked with args: ${JSON.stringify(args)}. Execution not implemented (Phase 3).`,
        },
      ],
    };
  };
};

/**
 * Create and initialize the MCP server with tools from config.
 */
export const createServer = (config: SlipsnisseConfig, clientManager: ClientManager): McpServer => {
  const server = new McpServer({
    name: "slipsnisse",
    version: "1.0.0",
  });

  for (const tool of config.tools) {
    // Check if all required MCP servers are available
    if (!clientManager.hasRequiredServers(tool.internal_tools)) {
      const missingServers = Object.keys(tool.internal_tools).filter(
        (serverId) => !clientManager.hasRequiredServers({ [serverId]: [] })
      );
      getLog().warn({ tool: tool.name, missingServers }, "Skipping tool registration: required MCP servers unavailable");
      continue;
    }

    // Convert arguments JSON Schema to Zod schema
    const paramsSchema = tool.arguments
      ? (jsonSchemaToZod(tool.arguments) as z.ZodObject<ZodRawShape>)
      : z.object({});

    // Register tool with MCP server
    server.tool(tool.name, tool.description, paramsSchema.shape, createStubHandler(tool));

    getLog().info({ tool: tool.name }, "Registered composite tool");
  }

  return server;
};

/**
 * Start the MCP server with Stdio transport.
 */
export const startServer = async (server: McpServer): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  getLog().info("MCP server started with Stdio transport");
};
