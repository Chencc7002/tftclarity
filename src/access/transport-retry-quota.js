import { createHash } from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_ID_LENGTH = 160;

function retryMetadata(body = {}) {
  const requestId = String(body.requestId ?? "").normalize("NFKC").trim().slice(0, MAX_REQUEST_ID_LENGTH);
  const retry = body.transportRetry && typeof body.transportRetry === "object"
    ? body.transportRetry
    : {};
  const attempt = Number.isInteger(Number(retry.attempt)) ? Number(retry.attempt) : 0;
  const retryOfRequestId = String(retry.retryOfRequestId ?? "").normalize("NFKC").trim().slice(0, MAX_REQUEST_ID_LENGTH);
  return { requestId, attempt, retryOfRequestId };
}

function requestFingerprint(body, visitor) {
  return createHash("sha256").update(JSON.stringify({
    scope: String(visitor?.scope ?? "anonymous"),
    input: String(body?.input ?? ""),
    conversationId: String(body?.conversationId ?? body?.conversation_id ?? "default"),
    seasonContextId: String(body?.seasonContextId ?? ""),
    quickTask: body?.quickTask ?? null,
    supplementalText: String(body?.supplementalText ?? ""),
    messages: body?.messages ?? null,
    analysisContext: body?.analysisContext ?? null
  })).digest("hex");
}

function reservationKey(requestId, visitor) {
  return createHash("sha256")
    .update(`${String(visitor?.scope ?? "anonymous")}\0${requestId}`)
    .digest("hex");
}

function pruneReservations(registry, now, ttlMs) {
  for (const [key, entry] of registry) {
    if (now - Number(entry.createdAt ?? 0) > ttlMs) registry.delete(key);
  }
}

export function createTransportRetryQuotaReservation({
  body = {},
  runtime,
  accessService,
  visitor,
  signal,
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  let reservedForHandler = false;
  if (!accessService?.config?.enabled || !visitor) {
    return async () => {};
  }

  const registry = runtime.transportRetryQuotaReservations
    ?? (runtime.transportRetryQuotaReservations = new Map());
  const timestamp = now();
  pruneReservations(registry, timestamp, ttlMs);
  const metadata = retryMetadata(body);
  const validRequestId = Boolean(metadata.requestId);
  const key = validRequestId ? reservationKey(metadata.requestId, visitor) : null;
  const fingerprint = requestFingerprint(body, visitor);
  let originalEntry = null;

  if (key && metadata.attempt === 0) {
    originalEntry = {
      createdAt: timestamp,
      fingerprint,
      disconnected: Boolean(signal?.aborted),
      retryClaimed: false,
      pending: null,
      reserved: false
    };
    registry.set(key, originalEntry);
    signal?.addEventListener?.("abort", () => {
      originalEntry.disconnected = true;
    }, { once: true });
  }

  return async () => {
    if (reservedForHandler) return;

    if (
      key
      && metadata.attempt === 1
      && metadata.retryOfRequestId === metadata.requestId
    ) {
      const candidate = registry.get(key);
      if (
        candidate
        && candidate.fingerprint === fingerprint
        && candidate.disconnected
        && !candidate.retryClaimed
      ) {
        candidate.retryClaimed = true;
        if (candidate.pending) {
          try {
            await candidate.pending;
          } catch {
            // If the original quota reservation failed, the retry must reserve normally.
          }
        }
        if (candidate.reserved) {
          reservedForHandler = true;
          return;
        }
      }
    }

    const pending = Promise.resolve().then(() => accessService.reserveLlmUse(visitor));
    if (originalEntry) originalEntry.pending = pending;
    try {
      await pending;
      if (originalEntry) originalEntry.reserved = true;
      reservedForHandler = true;
    } catch (error) {
      if (originalEntry && registry.get(key) === originalEntry) registry.delete(key);
      throw error;
    }
  };
}

export const TRANSPORT_RETRY_QUOTA_TTL_MS = DEFAULT_TTL_MS;
