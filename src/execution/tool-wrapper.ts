/**
 * Tool Wrapper Factory.
 * Converts MCP tool definitions to TanStack AI tool format.
 */

import type { Logger } from "pino";
import { type ZodTypeAny, z } from "zod";
import { createLogger } from "../logger.js";
import type { ClientManager } from "../mcp/client-manager.js";
import type { NamespacedTool } from "../mcp/types.js";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("tool-wrapper");
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
 * Interface for TanStack AI Tool.
 * Replicating here to avoid dependency on deep imports or if explicit type isn't exported.
 */
export interface TanStackTool {
  name: string;
  description: string;
  parameters: ZodTypeAny;
  execute: (args: any) => Promise<any>;
}

/**
 * Wrap MCP tools for use with TanStack AI.
 *
 * @param tools - Array of namespaced MCP tools
 * @param clientManager - ClientManager instance for executing tool calls
 * @returns Record of TanStack AI tools keyed by namespaced name
 */
export const wrapTools = (
  tools: NamespacedTool[],
  clientManager: ClientManager,
): Record<string, TanStackTool> => {
  const wrapped: Record<string, TanStackTool> = {};

  for (const mcpTool of tools) {
    const parametersSchema = jsonSchemaToZod(mcpTool.inputSchema);

    wrapped[mcpTool.namespacedName] = {
      name: mcpTool.namespacedName,
      description: mcpTool.description,
      parameters: parametersSchema,
      execute: async (args: any) => {
        getLog().debug(
          { tool: mcpTool.namespacedName, args },
          "Executing wrapped tool",
        );

        try {
          const result = await clientManager.callTool(
            mcpTool.namespacedName,
            args as Record<string, unknown>,
          );

          if (result.isError) {
            getLog().warn(
              { tool: mcpTool.namespacedName, result },
              "Tool returned error",
            );
          }

          // Convert MCP result to string for LLM consumption
          return typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          getLog().error(
            { tool: mcpTool.namespacedName, error: message },
            "Tool execution failed",
          );
          return `Error: ${message}`;
        }
      },
    };

    getLog().debug({ tool: mcpTool.namespacedName }, "Wrapped tool for TanStack AI");
  }

  return wrapped;
};
