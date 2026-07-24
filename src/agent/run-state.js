import { randomUUID } from "node:crypto";
import { assertBudgetAvailable, normalizeRunBudget } from "./run-budget.js";
import { runtimeError } from "./runtime-errors.js";

export const AGENT_RUN_SCHEMA_VERSION = "agent_run.v1";
export const AGENT_RUN_PUBLIC_SCHEMA_VERSION = "agent_run_public.v1";
export const AGENT_EVENT_SCHEMA_VERSION = "agent_event.v1";

export const AGENT_RUN_STATUSES = Object.freeze([
  "received",
  "running",
  "clarification_required",
  "completed",
  "fallback",
  "cancelled",
  "timed_out",
  "failed"
]);

export const AGENT_RUN_STAGES = Object.freeze([
  "received",
  "resolving",
  "planning",
  "retrieving",
  "assembling_evidence",
  "generating_conclusion",
  "validating",
  "responding",
  "terminal"
]);

export const TERMINAL_RUN_STATUSES = new Set([
  "clarification_required",
  "completed",
  "fallback",
  "cancelled",
  "timed_out",
  "failed"
]);

const TRANSITIONS = Object.freeze({
  received: new Set(["running", "cancelled", "timed_out", "failed"]),
  running: new Set([
    "clarification_required",
    "completed",
    "fallback",
    "cancelled",
    "timed_out",
    "failed"
  ])
});

function isoTimestamp(value) {
  return new Date(value).toISOString();
}

function safeError(error) {
  if (!error) return null;
  return {
    code: String(error.code ?? error.name ?? "error"),
    message: String(error.publicMessage ?? error.message ?? "Agent run failed").slice(0, 300)
  };
}

export class AgentRun {
  constructor(options = {}) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.budget = normalizeRunBudget(options.budget);
    const started = Number(this.now());
    this.schemaVersion = AGENT_RUN_SCHEMA_VERSION;
    this.runId = String(options.runId ?? this.createId());
    this.conversationId = String(options.conversationId ?? "default");
    this.principalId = String(options.principalId ?? "anonymous");
    this.seasonContextId = String(options.seasonContextId ?? "set17-live");
    this.status = "received";
    this.currentStage = "received";
    this.startedAt = isoTimestamp(started);
    this.updatedAt = this.startedAt;
    this.deadlineAt = isoTimestamp(started + this.budget.deadlineMs);
    this.deadlineTimestamp = started + this.budget.deadlineMs;
    this.stepCount = 0;
    this.toolCallCount = 0;
    this.retryCount = 0;
    this.events = [];
    this.droppedEventCount = 0;
    this.error = null;
  }

  get terminal() {
    return TERMINAL_RUN_STATUSES.has(this.status);
  }

  touch() {
    this.updatedAt = isoTimestamp(this.now());
  }

  transition(nextStatus, error = null) {
    if (!AGENT_RUN_STATUSES.includes(nextStatus)) {
      throw runtimeError("invalid_run_transition", `Unknown AgentRun status: ${nextStatus}`);
    }
    if (this.terminal || !TRANSITIONS[this.status]?.has(nextStatus)) {
      throw runtimeError("invalid_run_transition", `AgentRun cannot transition from ${this.status} to ${nextStatus}`, {
        details: { from: this.status, to: nextStatus }
      });
    }
    this.status = nextStatus;
    this.error = safeError(error);
    if (TERMINAL_RUN_STATUSES.has(nextStatus)) this.currentStage = "terminal";
    this.touch();
    return this;
  }

  start() {
    this.transition("running");
    return this;
  }

  enterStage(stage) {
    if (!AGENT_RUN_STAGES.includes(stage) || stage === "received" || stage === "terminal") {
      throw runtimeError("invalid_run_stage", `Unknown or unavailable AgentRun stage: ${stage}`);
    }
    if (this.status !== "running") {
      throw runtimeError("invalid_run_transition", `Cannot enter stage ${stage} while run is ${this.status}`);
    }
    assertBudgetAvailable(this.stepCount, this.budget.maxSteps, "steps");
    this.stepCount += 1;
    this.currentStage = stage;
    this.touch();
    return this;
  }

  consumeToolCall() {
    if (this.status !== "running") {
      throw runtimeError("invalid_run_transition", `Cannot call a tool while run is ${this.status}`);
    }
    assertBudgetAvailable(this.toolCallCount, this.budget.maxToolCalls, "tool_calls");
    this.toolCallCount += 1;
    this.touch();
    return this.toolCallCount;
  }

  consumeRetry() {
    this.retryCount += 1;
    this.touch();
    return this.retryCount;
  }

  appendEvent(event = {}) {
    if (this.events.length >= this.budget.maxEvents) {
      this.droppedEventCount += 1;
      return null;
    }
    const value = {
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: String(event.eventId ?? this.createId()),
      runId: this.runId,
      type: String(event.type ?? "runtime_event"),
      stage: String(event.stage ?? this.currentStage),
      timestamp: isoTimestamp(event.timestamp ?? this.now()),
      durationMs: Math.max(0, Number(event.durationMs ?? 0)),
      data: event.data && typeof event.data === "object" ? structuredClone(event.data) : {}
    };
    this.events.push(value);
    this.touch();
    return value;
  }

  finish(status = "completed", error = null) {
    this.transition(status, error);
    return this;
  }

  snapshot() {
    return structuredClone({
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      conversationId: this.conversationId,
      principalId: this.principalId,
      seasonContextId: this.seasonContextId,
      status: this.status,
      currentStage: this.currentStage,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      deadlineAt: this.deadlineAt,
      stepCount: this.stepCount,
      toolCallCount: this.toolCallCount,
      retryCount: this.retryCount,
      budget: this.budget,
      events: this.events,
      droppedEventCount: this.droppedEventCount,
      error: this.error
    });
  }

  publicSnapshot() {
    const durationMs = Math.max(0, new Date(this.updatedAt).getTime() - new Date(this.startedAt).getTime());
    return {
      schemaVersion: AGENT_RUN_PUBLIC_SCHEMA_VERSION,
      runId: this.runId,
      status: this.status,
      currentStage: this.currentStage,
      stepCount: this.stepCount,
      toolCallCount: this.toolCallCount,
      retryCount: this.retryCount,
      durationMs,
      deadlineAt: this.deadlineAt,
      budget: this.budget,
      ...(this.error ? { error: { code: this.error.code } } : {})
    };
  }
}
