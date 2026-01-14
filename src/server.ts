/**
 * MCP Server implementation for Slipsnisse
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "pino";
import { type ZodRawShape, type ZodTypeAny, z } from "zod";
import type { SlipsnisseConfig, ToolConfig } from "./config/schema.js";
import type { ExecutionEngine } from "./execution/engine.js";
import { createLogger } from "./logger.js";
import type { ClientManager } from "./mcp/client-manager.js";

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
      const properties = schema.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
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
 * Create handler for composite tools that uses the ExecutionEngine.
 */
const createToolHandler = (tool: ToolConfig, engine: ExecutionEngine) => {
  return async (args: Record<string, unknown>) => {
    try {
      const result = await engine.execute(tool.name, args);

      if (result.type === "callback") {
        // Format callback as text with instructions for orchestrator
        const callbackText = `[SESSION:${result.sessionId}] Agent is asking: "${result.question}"

To reply, call: slipsnisse_reply(${result.sessionId}, <your_response>)`;

        return {
          content: [
            {
              type: "text" as const,
              text: callbackText,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: result.text,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLog().error(
        { tool: tool.name, error: message, args },
        "Tool handler error",
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Error executing '${tool.name}': ${message}`,
          },
        ],
        isError: true,
      };
    }
  };
};

/**
 * Create and initialise the MCP server with tools from config.
 * ExecutionEngine must be initialised before calling this.
 */
export const createServer = (
  config: SlipsnisseConfig,
  clientManager: ClientManager,
  engine: ExecutionEngine,
): McpServer => {
  const server = new McpServer({
    name: "slipsnisse",
    version: "1.0.0",
  });

  // Check if any tool has callback enabled
  const hasCallbackTools = config.tools.some((tool) => tool.allow_callback);

  // Register hidden reply tool if any tool supports callbacks
  if (hasCallbackTools) {
    const replyTool = server.tool(
      "slipsnisse_reply",
      "Reply to a paused slipsnisse session",
      {
        session_id: z
          .number()
          .int()
          .min(0)
          .max(999)
          .describe("Session ID from the callback message"),
        payload: z
          .unknown()
          .describe("Response data to send to the paused agent"),
      },
      async ({ session_id, payload }) => {
        try {
          const result = await engine.resume(session_id, payload);

          if (result.type === "callback") {
            // Agent asked another question
            const callbackText = `[SESSION:${result.sessionId}] Agent is asking: "${result.question}"

To reply, call: slipsnisse_reply(${result.sessionId}, <your_response>)`;

            return {
              content: [
                {
                  type: "text" as const,
                  text: callbackText,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: result.text,
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          getLog().error({ session_id, error: message }, "Reply handler error");
          return {
            content: [
              {
                type: "text" as const,
                text: `Error resuming session ${session_id}: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // Hide from list_tools - orchestrator learns about it from callback text
    replyTool.disable();
    getLog().info("Registered hidden slipsnisse_reply tool");
  }

  for (const tool of config.tools) {
    // Check if all required MCP servers are available
    if (!clientManager.hasRequiredServers(tool.internal_tools)) {
      const missingServers = Object.keys(tool.internal_tools).filter(
        (serverId) => !clientManager.hasRequiredServers({ [serverId]: [] }),
      );
      getLog().warn(
        { tool: tool.name, missingServers },
        "Skipping tool registration: required MCP servers unavailable",
      );
      continue;
    }

    // Check if execution context was built
    if (!engine.hasContext(tool.name)) {
      getLog().warn(
        { tool: tool.name },
        "Skipping tool registration: execution context unavailable",
      );
      continue;
    }

    // Convert arguments JSON Schema to Zod schema
    const paramsSchema = tool.arguments
      ? (jsonSchemaToZod(tool.arguments) as z.ZodObject<ZodRawShape>)
      : z.object({});

    // Register tool with MCP server
    server.tool(
      tool.name,
      tool.description,
      paramsSchema.shape,
      createToolHandler(tool, engine),
    );

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
