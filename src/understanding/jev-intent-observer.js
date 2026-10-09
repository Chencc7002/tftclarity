import { createJevIntentShadow } from "./jev-intent-shadow.js";
import { classifyDomain } from "../domain/tft/domain-gate.js";

export const JEV_INTENT_CONTROL_SCHEMA_VERSION = "jev-intent-control.v1";
export const JEV_INTENT_OUTCOME_SCHEMA_VERSION = "jev-intent-outcome.v1";

// This is an observation policy, not a calibrated production routing threshold.
export function projectJevIntentCandidate(result, { inheritedDomain = null } = {}) {
  if (result.status !== "observed") return { action: null, disposition: "unavailable" };
  const { action, domain, context } = result.answers;
  if (domain.choice !== "tft") {
    if (context.choice === "contextual" && inheritedDomain === "tft" && action.choice !== "unknown") {
      return { action: action.choice, disposition: "candidate_only", domainResolution: "inherited_tft_context" };
    }
    return { action: null, disposition: "domain_unresolved" };
  }
  if (context.choice === "missing") return { action: null, disposition: "context_missing" };
  if (action.choice === "unknown") return { action: null, disposition: "action_unknown" };
  return { action: action.choice, disposition: "candidate_only" };
}

function selectedConfidence(answer) {
  return Math.min(Number(answer?.confidence ?? 0), Number(answer?.probabilities?.[answer?.choice] ?? 0));
}

// Control is a bounded semantic hint for the existing ReAct decision provider.
// It cannot name tools, arguments, TaskFrames, Evidence or permissions.
export function projectJevIntentControl(result, { inheritedDomain = null, minConfidence = 0.7 } = {}) {
  if (!Number.isFinite(minConfidence) || minConfidence < 0.5 || minConfidence > 1) {
    throw new TypeError("Invalid Jev control confidence");
  }
  const candidate = projectJevIntentCandidate(result, { inheritedDomain });
  if (candidate.disposition !== "candidate_only") {
    return { advisory: null, disposition: candidate.disposition };
  }
  const confidence = {
    action: selectedConfidence(result.answers.action),
    domain: selectedConfidence(result.answers.domain),
    context: selectedConfidence(result.answers.context)
  };
  if (confidence.action < minConfidence) return { advisory: null, disposition: "low_action_confidence" };
  if (confidence.context < minConfidence) return { advisory: null, disposition: "low_context_confidence" };
  if (!candidate.domainResolution && confidence.domain < minConfidence) {
    return { advisory: null, disposition: "low_domain_confidence" };
  }
  return {
    disposition: "control_eligible",
    advisory: {
      schemaVersion: JEV_INTENT_CONTROL_SCHEMA_VERSION,
      action: candidate.action,
      domain: "tft",
      context: result.answers.context.choice,
      confidence,
      domainResolution: candidate.domainResolution ?? "jev_direct",
      authority: "intent_hint_only"
    }
  };
}

function previousUserTurns(request) {
  if (request.startNewTask) return [];
  const previous = (request.messages ?? [])
    .filter(message => message.role === "user" && typeof message.content === "string")
    .map(message => ({ role: "user", content: message.content.slice(0, 1500) }));
  if (previous.at(-1)?.content === request.input) previous.pop();
  return previous.slice(-3);
}

export function inferJevInheritedDomain(request) {
  const previous = previousUserTurns(request);
  if (!previous.length) return null;
  const result = classifyDomain("", { conversation: previous, defaultDomain: "out_of_domain" });
  return result.domain === "tft" ? "tft" : null;
}

// Existing deterministic domain gate used only as an observational baseline.
// It cannot override Jev or authorize control.
export function inferJevDeterministicDomain(request) {
  const previous = previousUserTurns(request);
  return classifyDomain(request.input, { conversation: previous, defaultDomain: "out_of_domain" });
}

// Request-local user turns only: no second conversation store, assistant claims,
// tool results, Evidence, credentials or client-supplied summary are projected.
export function projectJevIntentInput(request) {
  const previous = previousUserTurns(request);
  return { input: request.input, conversationSummary: previous.length
    ? JSON.stringify({ untrustedPreviousUserTurns: previous.map(message => message.content) }) : "" };
}

export function createJevIntentObserver({ env = {}, mode = env.TFT_AGENT_JEV_INTENT_MODE ?? "off",
  apiKey = env.TYPESAFE_API_KEY ?? "", timeoutMs = Number(env.TFT_AGENT_JEV_INTENT_TIMEOUT_MS ?? 1500),
  maxRequests = Number(env.TFT_AGENT_JEV_INTENT_MAX_REQUESTS ?? 100),
  sampleRate = Number(env.TFT_AGENT_JEV_INTENT_SAMPLE_RATE ?? 1),
  controlMinConfidence = Number(env.TFT_AGENT_JEV_INTENT_CONTROL_MIN_CONFIDENCE ?? 0.7),
  random = Math.random, fetchImpl, onObservation, onOutcome } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 10000) throw new TypeError("Invalid Jev request limit");
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new TypeError("Invalid Jev sample rate");
  if (!Number.isFinite(controlMinConfidence) || controlMinConfidence < 0.5 || controlMinConfidence > 1) {
    throw new TypeError("Invalid Jev control confidence");
  }
  const classify = createJevIntentShadow({ mode, apiKey, timeoutMs, fetchImpl });
  let inFlight = 0;
  let attempted = 0;
  let observationSequence = 0;
  let controlApplied = 0;
  let last = null;
  const counts = {};
  const controlFallbacks = {};
  const domainComparisons = { agreement: 0, disagreement: 0, unavailable: 0 };
  const outcomeCounts = { recorded: 0, applied: 0, fallback: 0, withTools: 0, statuses: {} };
  const publish = event => {
    const recorded = { mode, ...event };
    last = structuredClone(recorded);
    counts[recorded.status] = (counts[recorded.status] ?? 0) + 1;
    // Observability cannot delay, reject or modify the user's result.
    try { Promise.resolve(onObservation?.(structuredClone(recorded))).catch(() => {}); } catch {}
    return recorded;
  };
  const publishOutcome = event => {
    outcomeCounts.recorded++;
    if (event.controlApplied) outcomeCounts.applied++;
    else outcomeCounts.fallback++;
    if (event.toolNames.length) outcomeCounts.withTools++;
    outcomeCounts.statuses[event.status] = (outcomeCounts.statuses[event.status] ?? 0) + 1;
    // Outcome telemetry is best-effort and must never affect the response.
    try { Promise.resolve(onOutcome?.(structuredClone(event))).catch(() => {}); } catch {}
    return event;
  };
  const fallback = (status, reason, observationId) => {
    if (mode !== "control") return { status, reason };
    controlFallbacks[reason] = (controlFallbacks[reason] ?? 0) + 1;
    return publish({ status, reason, observationId, control: { advisory: null, disposition: reason } });
  };
  return {
    mode,
    snapshot: () => ({ mode, inFlight, attempted, maxRequests, sampleRate, controlMinConfidence,
      controlApplied, controlFallbacks: { ...controlFallbacks }, counts: { ...counts },
      domainComparisons: { ...domainComparisons },
      outcomes: { ...outcomeCounts, statuses: { ...outcomeCounts.statuses } },
      last: structuredClone(last) }),
    recordOutcome(observation, result = {}, decisionTrace = []) {
      if (!observation || !Number.isSafeInteger(observation.observationId)) return null;
      const decisions = Array.isArray(decisionTrace) ? decisionTrace.slice(0, 24) : [];
      const boundedDecisions = decisions.map(decision => ({
        type: ["call_tool", "ask_user", "finish", "rejected"].includes(decision?.type)
          ? decision.type : "unknown",
        tool: typeof decision?.tool === "string" ? decision.tool.slice(0, 100) : null,
        purposeCode: typeof decision?.purposeCode === "string" ? decision.purposeCode.slice(0, 100) : null
      }));
      const toolNames = [...new Set(boundedDecisions.map(decision => decision.tool).filter(Boolean))];
      return publishOutcome({
        schemaVersion: JEV_INTENT_OUTCOME_SCHEMA_VERSION,
        mode,
        observationId: observation.observationId,
        controlDisposition: String(observation.control?.disposition ?? observation.candidate?.disposition ?? "unavailable"),
        controlApplied: Boolean(observation.control?.advisory),
        status: typeof result?.status === "string" ? result.status.slice(0, 100) : "failed",
        terminationReason: typeof result?.terminationReason === "string" ? result.terminationReason.slice(0, 100) : null,
        answerOrigin: typeof result?.answerOrigin === "string" ? result.answerOrigin.slice(0, 100) : null,
        firstDecision: boundedDecisions[0] ?? null,
        finalDecision: boundedDecisions.at(-1) ?? null,
        decisionCount: Number.isSafeInteger(result?.safetyMetrics?.decisions)
          ? result.safetyMetrics.decisions : boundedDecisions.length,
        actualToolCalls: Number.isSafeInteger(result?.safetyMetrics?.actualToolCalls)
          ? result.safetyMetrics.actualToolCalls : 0,
        toolNames,
        evidenceCount: Array.isArray(result?.evidence) ? result.evidence.length : 0
      });
    },
    async observe(request, { signal } = {}) {
      if (mode === "off") return { status: "disabled" };
      const observationId = ++observationSequence;
      if (attempted >= maxRequests) return mode === "control"
        ? fallback("skipped", "request_limit", observationId)
        : publish({ status: "skipped", reason: "request_limit", observationId });
      if (sampleRate === 0 || (sampleRate < 1 && random() >= sampleRate)) {
        return mode === "control"
          ? fallback("skipped", "not_sampled", observationId)
          : publish({ status: "skipped", reason: "not_sampled", observationId });
      }
      if (inFlight >= 4) return mode === "control"
        ? fallback("skipped", "concurrency_limit", observationId)
        : publish({ status: "skipped", reason: "concurrency_limit", observationId });
      inFlight++;
      attempted++;
      try {
        const result = await classify(projectJevIntentInput(request), { signal });
        const inheritedDomain = inferJevInheritedDomain(request);
        const candidate = projectJevIntentCandidate(result, { inheritedDomain });
        const deterministicDomain = inferJevDeterministicDomain(request);
        const domainAgreement = result.status === "observed"
          ? result.answers.domain.choice === deterministicDomain.domain
          : null;
        domainComparisons[domainAgreement === null ? "unavailable" : domainAgreement ? "agreement" : "disagreement"]++;
        if (mode !== "control") return publish({ ...result, observationId, candidate,
          deterministicDomain, domainAgreement });
        const control = projectJevIntentControl(result, { inheritedDomain, minConfidence: controlMinConfidence });
        if (control.advisory) controlApplied++;
        else controlFallbacks[control.disposition] = (controlFallbacks[control.disposition] ?? 0) + 1;
        return publish({ ...result, observationId, candidate, control, deterministicDomain, domainAgreement });
      } catch {
        return mode === "control"
          ? fallback("unavailable", "observation_failed", observationId)
          : publish({ status: "unavailable", reason: "observation_failed", observationId });
      } finally { inFlight--; }
    }
  };
}
