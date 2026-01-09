/**
 * Execution Engine for composite tools.
 * Pre-builds execution context at startup and runs LLM inference with tool calling.
 */

import { generateText, type LanguageModel, stepCountIs, type Tool } from "ai";
import type { Logger } from "pino";
import type { SlipsnisseConfig, ToolConfig } from "../config/schema.js";
import { ToolExecutionError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { ClientManager } from "../mcp/client-manager.js";
import { getModel } from "../providers/registry.js";
import { wrapTools } from "./tool-wrapper.js";

const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_STEPS = 10;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools.
Use the available tools to complete the task. Be thorough and precise.
When you have gathered enough information, provide a clear, concise answer.`;

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("execution-engine");
  }
  return log;
};

/**
 * Cached execution context for a composite tool.
 */
interface ToolExecutionContext {
  model: LanguageModel;
  systemPrompt: string;
  tools: Record<string, Tool>;
  temperature: number;
}

/**
 * Result from executing a composite tool.
 */
export interface ExecutionResult {
  text: string;
  stepCount: number;
}

/**
 * Execution Engine manages cached tool contexts and runs LLM inference.
 */
export class ExecutionEngine {
  private contexts = new Map<string, ToolExecutionContext>();

  /**
   * Initialise execution contexts for all composite tools.
   * Pre-builds model instances, system prompts, and wrapped tools.
   */
  async init(
    config: SlipsnisseConfig,
    clientManager: ClientManager,
  ): Promise<void> {
    getLog().info(
      { toolCount: config.tools.length },
      "Initialising execution contexts",
    );

    for (const tool of config.tools) {
      // Skip tools whose MCPs aren't available
      if (!clientManager.hasRequiredServers(tool.internal_tools)) {
        getLog().warn(
          { tool: tool.name },
          "Skipping context init: required MCPs unavailable",
        );
        continue;
      }

      try {
        const context = await this.buildContext(
          tool,
          clientManager,
          config.providers,
        );
        this.contexts.set(tool.name, context);
        getLog().info({ tool: tool.name }, "Execution context ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        getLog().error(
          { tool: tool.name, error: message },
          "Failed to build execution context",
        );
      }
    }

    getLog().info(
      { contextCount: this.contexts.size },
      "Execution engine initialised",
    );
  }

  /**
   * Build execution context for a single composite tool.
   */
  private async buildContext(
    tool: ToolConfig,
    clientManager: ClientManager,
    providerConfigs?: SlipsnisseConfig["providers"],
  ): Promise<ToolExecutionContext> {
    // Resolve model instance
    const providerConfig = providerConfigs?.[tool.provider];
    const model = await getModel(
      providerConfig?.provider || tool.provider,
      tool.model,
      providerConfig
        ? {
            endpoint: providerConfig.endpoint,
            apiKey: providerConfig.apiKey,
            providerOptions: providerConfig.providerOptions,
          }
        : undefined,
    );
    getLog().debug(
      { tool: tool.name, provider: tool.provider, model: tool.model },
      "Model resolved",
    );

    // Get and wrap internal tools
    const availableTools = clientManager.getAvailableTools(tool.internal_tools);
    const wrappedTools = wrapTools(availableTools, clientManager);
    getLog().debug(
      { tool: tool.name, internalToolCount: Object.keys(wrappedTools).length },
      "Internal tools wrapped",
    );

    return {
      model,
      systemPrompt: tool.system_prompt || DEFAULT_SYSTEM_PROMPT,
      tools: wrappedTools,
      temperature: tool.temperature,
    };
  }

  /**
   * Execute a composite tool with the given arguments.
   * Uses cached context and runs generateText with multi-step tool calling.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const context = this.contexts.get(toolName);
    if (!context) {
      throw new Error(`No execution context for tool: ${toolName}`);
    }

    getLog().info({ tool: toolName, args }, "Executing composite tool");

    const prompt =
      typeof args === "object"
        ? Object.entries(args)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : String(args);

    try {
      const { text, steps } = await generateText({
        model: context.model,
        system: context.systemPrompt,
        prompt,
        tools: context.tools,
        temperature: context.temperature,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: AbortSignal.timeout(EXECUTION_TIMEOUT_MS),
      });

      // Log intermediate steps at debug level
      for (const step of steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            getLog().debug(
              {
                tool: toolName,
                toolCall: toolCall.toolName,
                input: toolCall.input,
              },
              "Intermediate tool call",
            );
          }
        }
      }

      getLog().info(
        { tool: toolName, stepCount: steps.length, textLength: text.length },
        "Composite tool execution complete",
      );

      return { text, stepCount: steps.length };
    } catch (err) {
      if (err instanceof ToolExecutionError) {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);

      if (
        message.includes("Timeout") ||
        message.includes("signal is aborted")
      ) {
        getLog().error(
          { tool: toolName, error: message },
          "Execution timed out",
        );
        throw new ToolExecutionError(
          "EXECUTION_TIMEOUT",
          `Execution timed out: ${message}`,
          {
            toolName,
          },
        );
      }

      getLog().error(
        { tool: toolName, error: message, args },
        "Composite tool execution failed",
      );
      throw new ToolExecutionError("LLM_ERROR", `Provider error: ${message}`, {
        toolName,
      });
    }
  }

  /**
   * Check if a tool has a cached execution context.
   */
  hasContext(toolName: string): boolean {
    return this.contexts.has(toolName);
  }
}
