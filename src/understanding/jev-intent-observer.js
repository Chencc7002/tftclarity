import { createJevIntentShadow } from "./jev-intent-shadow.js";

// This is an observation policy, not a calibrated production routing threshold.
export function projectJevIntentCandidate(result) {
  if (result.status !== "observed") return { action: null, disposition: "unavailable" };
  const { action, domain, context } = result.answers;
  if (domain.choice !== "tft") return { action: null, disposition: "domain_unresolved" };
  if (context.choice === "missing") return { action: null, disposition: "context_missing" };
  if (action.choice === "unknown") return { action: null, disposition: "action_unknown" };
  return { action: action.choice, disposition: "candidate_only" };
}

// Request-local user turns only: no second conversation store, assistant claims,
// tool results, Evidence, credentials or client-supplied summary are projected.
export function projectJevIntentInput(request) {
  const previous = request.startNewTask ? [] : (request.messages ?? [])
    .filter(message => message.role === "user" && typeof message.content === "string")
    .slice(-3).map(message => message.content.slice(0, 1500));
  if (previous.at(-1) === request.input) previous.pop();
  return { input: request.input, conversationSummary: previous.length
    ? JSON.stringify({ untrustedPreviousUserTurns: previous }) : "" };
}

export function createJevIntentObserver({ env = {}, mode = env.TFT_AGENT_JEV_INTENT_MODE ?? "off",
  apiKey = env.TYPESAFE_API_KEY ?? "", timeoutMs = Number(env.TFT_AGENT_JEV_INTENT_TIMEOUT_MS ?? 1500),
  maxRequests = Number(env.TFT_AGENT_JEV_INTENT_MAX_REQUESTS ?? 100),
  sampleRate = Number(env.TFT_AGENT_JEV_INTENT_SAMPLE_RATE ?? 1),
  random = Math.random, fetchImpl, onObservation } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 10000) throw new TypeError("Invalid Jev request limit");
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new TypeError("Invalid Jev sample rate");
  const classify = createJevIntentShadow({ mode, apiKey, timeoutMs, fetchImpl });
  let inFlight = 0;
  let attempted = 0;
  let last = null;
  const counts = {};
  const publish = event => {
    last = structuredClone(event);
    counts[event.status] = (counts[event.status] ?? 0) + 1;
    // Observability cannot delay, reject or modify the user's result.
    try { Promise.resolve(onObservation?.(structuredClone(event))).catch(() => {}); } catch {}
    return event;
  };
  return {
    mode,
    snapshot: () => ({ mode, inFlight, attempted, maxRequests, sampleRate, counts: { ...counts }, last: structuredClone(last) }),
    async observe(request, { signal } = {}) {
      if (mode === "off") return { status: "disabled" };
      if (attempted >= maxRequests) return publish({ status: "skipped", reason: "request_limit" });
      if (sampleRate === 0 || (sampleRate < 1 && random() >= sampleRate)) return { status: "skipped", reason: "not_sampled" };
      if (inFlight >= 4) return publish({ status: "skipped", reason: "concurrency_limit" });
      inFlight++;
      const observationId = ++attempted;
      try {
        const result = await classify(projectJevIntentInput(request), { signal });
        return publish({ ...result, observationId, candidate: projectJevIntentCandidate(result) });
      } catch {
        return publish({ status: "unavailable", reason: "observation_failed" });
      } finally { inFlight--; }
    }
  };
}
