import { createJevIntentShadow } from "./jev-intent-shadow.js";
import { classifyDomain } from "../domain/tft/domain-gate.js";

export const JEV_INTENT_CONTROL_SCHEMA_VERSION = "jev-intent-control.v1";

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
  random = Math.random, fetchImpl, onObservation } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 10000) throw new TypeError("Invalid Jev request limit");
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new TypeError("Invalid Jev sample rate");
  if (!Number.isFinite(controlMinConfidence) || controlMinConfidence < 0.5 || controlMinConfidence > 1) {
    throw new TypeError("Invalid Jev control confidence");
  }
  const classify = createJevIntentShadow({ mode, apiKey, timeoutMs, fetchImpl });
  let inFlight = 0;
  let attempted = 0;
  let controlApplied = 0;
  let last = null;
  const counts = {};
  const controlFallbacks = {};
  const publish = event => {
    const recorded = { mode, ...event };
    last = structuredClone(recorded);
    counts[recorded.status] = (counts[recorded.status] ?? 0) + 1;
    // Observability cannot delay, reject or modify the user's result.
    try { Promise.resolve(onObservation?.(structuredClone(recorded))).catch(() => {}); } catch {}
    return recorded;
  };
  const fallback = (status, reason) => {
    if (mode !== "control") return { status, reason };
    controlFallbacks[reason] = (controlFallbacks[reason] ?? 0) + 1;
    return publish({ status, reason, control: { advisory: null, disposition: reason } });
  };
  return {
    mode,
    snapshot: () => ({ mode, inFlight, attempted, maxRequests, sampleRate, controlMinConfidence,
      controlApplied, controlFallbacks: { ...controlFallbacks }, counts: { ...counts }, last: structuredClone(last) }),
    async observe(request, { signal } = {}) {
      if (mode === "off") return { status: "disabled" };
      if (attempted >= maxRequests) return mode === "control"
        ? fallback("skipped", "request_limit") : publish({ status: "skipped", reason: "request_limit" });
      if (sampleRate === 0 || (sampleRate < 1 && random() >= sampleRate)) return fallback("skipped", "not_sampled");
      if (inFlight >= 4) return mode === "control"
        ? fallback("skipped", "concurrency_limit") : publish({ status: "skipped", reason: "concurrency_limit" });
      inFlight++;
      const observationId = ++attempted;
      try {
        const result = await classify(projectJevIntentInput(request), { signal });
        const inheritedDomain = inferJevInheritedDomain(request);
        const candidate = projectJevIntentCandidate(result, { inheritedDomain });
        if (mode !== "control") return publish({ ...result, observationId, candidate });
        const control = projectJevIntentControl(result, { inheritedDomain, minConfidence: controlMinConfidence });
        if (control.advisory) controlApplied++;
        else controlFallbacks[control.disposition] = (controlFallbacks[control.disposition] ?? 0) + 1;
        return publish({ ...result, observationId, candidate, control });
      } catch {
        return mode === "control"
          ? fallback("unavailable", "observation_failed")
          : publish({ status: "unavailable", reason: "observation_failed" });
      } finally { inFlight--; }
    }
  };
}
