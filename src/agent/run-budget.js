import { runtimeError } from "./runtime-errors.js";

export const DEFAULT_AGENT_RUN_BUDGET = Object.freeze({
  deadlineMs: 10000,
  maxSteps: 12,
  maxToolCalls: 12,
  maxRetriesPerTool: 1,
  maxEvents: 100
});

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? Math.min(number, max) : fallback;
}

export function normalizeRunBudget(value = {}) {
  return Object.freeze({
    deadlineMs: boundedInteger(value.deadlineMs, DEFAULT_AGENT_RUN_BUDGET.deadlineMs, 1, 120000),
    maxSteps: boundedInteger(value.maxSteps, DEFAULT_AGENT_RUN_BUDGET.maxSteps, 1, 100),
    maxToolCalls: boundedInteger(value.maxToolCalls, DEFAULT_AGENT_RUN_BUDGET.maxToolCalls, 0, 100),
    maxRetriesPerTool: boundedInteger(value.maxRetriesPerTool, DEFAULT_AGENT_RUN_BUDGET.maxRetriesPerTool, 0, 5),
    maxEvents: boundedInteger(value.maxEvents, DEFAULT_AGENT_RUN_BUDGET.maxEvents, 1, 1000)
  });
}

export function assertBudgetAvailable(current, maximum, kind) {
  if (current >= maximum) {
    throw runtimeError("budget_exhausted", `Agent run ${kind} budget exhausted`, {
      details: { kind, current, maximum }
    });
  }
}
