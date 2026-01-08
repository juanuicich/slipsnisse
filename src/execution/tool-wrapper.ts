/**
 * Tool Wrapper Factory.
 * Converts MCP tool definitions to Vercel AI SDK tool format.
 */

import { tool, type Tool } from "ai";
import { z, type ZodTypeAny } from "zod";
import type { ClientManager } from "../mcp/client-manager.js";
import type { NamespacedTool } from "../mcp/types.js";
import { createLogger } from "../logger.js";
import type { Logger } from "pino";

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
 * Wrap MCP tools for use with the Vercel AI SDK.
 *
 * @param tools - Array of namespaced MCP tools
 * @param clientManager - ClientManager instance for executing tool calls
 * @returns Record of Vercel AI SDK tools keyed by namespaced name
 */
export const wrapTools = (
  tools: NamespacedTool[],
  clientManager: ClientManager
): Record<string, Tool> => {
  const wrapped: Record<string, Tool> = {};

  for (const mcpTool of tools) {
    const parametersSchema = jsonSchemaToZod(mcpTool.inputSchema);

    wrapped[mcpTool.namespacedName] = tool({
      description: mcpTool.description,
      inputSchema: parametersSchema,
      execute: async (args) => {
        getLog().debug(
          { tool: mcpTool.namespacedName, args },
          "Executing wrapped tool"
        );

        try {
          const result = await clientManager.callTool(
            mcpTool.namespacedName,
            args as Record<string, unknown>
          );

          if (result.isError) {
            getLog().warn(
              { tool: mcpTool.namespacedName, result },
              "Tool returned error"
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
            "Tool execution failed"
          );
          return `Error: ${message}`;
        }
      },
    });

    getLog().debug(
      { tool: mcpTool.namespacedName },
      "Wrapped tool for AI SDK"
    );
  }

  return wrapped;
};
