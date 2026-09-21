const HARD_FAILURE_CODES = new Set([
  "candidate_skill_failure",
  "hard_cap_enforcement_failure",
  "safety_violation"
]);

function gatePassed(value) {
  return value === true;
}

export function deriveCanonicalAttemptOutcome({
  abort = null,
  completedPlan = false,
  responsesWithoutUsage = 0,
  analyzability = {}
} = {}) {
  if (HARD_FAILURE_CODES.has(abort?.code)) {
    return Object.freeze({
      status: "failed",
      acceptance: "not_passed",
      reason: String(abort.code),
      safety: "failed",
      analyzability: "not_evaluated",
      value: "not_evaluated",
      stability: "not_evaluated",
      costAcceptance: "not_evaluated",
      facetAdjudicationRequired: false
    });
  }

  if (!completedPlan || abort || Number(responsesWithoutUsage) > 0) {
    const reason = abort?.code
      ? String(abort.code)
      : Number(responsesWithoutUsage) > 0
        ? "provider_usage_incomplete"
        : "incomplete_execution_plan";
    return Object.freeze({
      status: "inconclusive",
      acceptance: "not_passed",
      reason,
      safety: "not_evaluated",
      analyzability: "not_evaluated",
      value: "not_evaluated",
      stability: "not_evaluated",
      costAcceptance: "not_evaluated",
      facetAdjudicationRequired: false
    });
  }

  if (!gatePassed(analyzability.validPairedRepetitionsPass)
    || !gatePassed(analyzability.coveredCasesPass)) {
    return Object.freeze({
      status: "inconclusive",
      acceptance: "not_passed",
      reason: "insufficient_valid_provider_pairs",
      safety: "passed",
      analyzability: "failed",
      value: "not_evaluated",
      stability: "not_evaluated",
      costAcceptance: "not_evaluated",
      facetAdjudicationRequired: false
    });
  }

  return Object.freeze({
    status: "awaiting_facet_adjudication",
    acceptance: "pending",
    reason: "facet_adjudication_required",
    safety: "passed",
    analyzability: "passed",
    value: "pending",
    stability: "pending",
    costAcceptance: "pending",
    facetAdjudicationRequired: true
  });
}

function upper(value) {
  return String(value ?? "unknown").toUpperCase();
}

export function renderCanonicalAttemptReport(result) {
  const armA = result.aggregate.arms.A;
  const armB = result.aggregate.arms.B;
  const acceptance = deriveCanonicalAttemptOutcome({
    abort: result.abort,
    completedPlan: result.plan.completedAgentRuns === result.plan.plannedAgentRuns,
    responsesWithoutUsage: result.fuse.responsesWithoutUsage,
    analyzability: result.aggregate.analyzability
  });
  const nextGate = acceptance.facetAdjudicationRequired
    ? "Arm-blinded facet labels and adjudication remain required before the Value and Stability gates can produce a final PR1D PASS/FAIL verdict."
    : "Facet adjudication is not required and must not be used for acceptance because the preliminary execution or acceptance gates did not pass. Value, Stability, and Cost Acceptance remain NOT_EVALUATED.";

  return `# Unit Play Guidance PR1D Canonical Real-provider Attempt

Status: **${upper(acceptance.status)}**

Acceptance: **${upper(acceptance.acceptance)}**

Reason: **${acceptance.reason}**

This is an offline real-provider acceptance artifact. It does not authorize production Skill control, canary, rollout, PR2, live retrieval, new Tools, or other Skills.

## Acceptance classification

| Gate | Result |
| --- | --- |
| Safety / architecture | ${upper(acceptance.safety)} |
| Analyzability | ${upper(acceptance.analyzability)} |
| Value | ${upper(acceptance.value)} |
| Stability | ${upper(acceptance.stability)} |
| Cost acceptance | ${upper(acceptance.costAcceptance)} |
| Facet adjudication required | ${acceptance.facetAdjudicationRequired} |

## Reproducibility

| Field | Value |
| --- | --- |
| Call-enabled experiment commit | \`${result.manifest.implementationCommitSha}\` |
| Provider / model | \`${result.manifest.provider.runtimeProviderConfig}\` / \`${result.manifest.provider.model}\` |
| Provider endpoint | \`${result.manifest.provider.endpoint}\` |
| Credential configured | ${result.manifest.credentialConfigured} |
| Credential binding confirmed for | \`${result.manifest.credentialBindingConfirmedFor}\` |
| Pair-order SHA-256 | \`${result.plan.orderSha256}\` |
| Planned / completed Agent runs | ${result.plan.plannedAgentRuns} / ${result.plan.completedAgentRuns} |
| Provider HTTP requests | ${result.fuse.providerHttpRequests} |
| Provider-reported total tokens | ${result.fuse.totalTokens} |
| Pre-dispatch blocked calls | ${result.fuse.blockedBeforeDispatch} |
| Reservation underflows | ${result.fuse.reservationUnderflows} |
| Provider identity observations | ${result.providerIdentity.observations} |
| Immutable identity unavailable | ${result.providerIdentity.immutableIdentityUnavailable} |

## Reliability and analyzability

| Metric | A | B |
| --- | ---: | ---: |
| Attempted runs | ${armA.attempted} | ${armB.attempted} |
| Normal Provider completions | ${armA.normalProviderCompletions} | ${armB.normalProviderCompletions} |
| Completion rate | ${armA.normalProviderCompletionRate.toFixed(4)} | ${armB.normalProviderCompletionRate.toFixed(4)} |
| Mean Tool calls | ${armA.meanToolCalls.toFixed(3)} | ${armB.meanToolCalls.toFixed(3)} |
| P95 Tool calls | ${armA.p95ToolCalls.toFixed(3)} | ${armB.p95ToolCalls.toFixed(3)} |
| Mean decision calls | ${armA.meanDecisionCalls.toFixed(3)} | ${armB.meanDecisionCalls.toFixed(3)} |
| P95 decision calls | ${armA.p95DecisionCalls.toFixed(3)} | ${armB.p95DecisionCalls.toFixed(3)} |
| Mean actual total tokens | ${armA.meanActualTotalTokens.toFixed(3)} | ${armB.meanActualTotalTokens.toFixed(3)} |
| Mean Agent E2E latency ms | ${armA.meanE2eLatencyMs.toFixed(3)} | ${armB.meanE2eLatencyMs.toFixed(3)} |

- Valid paired repetitions: ${result.aggregate.validPairedRepetitions}/90.
- Cases with at least two valid pairs: ${result.aggregate.casesWithAtLeastTwoValidPairs}/30.
- Candidate Skill failures: ${result.aggregate.reliability.candidateSkillFailures}.
- Completion parity: ${result.aggregate.reliability.completionParityPass ? "PASS" : "FAIL"}.
- Global fuse: ${result.fuse.exhausted ? `OPEN (${result.fuse.exhaustedReason})` : "not reached"}.
- Abort: ${result.abort ? `\`${result.abort.code}\` — ${result.abort.message}` : "none"}.
- Recovery execution: fresh 180 runs; prior attempt samples imported: ${result.manifest.recovery.priorAttemptSamplesImported}.

## Next gate

${nextGate} No subsequent phase is authorized by this attempt.
`;
}
