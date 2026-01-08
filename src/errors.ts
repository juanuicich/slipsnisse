/**
 * Error codes for ToolExecutionError.
 */
export type ToolErrorCode =
  | "MCP_UNAVAILABLE"
  | "TOOL_NOT_FOUND"
  | "LLM_ERROR"
  | "TOOL_RESOLUTION_FAILED"
  | "EXECUTION_TIMEOUT";

/**
 * Custom error class for failures during composite tool execution.
 * These are returned to the orchestrator to provide clear feedback.
 */
export class ToolExecutionError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }

  /**
   * Convert error to a format suitable for MCP tool result.
   */
  toToolResult() {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error [${this.code}]: ${this.message}${
            this.details ? `\nDetails: ${JSON.stringify(this.details)}` : ""
          }`,
        },
      ],
    };
  }
}
