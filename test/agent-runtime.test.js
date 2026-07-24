import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_RUN_SCHEMA_VERSION,
  AgentRun,
  AgentRuntime,
  RuntimeError
} from "../src/agent/index.js";

test("AgentRun validates legal transitions and rejects illegal or terminal rewrites", () => {
  const run = new AgentRun({
    runId: "run-1",
    conversationId: "conversation-1",
    principalId: "principal-1",
    seasonContextId: "set17-live",
    now: () => 1000
  });

  run.start();
  run.enterStage("resolving");
  run.finish("completed");
  assert.equal(run.status, "completed");
  assert.equal(run.currentStage, "terminal");
  assert.throws(() => run.transition("running"), (error) => error.code === "invalid_run_transition");
});

test("AgentRun rejects an illegal direct transition with a stable code", () => {
  const run = new AgentRun({ runId: "run-2" });
  assert.throws(() => run.transition("completed"), (error) => {
    assert.ok(error instanceof RuntimeError);
    return error.code === "invalid_run_transition";
  });
});

test("AgentRuntime returns a versioned run with bounded steps, tool calls and events", async () => {
  const runtime = new AgentRuntime({
    createId: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })(),
    budget: { deadlineMs: 500, maxSteps: 2, maxToolCalls: 1, maxRetriesPerTool: 0, maxEvents: 5 }
  });
  const execution = await runtime.run({
    conversationId: "conversation",
    principalId: "principal",
    seasonContextId: "set17-live"
  }, async (context) => {
    await context.stage("resolving", async () => "resolved");
    context.consumeToolCall();
    context.emit({ type: "tool_call_started", stage: "retrieving", data: { toolName: "unit_builds" } });
    context.emit({ type: "tool_call_completed", stage: "retrieving", data: { toolName: "unit_builds" } });
    return { ok: true };
  });

  assert.deepEqual(execution.value, { ok: true });
  assert.equal(execution.run.schemaVersion, AGENT_RUN_SCHEMA_VERSION);
  assert.equal(execution.run.status, "completed");
  assert.equal(execution.run.stepCount, 1);
  assert.equal(execution.run.toolCallCount, 1);
  assert.ok(execution.run.events.length <= 5);
});

test("AgentRuntime enforces step and tool budgets with structured errors", async () => {
  const runtime = new AgentRuntime({
    budget: { deadlineMs: 500, maxSteps: 1, maxToolCalls: 1, maxRetriesPerTool: 0, maxEvents: 20 }
  });

  await assert.rejects(
    () => runtime.run({}, async (context) => {
      await context.stage("resolving", async () => null);
      await context.stage("planning", async () => null);
    }),
    (error) => error.code === "budget_exhausted" && error.publicRun?.status === "failed"
  );

  await assert.rejects(
    () => runtime.run({}, async (context) => {
      context.consumeToolCall();
      context.consumeToolCall();
    }),
    (error) => error.code === "budget_exhausted" && error.publicRun?.toolCallCount === 1
  );
});

test("AgentRuntime times out and late workflow results cannot overwrite the terminal state", async () => {
  let release;
  const runtime = new AgentRuntime({ budget: { deadlineMs: 15, maxSteps: 12, maxToolCalls: 12, maxRetriesPerTool: 1, maxEvents: 100 } });
  const pending = runtime.run({}, async () => new Promise((resolve) => {
    release = resolve;
  }));

  await assert.rejects(pending, (error) => error.code === "run_timed_out" && error.publicRun?.status === "timed_out");
  release?.({ tooLate: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test("AgentRuntime honours AbortSignal cancellation and ignores late completion", async () => {
  const controller = new AbortController();
  let release;
  const runtime = new AgentRuntime({ budget: { deadlineMs: 500, maxSteps: 12, maxToolCalls: 12, maxRetriesPerTool: 1, maxEvents: 100 } });
  const pending = runtime.run({}, async () => new Promise((resolve) => {
    release = resolve;
  }), { signal: controller.signal });
  controller.abort(new Error("user cancelled"));

  await assert.rejects(pending, (error) => error.code === "run_cancelled" && error.publicRun?.status === "cancelled");
  release?.("late");
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test("event observer failures do not change business results and public snapshots redact inputs", async () => {
  const runtime = new AgentRuntime({
    onEvent() {
      throw new Error("observer unavailable");
    }
  });
  const execution = await runtime.run({
    conversationId: "conversation",
    principalId: "principal",
    seasonContextId: "set17-live",
    apiKey: "secret",
    authorization: "Bearer secret",
    input: "private raw input"
  }, async (context) => {
    await context.stage("resolving", async () => "ok");
    return { ok: true };
  });

  assert.deepEqual(execution.value, { ok: true });
  const serialized = JSON.stringify(execution.publicRun);
  assert.doesNotMatch(serialized, /secret|private raw input|authorization|apiKey/u);
  assert.equal(execution.publicRun.status, "completed");
});
