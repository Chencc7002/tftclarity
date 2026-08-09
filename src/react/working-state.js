export const REACT_WORKING_STATE_SCHEMA_VERSION = "react-working-state.v1";

export class ReactWorkingState {
  constructor(request = {}, budget = {}) {
    this.question = String(request.input ?? request.question ?? "");
    this.seasonContextId = String(request.seasonContextId ?? "");
    this.messages = Array.isArray(request.messages) ? structuredClone(request.messages) : [];
    this.taskAnchor = request.taskAnchor ? structuredClone(request.taskAnchor) : null;
    this.bridgeContext = request.bridgeContext ? structuredClone(request.bridgeContext.view ?? request.bridgeContext) : null;
    this.budget = Object.freeze({ ...budget });
    this.decisions = [];
    this.observations = [];
    this.toolCallCount = 0;
    this.consecutiveNoProgress = 0;
    this.maxObservedConsecutiveNoProgress = 0;
    this.progressDecisionCount = 0;
    this.duplicateCallsBlocked = 0;
    this.toolFailureCount = 0;
    this.warnings = [];
    this.terminationReason = null;
  }

  recordDecision(action) {
    this.decisions.push(structuredClone(action));
  }

  recordObservation(observation, options = {}) {
    this.observations.push(structuredClone(observation));
    if (options.toolCall === true) this.toolCallCount += 1;
    if (options.progress === true) {
      this.consecutiveNoProgress = 0;
      this.progressDecisionCount += 1;
    } else {
      this.consecutiveNoProgress += 1;
      this.maxObservedConsecutiveNoProgress = Math.max(
        this.maxObservedConsecutiveNoProgress,
        this.consecutiveNoProgress
      );
    }
  }

  recordDuplicateBlocked() {
    this.duplicateCallsBlocked += 1;
  }

  recordToolFailure() {
    this.toolFailureCount += 1;
  }

  warn(warning) {
    this.warnings.push(String(warning));
  }

  terminate(reason) {
    this.terminationReason = String(reason);
  }

  snapshot(ledger) {
    return {
      schemaVersion: REACT_WORKING_STATE_SCHEMA_VERSION,
      question: this.question,
      seasonContextId: this.seasonContextId,
      messages: structuredClone(this.messages),
      taskAnchor: this.taskAnchor ? structuredClone(this.taskAnchor) : null,
      bridgeContext: this.bridgeContext ? structuredClone(this.bridgeContext) : null,
      iteration: this.decisions.length + 1,
      decisionCount: this.decisions.length,
      toolCallCount: this.toolCallCount,
      remainingBudget: {
        decisions: Math.max(0, Number(this.budget.maxDecisions ?? 0) - this.decisions.length),
        toolCalls: null
      },
      observations: structuredClone(this.observations),
      evidence: ledger.snapshot().entries,
      warnings: [...this.warnings]
    };
  }
}
