import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MemoryCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntime,
  streamRecommendResponse
} from "../src/app/small-window-server.js";

const resultFixture = JSON.parse(readFileSync(
  new URL("./fixtures/conclusion-fixture.json", import.meta.url),
  "utf8"
));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return predicate();
}

function responseRecorder() {
  const chunks = [];
  return {
    chunks,
    response: {
      destroyed: false,
      writableEnded: false,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      write(value) {
        chunks.push(String(value));
        return true;
      },
      end() {
        this.writableEnded = true;
      }
    }
  };
}

function parsedEvents(chunks) {
  return chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("recommendation stream exposes structured stages before the final result", async () => {
  const retrievalGate = deferred();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    conclusionGeneratorConfig: { enabled: false, mode: "off" },
    recommendForInputImpl: async (_input, options) => {
      options.onProgress({
        type: "understanding.resolved",
        data: {
          conversation: {
            stateVersion: "conversation-state.v2",
            delta: {
              taskRelation: "new",
              explicitTaskFrame: {
                action: "recommend",
                goal: "unit_build_rankings",
                constraints: {}
              }
            },
            resolution: {
              decision: "execute",
              resolvedTaskFrame: {
                action: "recommend",
                goal: "unit_build_rankings",
                constraints: {}
              }
            }
          }
        }
      });
      options.onProgress({
        type: "plan.ready",
        data: {
          agent: {
            executionPlan: {
              steps: [{ id: "step-1", tool: "unit_builds", arguments: {} }]
            }
          }
        }
      });
      options.onProgress({
        type: "retrieval.started",
        data: { source: "fixture" }
      });
      await retrievalGate.promise;
      return structuredClone(resultFixture);
    }
  });
  const { response, chunks } = responseRecorder();

  const streamPromise = streamRecommendResponse(
    {},
    response,
    {
      input: "霞怎么出装？",
      conversationId: "progress-stream-test",
      deferConclusion: true,
      preferences: { conclusionMode: "off" }
    },
    runtime
  );

  assert.equal(await waitFor(() => chunks.join("").includes("\"phase\":\"retrieval.started\"")), true);
  const inFlightEvents = parsedEvents(chunks);
  assert.equal(inFlightEvents.some((event) => event.type === "complete"), false);
  assert.deepEqual(
    inFlightEvents.filter((event) => event.type === "progress").map((event) => event.event.phase),
    [
      "request.accepted",
      "understanding.started",
      "understanding.resolved",
      "plan.ready",
      "retrieval.started"
    ]
  );

  retrievalGate.resolve();
  await streamPromise;

  const events = parsedEvents(chunks);
  const progressEvents = events.filter((event) => event.type === "progress");
  assert.deepEqual(
    progressEvents.map((event) => event.event.sequence),
    progressEvents.map((_, index) => index + 1)
  );
  assert.deepEqual(
    progressEvents.map((event) => event.event.phase),
    [
      "request.accepted",
      "understanding.started",
      "understanding.resolved",
      "plan.ready",
      "retrieval.started",
      "retrieval.completed",
      "answer.started"
    ]
  );
  assert.equal(response.headers["content-type"], "application/x-ndjson; charset=utf-8");
  assert.equal(response.headers["x-accel-buffering"], "no");
  assert.equal(response.writableEnded, true);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).statusCode, 200);
  assert.equal(events.at(-1).payload.ok, true);
});

test("recommendation stream keeps validation errors inside the terminal event", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false
  });
  const { response, chunks } = responseRecorder();

  await streamRecommendResponse({}, response, { input: "   " }, runtime);

  const events = parsedEvents(chunks);
  assert.equal(events[0].type, "diagnostic");
  assert.equal(events[0].endpointMode, "recommend");
  assert.equal(events[1].type, "progress");
  assert.equal(events[1].event.phase, "request.accepted");
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).statusCode, 400);
  assert.equal(events.at(-1).payload.ok, false);
});
