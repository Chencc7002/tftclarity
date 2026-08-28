import assert from "node:assert/strict";
import test from "node:test";

import { createTransportRetryQuotaReservation } from "../src/access/transport-retry-quota.js";
import {
  isRetryableStreamTransportError,
  shouldRetryStreamTransport,
  streamIncompleteError
} from "../src/app/small-window-ui/stream-transport-retry.js";

test("stream retry policy retries one transport interruption but never user aborts or application errors", () => {
  assert.equal(isRetryableStreamTransportError(new TypeError("Load failed")), true);
  assert.equal(isRetryableStreamTransportError(new TypeError("network error")), true);
  assert.equal(isRetryableStreamTransportError(streamIncompleteError()), true);
  assert.equal(shouldRetryStreamTransport({ error: new TypeError("Failed to fetch"), attempt: 0 }), true);
  assert.equal(shouldRetryStreamTransport({ error: new TypeError("Failed to fetch"), attempt: 1 }), false);
  assert.equal(shouldRetryStreamTransport({ error: new Error("missing_required_evidence"), attempt: 0 }), false);
  const aborted = new Error("stopped");
  aborted.name = "AbortError";
  assert.equal(shouldRetryStreamTransport({ error: aborted, attempt: 0 }), false);
});

test("a disconnected request can reuse its quota reservation for exactly one transport retry", async () => {
  const runtime = {};
  const visitor = { scope: "retry-user" };
  let reservations = 0;
  const accessService = {
    config: { enabled: true },
    reserveLlmUse(receivedVisitor) {
      assert.equal(receivedVisitor, visitor);
      reservations += 1;
    }
  };
  const originalController = new AbortController();
  const originalBody = {
    input: "沃里克怎么玩？",
    requestId: "transport-request-1",
    conversationId: "conversation-1",
    seasonContextId: "set18-live",
    transportRetry: { attempt: 0, retryOfRequestId: null }
  };
  const reserveOriginal = createTransportRetryQuotaReservation({
    body: originalBody,
    runtime,
    accessService,
    visitor,
    signal: originalController.signal
  });
  await reserveOriginal();
  assert.equal(reservations, 1);
  originalController.abort();

  const retryBody = {
    ...originalBody,
    transportRetry: { attempt: 1, retryOfRequestId: originalBody.requestId }
  };
  const reserveRetry = createTransportRetryQuotaReservation({
    body: retryBody,
    runtime,
    accessService,
    visitor
  });
  await reserveRetry();
  await reserveRetry();
  assert.equal(reservations, 1);

  const reserveSecondRetry = createTransportRetryQuotaReservation({
    body: retryBody,
    runtime,
    accessService,
    visitor
  });
  await reserveSecondRetry();
  assert.equal(reservations, 2);
});

test("transport retry quota reuse is rejected when the request payload changes", async () => {
  const runtime = {};
  const visitor = { scope: "retry-user" };
  let reservations = 0;
  const accessService = {
    config: { enabled: true },
    reserveLlmUse() {
      reservations += 1;
    }
  };
  const controller = new AbortController();
  const reserveOriginal = createTransportRetryQuotaReservation({
    body: { input: "查询 A", requestId: "request-2", transportRetry: { attempt: 0 } },
    runtime,
    accessService,
    visitor,
    signal: controller.signal
  });
  await reserveOriginal();
  controller.abort();
  const reserveChangedRetry = createTransportRetryQuotaReservation({
    body: {
      input: "查询 B",
      requestId: "request-2",
      transportRetry: { attempt: 1, retryOfRequestId: "request-2" }
    },
    runtime,
    accessService,
    visitor
  });
  await reserveChangedRetry();
  assert.equal(reservations, 2);
});
