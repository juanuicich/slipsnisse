/**
 * Execution Engine for composite tools.
 * Pre-builds execution context at startup and runs LLM inference with tool calling.
 * Supports 2-way communication via callbacks when allow_callback is enabled.
 */

import {
  generateText,
  type ModelMessage,
  type LanguageModel,
  stepCountIs,
  type Tool,
  tool,
} from "ai";
import type { Logger } from "pino";
import { z } from "zod";
import type { SlipsnisseConfig, ToolConfig } from "../config/schema.js";
import { ToolExecutionError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { ClientManager } from "../mcp/client-manager.js";
import { getModel } from "../providers/registry.js";
import { SessionManager } from "./session-manager.js";
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
 * Exception thrown when reply() tool is called.
 * Contains the question to forward to orchestrator.
 */
export class CallbackRequested extends Error {
  constructor(
    public readonly question: string,
    public readonly messages: ModelMessage[],
  ) {
    super("Callback requested");
    this.name = "CallbackRequested";
  }
}

/**
 * Cached execution context for a composite tool.
 */
interface ToolExecutionContext {
  model: LanguageModel;
  systemPrompt: string;
  tools: Record<string, Tool>;
  temperature: number;
  allowCallback: boolean;
}

/**
 * Result from executing a composite tool.
 */
export interface ExecutionResult {
  text: string;
  stepCount: number;
}

/**
 * Result when a callback is requested.
 */
export interface CallbackResult {
  type: "callback";
  sessionId: number;
  question: string;
}

/**
 * Combined result type.
 */
export type ExecuteResult =
  | ({ type: "complete" } & ExecutionResult)
  | CallbackResult;

/**
 * Execution Engine manages cached tool contexts and runs LLM inference.
 */
export class ExecutionEngine {
  private contexts = new Map<string, ToolExecutionContext>();
  readonly sessionManager = new SessionManager();

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
    toolConfig: ToolConfig,
    clientManager: ClientManager,
    providerConfigs?: SlipsnisseConfig["providers"],
  ): Promise<ToolExecutionContext> {
    // Resolve model instance
    const providerConfig = providerConfigs?.[toolConfig.provider];
    const model = await getModel(
      providerConfig?.provider || toolConfig.provider,
      toolConfig.model,
      providerConfig
        ? {
            endpoint: providerConfig.endpoint,
            apiKey: providerConfig.apiKey,
            providerOptions: providerConfig.providerOptions,
          }
        : undefined,
    );
    getLog().debug(
      {
        tool: toolConfig.name,
        provider: toolConfig.provider,
        model: toolConfig.model,
      },
      "Model resolved",
    );

    // Get and wrap internal tools
    const availableTools = clientManager.getAvailableTools(
      toolConfig.internal_tools,
    );
    const wrappedTools = wrapTools(availableTools, clientManager);
    getLog().debug(
      {
        tool: toolConfig.name,
        internalToolCount: Object.keys(wrappedTools).length,
      },
      "Internal tools wrapped",
    );

    return {
      model,
      systemPrompt: toolConfig.system_prompt || DEFAULT_SYSTEM_PROMPT,
      tools: wrappedTools,
      temperature: toolConfig.temperature,
      allowCallback: toolConfig.allow_callback,
    };
  }

  /**
   * Create the reply tool for 2-way communication.
   * When called, throws CallbackRequested to interrupt execution.
   */
  private createReplyTool(
    messagesRef: { current: ModelMessage[] },
  ): Record<string, Tool> {
    return {
      reply: tool({
        description:
          "Ask the orchestrator a question and wait for their response. Use when you need clarification or additional input from the user.",
        inputSchema: z.object({
          question: z
            .string()
            .describe("The question to ask the orchestrator"),
        }),
        execute: async ({ question }): Promise<string> => {
          // Throw to interrupt execution - will be caught in execute()
          throw new CallbackRequested(question, [...messagesRef.current]);
        },
      }),
    };
  }

  /**
   * Execute a composite tool with the given arguments.
   * Uses cached context and runs generateText with multi-step tool calling.
   *
   * Returns either a complete result or a callback request.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExecuteResult> {
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

    const messages: ModelMessage[] = [{ role: "user", content: prompt }];

    return this.executeWithMessages(toolName, args, context, messages);
  }

  /**
   * Resume a paused execution with orchestrator's reply.
   */
  async resume(sessionId: number, payload: unknown): Promise<ExecuteResult> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`No session found with ID: ${sessionId}`);
    }

    const context = this.contexts.get(session.toolName);
    if (!context) {
      throw new Error(`No execution context for tool: ${session.toolName}`);
    }

    getLog().info(
      { sessionId, toolName: session.toolName, payload },
      "Resuming paused execution",
    );

    // Reconstruct messages: original + orchestrator reply
    const messages: ModelMessage[] = [
      ...session.messages,
      {
        role: "user",
        content: `Orchestrator replied to your question "${session.question}": ${JSON.stringify(payload)}`,
      },
    ];

    // Resume the session (removes it from manager)
    this.sessionManager.resumeSession(sessionId, payload);

    return this.executeWithMessages(
      session.toolName,
      session.originalArgs,
      context,
      messages,
    );
  }

  /**
   * Internal execution with message history.
   */
  private async executeWithMessages(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    messages: ModelMessage[],
  ): Promise<ExecuteResult> {
    // Reference for reply tool to capture current messages
    const messagesRef = { current: messages };

    // Build tool set with optional reply tool
    const tools = context.allowCallback
      ? { ...context.tools, ...this.createReplyTool(messagesRef) }
      : context.tools;

    try {
      const { text, response, steps } = await generateText({
        model: context.model,
        system: context.systemPrompt,
        messages,
        tools,
        temperature: context.temperature,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: AbortSignal.timeout(EXECUTION_TIMEOUT_MS),
      });

      // Update message ref with full conversation
      messagesRef.current = response.messages;

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

      return { type: "complete", text, stepCount: steps.length };
    } catch (err) {
      // Handle callback request
      if (err instanceof CallbackRequested) {
        const { sessionId } = this.sessionManager.createSession(
          toolName,
          args,
          err.messages,
          err.question,
        );

        getLog().info(
          { tool: toolName, sessionId, question: err.question },
          "Callback requested, pausing execution",
        );

        return { type: "callback", sessionId, question: err.question };
      }

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
