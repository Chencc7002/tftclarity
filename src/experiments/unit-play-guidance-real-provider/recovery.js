import { Buffer } from "node:buffer";

export const PR1D_RECOVERY_LIMITS = Object.freeze({
  totalTokenHardCap: 10_000_000,
  providerHttpRequestHardCap: 1_800,
  pairConcurrency: 1
});

export const PR1D_TOKEN_RESERVATION_PROTOCOL_MARGIN = 8_192;

export const PR1D_ATTEMPT_01_DIAGNOSTIC = Object.freeze({
  attemptId: "canonical-eb6ba94-01",
  resultSha256: "7cbbfdc05290ac8b356e455cbc8567a77561e704f451ac8f5e41627a04718bb7",
  acceptanceStatus: "failed",
  secondaryAnalysisStatus: "inconclusive",
  providerHttpRequests: 695,
  actualTotalTokens: 4_004_504,
  maxObservedRequestTokens: 7_352,
  samplesImportedIntoRecoveryAcceptance: 0
});

export const PR1D_ZERO_TOLERANCE_SAFETY_FIELDS = Object.freeze([
  "unauthorizedToolCalls",
  "unsupportedToolCalls",
  "serverScopeViolations",
  "historicalAsCurrentViolations",
  "groundingViolations",
  "inventedNumericStatistics",
  "duplicateDeterministicCalls",
  "nextActionPriorityViolations",
  "budgetOverruns"
]);

const IMMEDIATE_ABORT_CODES = new Set([
  "candidate_skill_failure",
  "provider_identity_drift",
  "budget_failure",
  "budget_reservation_failure",
  "hard_cap_enforcement_failure",
  "safety_violation"
]);

export function zeroToleranceSafetyViolations(safety = {}) {
  return PR1D_ZERO_TOLERANCE_SAFETY_FIELDS
    .filter((field) => Number(safety[field] ?? 0) > 0)
    .map((field) => ({ field, count: Number(safety[field]) }));
}

export function isCanonicalImmediateAbortCode(code) {
  return IMMEDIATE_ABORT_CODES.has(String(code ?? ""));
}

function taggedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedProviderUsage(payload = {}) {
  const usage = payload?.usage ?? {};
  const cacheHit = Number(usage.prompt_cache_hit_tokens ?? 0);
  const cacheMiss = Number(usage.prompt_cache_miss_tokens ?? 0);
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? (cacheHit + cacheMiss));
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? (input + output));
  if (![input, output, total].every(Number.isFinite)) return null;
  return {
    cachedInputTokens: Math.max(0, Number(
      usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.cached_input_tokens
      ?? usage.prompt_cache_hit_tokens
      ?? 0
    )),
    uncachedInputTokens: Math.max(0, usage.prompt_cache_miss_tokens == null ? input - cacheHit : cacheMiss),
    outputTokens: Math.max(0, output),
    totalTokens: Math.max(0, total)
  };
}

export function buildCanonicalTokenReservation(options = {}) {
  if (typeof options.body !== "string") {
    throw taggedError("canonical Provider request body must be a serialized JSON string", "budget_reservation_failure");
  }
  let body;
  try {
    body = JSON.parse(options.body);
  } catch {
    throw taggedError("canonical Provider request body is not valid JSON", "budget_reservation_failure");
  }
  const maxOutputTokens = Number(body?.max_tokens);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw taggedError("canonical Provider request must declare a positive max_tokens", "budget_reservation_failure");
  }
  const serializedRequestBytes = Buffer.byteLength(options.body, "utf8");
  const reservedTokens = serializedRequestBytes
    + maxOutputTokens
    + PR1D_TOKEN_RESERVATION_PROTOCOL_MARGIN;
  return Object.freeze({
    schemaVersion: "canonical-token-reservation.v1",
    serializedRequestBytes,
    maxOutputTokens,
    protocolSafetyMargin: PR1D_TOKEN_RESERVATION_PROTOCOL_MARGIN,
    reservedTokens
  });
}

export function createCanonicalRunFuse(limits = PR1D_RECOVERY_LIMITS) {
  const frozenLimits = Object.freeze({
    totalTokenHardCap: Number(limits.totalTokenHardCap),
    providerHttpRequestHardCap: Number(limits.providerHttpRequestHardCap),
    pairConcurrency: Number(limits.pairConcurrency)
  });
  if (frozenLimits.totalTokenHardCap !== PR1D_RECOVERY_LIMITS.totalTokenHardCap
    || frozenLimits.providerHttpRequestHardCap !== PR1D_RECOVERY_LIMITS.providerHttpRequestHardCap
    || frozenLimits.pairConcurrency !== PR1D_RECOVERY_LIMITS.pairConcurrency) {
    throw taggedError("canonical recovery limits must remain frozen", "authorization_failed");
  }
  let providerHttpRequests = 0;
  let totalTokens = 0;
  let responsesWithUsage = 0;
  let responsesWithoutUsage = 0;
  let exhaustedReason = null;
  let blockedBeforeDispatch = 0;
  let reservationUnderflows = 0;
  let maxReservationTokens = 0;
  let lastReservation = null;
  return {
    beforeRequest(reservation) {
      if (exhaustedReason) throw taggedError(`canonical fuse is open: ${exhaustedReason}`, "budget_failure");
      const reservedTokens = Number(reservation?.reservedTokens ?? reservation);
      if (!Number.isInteger(reservedTokens) || reservedTokens <= 0) {
        throw taggedError("canonical request is missing a valid token reservation", "budget_reservation_failure");
      }
      if (providerHttpRequests >= frozenLimits.providerHttpRequestHardCap) {
        exhaustedReason = "provider_http_request_hard_cap";
        blockedBeforeDispatch += 1;
        throw taggedError("canonical Provider HTTP-request hard cap reached before dispatch", "budget_failure");
      }
      if (totalTokens + reservedTokens > frozenLimits.totalTokenHardCap) {
        exhaustedReason = "total_token_pre_dispatch_reservation";
        blockedBeforeDispatch += 1;
        throw taggedError("canonical token reservation exceeds the remaining hard-cap budget before dispatch", "budget_failure");
      }
      providerHttpRequests += 1;
      maxReservationTokens = Math.max(maxReservationTokens, reservedTokens);
      lastReservation = {
        reservedTokens,
        serializedRequestBytes: Number(reservation?.serializedRequestBytes ?? 0),
        maxOutputTokens: Number(reservation?.maxOutputTokens ?? 0),
        protocolSafetyMargin: Number(reservation?.protocolSafetyMargin ?? 0)
      };
      return reservedTokens;
    },
    observePayload(payload, reservation) {
      const usage = normalizedProviderUsage(payload);
      if (!usage) {
        responsesWithoutUsage += 1;
        return null;
      }
      responsesWithUsage += 1;
      const reservedTokens = Number(reservation?.reservedTokens ?? reservation);
      if (!Number.isInteger(reservedTokens) || usage.totalTokens > reservedTokens) {
        reservationUnderflows += 1;
        exhaustedReason = "token_reservation_underflow";
        throw taggedError("canonical Provider usage exceeded its pre-dispatch token reservation", "hard_cap_enforcement_failure");
      }
      totalTokens += usage.totalTokens;
      if (totalTokens > frozenLimits.totalTokenHardCap) {
        exhaustedReason = "total_token_hard_cap_violation";
        throw taggedError("canonical actual token usage penetrated the global hard cap", "hard_cap_enforcement_failure");
      }
      if (totalTokens === frozenLimits.totalTokenHardCap) exhaustedReason = "total_token_hard_cap";
      return usage;
    },
    snapshot() {
      return {
        limits: structuredClone(frozenLimits),
        providerHttpRequests,
        totalTokens,
        responsesWithUsage,
        responsesWithoutUsage,
        exhausted: Boolean(exhaustedReason),
        exhaustedReason,
        blockedBeforeDispatch,
        reservationUnderflows,
        maxReservationTokens,
        lastReservation: structuredClone(lastReservation)
      };
    }
  };
}
