const TRANSPORT_ERROR_PATTERN = /(?:load failed|failed to fetch|fetch failed|network\s*error|network request failed|err_connection_closed|connection closed|the network connection was lost|stream ended before completion)/iu;

export function streamIncompleteError() {
  const error = new Error("recommendation stream ended before completion");
  error.code = "stream_incomplete";
  return error;
}

export function isRetryableStreamTransportError(error) {
  if (!error || error.name === "AbortError") return false;
  return error.code === "stream_incomplete"
    || TRANSPORT_ERROR_PATTERN.test(String(error.message ?? error));
}

export function shouldRetryStreamTransport({ error, attempt = 0, signal } = {}) {
  return attempt < 1
    && !signal?.aborted
    && isRetryableStreamTransportError(error);
}

export const STREAM_TRANSPORT_MAX_RETRIES = 1;
