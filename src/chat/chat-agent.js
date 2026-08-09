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
    const execution = await this.agentRuntime.run({
      conversationId: request.conversationId,
      principalId: request.principalId,
      seasonContextId: request.seasonContextId
    }, (run) => loop.run(request, {
      run,
      signal: options.signal,
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
  }
}
