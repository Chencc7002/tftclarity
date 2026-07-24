import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRuntime,
  STRUCTURED_OPERATION_REGISTRY,
  ToolExecutor,
  ToolRegistry,
  createStructuredToolDefinitions
} from "../src/agent/index.js";

function definition(overrides = {}) {
  return {
    schemaVersion: "agent_tool.v1",
    name: "test_tool",
    description: "Used in tests. Not for external network calls. Input: value. Returns a test value.",
    source: "test",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "integer" } }
    },
    outputSchema: null,
    readOnly: true,
    riskLevel: "low",
    timeoutMs: 100,
    idempotent: true,
    cacheable: false,
    execute: async ({ value }) => ({ value }),
    ...overrides
  };
}

test("ToolRegistry registers, queries and rejects duplicate names", () => {
  const registry = new ToolRegistry();
  registry.register(definition());
  assert.equal(registry.get("test_tool").name, "test_tool");
  assert.deepEqual(registry.list().map((entry) => entry.name), ["test_tool"]);
  assert.throws(() => registry.register(definition()), (error) => error.code === "tool_already_registered");
  assert.throws(() => new ToolRegistry([definition({
    name: "unsafe_schema",
    inputSchema: { type: "object", additionalProperties: true }
  })]), (error) => error.code === "invalid_tool_definition");
  assert.throws(() => new ToolRegistry([definition({
    name: "missing_declaration",
    readOnly: undefined
  })]), (error) => error.code === "invalid_tool_definition");
});

test("ToolExecutor rejects missing tools, source mismatches, unknown fields and invalid types before handlers", async () => {
  let calls = 0;
  const registry = new ToolRegistry([definition({
    execute: async ({ value }) => {
      calls += 1;
      return { value };
    }
  })]);
  const executor = new ToolExecutor({ registry });

  await assert.rejects(() => executor.execute("missing", {}, {}), (error) => error.code === "tool_not_registered");
  await assert.rejects(() => executor.execute("test_tool", { value: 1 }, { source: "wrong" }), (error) => error.code === "tool_source_mismatch");
  await assert.rejects(() => executor.execute("test_tool", { value: 1, extra: true }, { source: "test" }), (error) => error.code === "invalid_tool_input");
  await assert.rejects(() => executor.execute("test_tool", { value: "1" }, { source: "test" }), (error) => error.code === "invalid_tool_input");
  assert.equal(calls, 0);
});

test("ToolExecutor returns a versioned result and emits run-linked tool events", async () => {
  const registry = new ToolRegistry([definition()]);
  const executor = new ToolExecutor({ registry, createId: () => "tool-call-1" });
  const runtime = new AgentRuntime({ createId: () => "run-1" });
  const execution = await runtime.run({}, async (context) => executor.execute("test_tool", { value: 7 }, {
    source: "test",
    run: context
  }));

  assert.equal(execution.value.schemaVersion, "agent_tool_result.v1");
  assert.equal(execution.value.toolCallId, "tool-call-1");
  assert.equal(execution.value.status, "completed");
  assert.deepEqual(execution.value.value, { value: 7 });
  const toolEvents = execution.run.events.filter((event) => event.type.startsWith("tool_call_"));
  assert.equal(toolEvents.length, 2);
  assert.ok(toolEvents.every((event) => event.runId === "run-1" && event.data.toolCallId === "tool-call-1"));
});

test("ToolExecutor normalizes timeout, cancellation and sensitive errors", async () => {
  const timeoutExecutor = new ToolExecutor({
    registry: new ToolRegistry([definition({
      timeoutMs: 10,
      execute: async () => new Promise(() => {})
    })])
  });
  await assert.rejects(() => timeoutExecutor.execute("test_tool", { value: 1 }, { source: "test" }), (error) => {
    assert.equal(error.code, "tool_timed_out");
    assert.equal(error.toolResult.status, "timed_out");
    return true;
  });

  const controller = new AbortController();
  const cancelExecutor = new ToolExecutor({
    registry: new ToolRegistry([definition({
      execute: async () => new Promise(() => {})
    })])
  });
  const cancelled = cancelExecutor.execute("test_tool", { value: 1 }, { source: "test", signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error) => error.code === "tool_cancelled" && error.toolResult.status === "cancelled");

  const sensitiveExecutor = new ToolExecutor({
    registry: new ToolRegistry([definition({
      execute: async () => {
        throw Object.assign(new Error("Authorization: Bearer super-secret key=abcdef"), { recoverable: false });
      }
    })])
  });
  await assert.rejects(() => sensitiveExecutor.execute("test_tool", { value: 1 }, { source: "test" }), (error) => {
    assert.doesNotMatch(JSON.stringify(error.toolResult), /super-secret|abcdef/u);
    return error.code === "tool_failed";
  });
});

test("ToolExecutor retries only recoverable idempotent failures within the run budget", async () => {
  let attempts = 0;
  const executor = new ToolExecutor({
    registry: new ToolRegistry([definition({
      execute: async ({ value }) => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("temporary"), { recoverable: true });
        return { value };
      }
    })])
  });
  const result = await executor.execute("test_tool", { value: 2 }, { source: "test", maxRetriesPerTool: 1 });
  assert.equal(result.attempts, 2);
  assert.equal(attempts, 2);

  let nonIdempotentAttempts = 0;
  const noRetryExecutor = new ToolExecutor({
    registry: new ToolRegistry([definition({
      idempotent: false,
      execute: async () => {
        nonIdempotentAttempts += 1;
        throw Object.assign(new Error("temporary"), { recoverable: true });
      }
    })])
  });
  await assert.rejects(() => noRetryExecutor.execute("test_tool", { value: 2 }, {
    source: "test",
    maxRetriesPerTool: 3
  }), (error) => error.code === "tool_failed");
  assert.equal(nonIdempotentAttempts, 1);
});

test("structured tool definitions derive from the existing operation allowlist without drift", () => {
  const definitions = createStructuredToolDefinitions();
  assert.deepEqual(
    definitions.map((entry) => entry.name).sort(),
    Object.keys(STRUCTURED_OPERATION_REGISTRY).sort()
  );
  assert.ok(definitions.every((entry) => entry.readOnly && entry.idempotent));
});
