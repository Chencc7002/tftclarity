export class ToolError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ToolError";
    this.code = options.code ?? "tool_error";
    this.recoverable = Boolean(options.recoverable);
    this.toolName = options.toolName ?? null;
    this.toolResult = options.toolResult ?? null;
    this.details = options.details ?? null;
  }
}
