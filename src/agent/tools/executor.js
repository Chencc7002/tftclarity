import { randomUUID } from "node:crypto";
import { createToolResult, validateToolInput } from "./contracts.js";
import { ToolError } from "./tool-errors.js";

function isoNow(now) {
  return new Date(now()).toISOString();
}

function redactText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [REDACTED]")
    .replace(/(api[-_ ]?key|authorization|cookie|token|\bkey)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, 300);
}

function normalizedFailure(error, fallbackCode = "tool_failed") {
  return {
    code: String(error?.code ?? fallbackCode),
    message: redactText(error?.message ?? "Tool execution failed"),
    recoverable: Boolean(error?.recoverable)
  };
}

function abortPromise(signal, code, message) {
  if (!signal) return { promise: new Promise(() => {}), cleanup() {} };
  let listener;
  const promise = new Promise((_, reject) => {
    listener = () => reject(new ToolError(message, { code }));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    cleanup() {
      if (listener) signal.removeEventListener("abort", listener);
    }
  };
}

export class ToolExecutor {
  constructor(options = {}) {
    if (!options.registry) throw new TypeError("ToolExecutor requires a ToolRegistry");
    this.registry = options.registry;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent ?? null;
  }

  emit(context, event) {
    try {
      context.run?.emit?.(event);
    } catch {
      // Runtime event observers must not change tool behavior.
    }
    try {
      this.onEvent?.(event);
    } catch {
      // Tool observers must not change tool behavior.
    }
  }

  async execute(name, input = {}, context = {}) {
    const definition = this.registry.get(name);
    if (!definition) {
      throw new ToolError(`Tool is not registered: ${name}`, {
        code: "tool_not_registered",
        toolName: name
      });
    }
    if (context.source && context.source !== definition.source) {
      throw new ToolError(`Tool source mismatch for ${name}`, {
        code: "tool_source_mismatch",
        toolName: name
      });
    }
    const validatedInput = validateToolInput(input, definition.inputSchema, name);
    context.run?.consumeToolCall?.();
    context.run?.assertActive?.();

    const toolCallId = String(this.createId());
    const startedAt = isoNow(this.now);
    const startedTimestamp = Number(this.now());
    const maxRetries = Math.max(
      0,
      Number(context.maxRetriesPerTool ?? context.run?.budget?.maxRetriesPerTool ?? 0)
    );
    let attempts = 0;
    this.emit(context, {
      type: "tool_call_started",
      stage: "retrieving",
      data: { toolCallId, toolName: name }
    });

    while (true) {
      attempts += 1;
      const timeoutController = new AbortController();
      const timeoutMs = Math.max(1, Number(context.timeoutMs ?? definition.timeoutMs));
      let timeoutId;
      const externalSignal = context.signal ?? context.run?.signal;
      const abortHandler = () => timeoutController.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abortHandler();
      else externalSignal?.addEventListener("abort", abortHandler, { once: true });
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timeoutController.abort();
          reject(new ToolError(`Tool timed out: ${name}`, {
            code: "tool_timed_out",
            toolName: name,
            recoverable: false
          }));
        }, timeoutMs);
      });
      const cancellation = abortPromise(externalSignal, "tool_cancelled", `Tool cancelled: ${name}`);
      try {
        const value = await Promise.race([
          Promise.resolve(definition.execute(validatedInput, {
            ...context,
            signal: timeoutController.signal,
            toolCallId,
            toolName: name
          })),
          timeout,
          cancellation.promise
        ]);
        clearTimeout(timeoutId);
        cancellation.cleanup();
        externalSignal?.removeEventListener("abort", abortHandler);
        context.run?.assertActive?.();
        const completedAt = isoNow(this.now);
        const result = createToolResult({
          toolCallId,
          toolName: name,
          status: "completed",
          startedAt,
          completedAt,
          durationMs: Number(this.now()) - startedTimestamp,
          attempts,
          value,
          metadata: {
            source: definition.source,
            patch: value?.patch ?? validatedInput.patch ?? null,
            cache: value?.cache ?? null
          }
        });
        this.emit(context, {
          type: "tool_call_completed",
          stage: "retrieving",
          durationMs: result.durationMs,
          data: { toolCallId, toolName: name, attempts }
        });
        return result;
      } catch (caught) {
        clearTimeout(timeoutId);
        cancellation.cleanup();
        externalSignal?.removeEventListener("abort", abortHandler);
        const error = caught instanceof ToolError
          ? caught
          : new ToolError(`Tool failed: ${name}`, {
            code: "tool_failed",
            toolName: name,
            recoverable: Boolean(caught?.recoverable),
            cause: caught
          });
        const canRetry = error.recoverable && definition.idempotent && attempts <= maxRetries;
        if (canRetry) {
          context.run?.consumeRetry?.();
          continue;
        }
        const status = error.code === "tool_timed_out"
          ? "timed_out"
          : error.code === "tool_cancelled"
            ? "cancelled"
            : error.code === "tool_not_available"
              ? "not_available"
              : "failed";
        const completedAt = isoNow(this.now);
        const result = createToolResult({
          toolCallId,
          toolName: name,
          status,
          startedAt,
          completedAt,
          durationMs: Number(this.now()) - startedTimestamp,
          attempts,
          error: normalizedFailure(caught, error.code),
          metadata: { source: definition.source, patch: validatedInput.patch ?? null, cache: null }
        });
        error.toolResult = result;
        this.emit(context, {
          type: "tool_call_failed",
          stage: "retrieving",
          durationMs: result.durationMs,
          data: { toolCallId, toolName: name, attempts, error: result.error.code }
        });
        throw error;
      }
    }
  }
}
