import { randomUUID } from "node:crypto";
import { normalizeRunBudget } from "./run-budget.js";
import { AgentRun } from "./run-state.js";
import { RuntimeError, runtimeError } from "./runtime-errors.js";

function emit(observer, event) {
  try {
    observer?.(event);
  } catch {
    // Observability must never change the request result.
  }
}

function outcomeFor(value, classifyResult) {
  const classified = classifyResult?.(value);
  return ["completed", "clarification_required", "fallback"].includes(classified)
    ? classified
    : "completed";
}

export class AgentRuntime {
  constructor(options = {}) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.budget = normalizeRunBudget(options.budget);
    this.onEvent = options.onEvent ?? null;
  }

  async run(request = {}, workflow, options = {}) {
    if (typeof workflow !== "function") throw new TypeError("AgentRuntime.run requires a workflow function");
    const run = new AgentRun({
      runId: this.createId(),
      createId: this.createId,
      now: this.now,
      budget: { ...this.budget, ...(options.budget ?? {}) },
      conversationId: request.conversationId,
      principalId: request.principalId,
      seasonContextId: request.seasonContextId
    });
    const observer = options.onEvent ?? this.onEvent;
    const publish = (event) => {
      const stored = run.appendEvent(event);
      if (stored) emit(observer, stored);
      return stored;
    };
    const context = {
      runId: run.runId,
      signal: options.signal ?? null,
      budget: run.budget,
      get status() {
        return run.status;
      },
      get terminal() {
        return run.terminal;
      },
      emit: publish,
      consumeToolCall: () => run.consumeToolCall(),
      consumeRetry: () => run.consumeRetry(),
      assertActive() {
        if (options.signal?.aborted) throw runtimeError("run_cancelled", "Agent run was cancelled");
        if (Number(run.now()) >= run.deadlineTimestamp) throw runtimeError("run_timed_out", "Agent run deadline exceeded");
        if (run.terminal) throw runtimeError("invalid_run_transition", `Agent run is already ${run.status}`);
      },
      async stage(stage, operation) {
        context.assertActive();
        run.enterStage(stage);
        const startedAt = Number(run.now());
        publish({ type: "stage_started", stage });
        try {
          const value = typeof operation === "function" ? await operation() : undefined;
          context.assertActive();
          publish({ type: "stage_completed", stage, durationMs: Number(run.now()) - startedAt });
          return value;
        } catch (error) {
          publish({
            type: "stage_completed",
            stage,
            durationMs: Number(run.now()) - startedAt,
            data: { status: "failed", error: String(error?.code ?? error?.name ?? "error") }
          });
          throw error;
        }
      }
    };

    run.start();
    publish({ type: "run_started", stage: "received" });

    let timeoutId;
    let abortListener;
    const workflowPromise = Promise.resolve().then(() => workflow(context));
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(runtimeError("run_timed_out", "Agent run deadline exceeded")),
        run.budget.deadlineMs
      );
    });
    const cancellationPromise = new Promise((_, reject) => {
      if (!options.signal) return;
      abortListener = () => reject(runtimeError("run_cancelled", "Agent run was cancelled"));
      if (options.signal.aborted) abortListener();
      else options.signal.addEventListener("abort", abortListener, { once: true });
    });

    try {
      const value = await Promise.race([workflowPromise, timeoutPromise, cancellationPromise]);
      if (run.terminal) throw runtimeError("invalid_run_transition", `Agent run ended as ${run.status}`);
      const outcome = outcomeFor(value, options.classifyResult);
      run.finish(outcome);
      const type = outcome === "clarification_required"
        ? "run_clarification_required"
        : outcome === "fallback"
          ? "run_fallback"
          : "run_completed";
      publish({ type, stage: "terminal" });
      return {
        value,
        run: run.snapshot(),
        publicRun: run.publicSnapshot()
      };
    } catch (caught) {
      const error = caught instanceof RuntimeError
        ? caught
        : runtimeError(caught?.code ?? "run_failed", caught?.message ?? "Agent run failed", { cause: caught });
      if (!run.terminal) {
        const status = error.code === "run_cancelled"
          ? "cancelled"
          : error.code === "run_timed_out"
            ? "timed_out"
            : "failed";
        run.finish(status, error);
        publish({
          type: status === "cancelled" ? "run_cancelled" : status === "timed_out" ? "run_timed_out" : "run_failed",
          stage: "terminal",
          data: { error: error.code }
        });
      }
      error.run = run.snapshot();
      error.publicRun = run.publicSnapshot();
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (abortListener && options.signal) options.signal.removeEventListener("abort", abortListener);
      workflowPromise.catch(() => {});
    }
  }
}
