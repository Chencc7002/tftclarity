function finiteDurations(results) {
  return results.map((result) => Number(result.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
}

export function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const index = Math.max(0, Math.ceil(percentileValue * values.length) - 1);
  return values[Math.min(index, values.length - 1)];
}

export function calculateAgentMetrics(results) {
  const required = results.filter((result) => !result.skipped);
  const passed = required.filter((result) => result.passed).length;
  const failed = required.length - passed;
  const skipped = results.filter((result) => result.skipped).length;
  const durations = finiteDurations(required);
  const countWhere = (predicate) => required.filter(predicate).length;
  const rate = (predicate) => required.length ? countWhere(predicate) / required.length : 0;
  return {
    total: results.length,
    passed,
    failed,
    skipped,
    task_success_rate: required.length ? passed / required.length : 0,
    intent_accuracy: rate((result) => result.checks.intent),
    clarification_accuracy: rate((result) => result.checks.clarification),
    tool_selection_accuracy: rate((result) => result.checks.tools),
    tool_input_validity_rate: rate((result) => result.checks.toolInput),
    fallback_rate: rate((result) => result.actual.fallback),
    timeout_rate: rate((result) => result.actual.status === "timed_out"),
    average_duration_ms: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0,
    p95_duration_ms: percentile(durations, 0.95)
  };
}
