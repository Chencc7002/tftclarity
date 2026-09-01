import { AgentRuntime } from "../agent/runtime.js";
import { ReactLoop, normalizeReactLoopBudget } from "../react/react-loop.js";

export class ChatAgent {
  constructor(options = {}) {
    if (!options.registry) throw new TypeError("ChatAgent requires a ToolRegistry");
    if (!options.toolExecutor) throw new TypeError("ChatAgent requires a ToolExecutor");
    if (typeof options.decisionProvider !== "function") {
      throw new TypeError("ChatAgent requires a decisionProvider");
    }
    this.registry = options.registry;
    this.toolExecutor = options.toolExecutor;
    this.decisionProvider = options.decisionProvider;
    this.handlers = { ...(options.handlers ?? {}) };
    this.resolveHandler = options.resolveHandler ?? null;
    this.availableToolNames = options.availableToolNames ?? Object.keys(this.handlers);
    this.budget = normalizeReactLoopBudget(options.budget);
    this.groundingMode = options.groundingMode;
    // Opt-in recovery, no production environment switch. Quick Task is untouched.
    this.deadlineRecovery = options.deadlineRecovery === true;
    this.compositionCardScope = options.compositionCardScope === true;
    this.compositionCardsOwnPositioning = options.compositionCardsOwnPositioning === true;
    this.officialItemEvidenceV1 = options.officialItemEvidenceV1 === true;
    this.agentRuntime = options.agentRuntime ?? new AgentRuntime({
      budget: {
        deadlineMs: this.budget.deadlineMs,
        maxSteps: 12,
        maxToolCalls: null,
        maxRetriesPerTool: this.budget.maxRetriesPerTool,
        maxEvents: 100
      }
    });
    this.createId = options.createId;
    this.now = options.now;
  }

  async chat(request = {}, options = {}) {
    const loop = new ReactLoop({
      decisionProvider: this.decisionProvider,
      registry: this.registry,
      toolExecutor: this.toolExecutor,
      handlers: this.handlers,
      resolveHandler: this.resolveHandler,
      availableToolNames: this.availableToolNames,
      budget: { ...this.budget, ...(options.budget ?? {}) },
      groundingMode: options.groundingMode ?? this.groundingMode,
      ...(this.createId ? { createId: this.createId } : {}),
      ...(this.now ? { now: this.now } : {})
    });
    const controller = this.deadlineRecovery ? new AbortController() : null;
    const cancel = () => controller?.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel();
    else if (controller) options.signal?.addEventListener("abort", cancel, { once: true });
    let recoverDeadline;
    try {
      const execution = await this.agentRuntime.run({
        conversationId: request.conversationId,
        principalId: request.principalId,
        seasonContextId: request.seasonContextId
      }, (run) => loop.run(request, {
        run,
        compositionCardScope: this.compositionCardScope,
        compositionCardsOwnPositioning: this.compositionCardsOwnPositioning,
        officialItemEvidenceV1: this.officialItemEvidenceV1,
        signal: controller?.signal ?? options.signal,
        ...(controller ? { registerDeadlineRecovery: (recover) => { recoverDeadline = recover; } } : {}),
        onEvent: options.onEvent,
        budget: options.budget,
        groundingMode: options.groundingMode ?? this.groundingMode,
        createEvidenceId: options.createEvidenceId
      }), {
        signal: options.signal,
        budget: {
          deadlineMs: Number(options.budget?.deadlineMs ?? this.budget.deadlineMs),
          maxToolCalls: null,
          maxRetriesPerTool: Number(
            options.budget?.maxRetriesPerTool ?? this.budget.maxRetriesPerTool
          )
        },
        classifyResult: (value) => value?.status === "clarification_required"
          ? "clarification_required"
          : "completed"
      });
      return {
        ...execution.value,
        run: execution.publicRun
      };
    } catch (error) {
      controller?.abort(error);
      const partial = recoverDeadline?.(options.signal?.aborted ? { code: "run_cancelled" } : error);
      if (partial && error.code === "run_timed_out" && !options.signal?.aborted) {
        return { ...partial, run: error.publicRun };
      }
      throw error;
    } finally {
      controller?.abort();
      if (controller) options.signal?.removeEventListener("abort", cancel);
    }
  }
}
