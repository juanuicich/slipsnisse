import { z } from "zod";

/**
 * MCP server configuration schema
 */
export const McpConfigSchema = z.object({
  command: z.string().describe("Command to spawn the MCP server"),
  args: z.array(z.string()).describe("Arguments for the command"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  transport: z
    .enum(["stdio", "sse"])
    .default("stdio")
    .describe("Transport type"),
  url: z
    .string()
    .optional()
    .describe("URL for SSE transport (required when transport is sse)"),
});

/**
 * Composite tool configuration schema
 */
export const ToolConfigSchema = z.object({
  name: z.string().describe("Tool name exposed to orchestrator"),
  description: z.string().describe("Tool description for the orchestrator"),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Input schema in JSON Schema format"),
  internal_tools: z
    .record(z.string(), z.array(z.string()))
    .describe("Map of server_id to list of allowed tool names"),
  provider: z
    .string()
    .describe("Vercel AI SDK provider (google, openai, anthropic, etc.)"),
  model: z.string().describe("Model identifier"),
  system_prompt: z.string().optional().describe("Custom system prompt"),
});

/**
 * Root configuration schema
 */
export const SlipsnisseConfigSchema = z.object({
  mcps: z
    .record(z.string(), McpConfigSchema)
    .describe("Map of downstream MCP server configurations"),
  tools: z
    .array(ToolConfigSchema)
    .describe("List of composite tools exposed by Slipsnisse"),
});

// Inferred TypeScript types
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type SlipsnisseConfig = z.infer<typeof SlipsnisseConfigSchema>;
