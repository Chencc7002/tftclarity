import test from "node:test";
import assert from "node:assert/strict";
import { ChatAgent } from "../src/chat/chat-agent.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { ToolExecutor } from "../src/agent/tools/executor.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { currentDeadlineEvidence } from "../src/react/deadline-evidence.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const call = (tool, args) => ({ schemaVersion: "react-action.v1", type: "call_tool", tool, arguments: args, purposeCode: "retrieve_current_statistics" });
function fixture({ slowTool = false, enabled = true, evidence = true } = {}) {
  const blocked = deferred(), release = deferred(), events = [];
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  let decisions = 0, calls = 0, signal;
  const agent = new ChatAgent({ registry, toolExecutor: new ToolExecutor({ registry }),
    budget: { deadlineMs: 100 }, deadlineRecovery: enabled,
    decisionProvider: async (_request, context) => {
      decisions++;
      if (decisions === 1 && evidence) return call("comps_rankings", {});
      if (slowTool) return call("comps_rankings", { mention: "source identity" });
      signal = context.signal; blocked.resolve();
      return release.promise;
    },
    handlers: { comps_rankings: async (_input, context) => {
      calls++;
      if (calls > 1) { signal = context.signal; blocked.resolve(); return release.promise; }
      return { type: "composition_rankings", source: { updatedAt: new Date().toISOString() },
        query: { seasonContextId: "set18-live", patch: "current" }, results: [{ name: "source composition" }] };
    } }
  });
  return { agent, blocked, release, events, get signal() { return signal; }, get decisions() { return decisions; }, get calls() { return calls; } };
}

for (const slowTool of [false, true]) test(`deadline preserves validated evidence and fences late ${slowTool ? "tool" : "model"} completion`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = fixture({ slowTool });
  const pending = f.agent.chat({ input: "查询阵容", seasonContextId: "set18-live" }, { onEvent: e => f.events.push(e) });
  await f.blocked.promise;
  t.mock.timers.tick(100);
  const result = await pending;
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.run.status, "timed_out");
  assert.equal(result.run.budget.deadlineMs, 100);
  assert.equal(result.terminationReason, "deadline_exceeded");
  assert.equal(result.evidenceIds.length, 1);
  assert.equal(result.modelConclusion, null);
  assert.match(result.answer, /超时.*部分结果/);
  assert.ok(f.signal.aborted);
  assert.equal(f.events.filter(e => e.type === "termination").length, 1);
  const snapshot = JSON.stringify(result), eventCount = f.events.length, decisions = f.decisions;
  f.release.resolve(slowTool ? { results: [{ invented: "late" }], updatedAt: new Date().toISOString() }
    : call("comps_rankings", { mention: "late action" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(result), snapshot);
  assert.equal(f.events.length, eventCount);
  assert.equal(f.decisions, decisions);
  assert.equal(f.calls, slowTool ? 2 : 1);
});

test("deadline without evidence retains the timeout error; disabled mode stays legacy", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  for (const options of [{ evidence: false }, { enabled: false }]) {
    const f = fixture(options);
    const pending = f.agent.chat({ input: "查询阵容", seasonContextId: "set18-live" }, { onEvent: e => f.events.push(e) });
    const rejected = assert.rejects(pending, error => error.code === "run_timed_out" && error.publicRun.status === "timed_out");
    await f.blocked.promise;
    t.mock.timers.tick(100);
    await rejected;
    assert.ok(!f.events.some(e => e.type === "answer"));
  }
});

test("user cancellation never becomes a partial success", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = fixture(), controller = new AbortController();
  const pending = f.agent.chat({ input: "查询阵容", seasonContextId: "set18-live" }, { signal: controller.signal, onEvent: e => f.events.push(e) });
  const rejected = assert.rejects(pending, error => error.code === "run_cancelled");
  await f.blocked.promise;
  controller.abort();
  await rejected;
  assert.ok(f.signal.aborted);
  assert.ok(!f.events.some(e => e.type === "answer"));
  f.release.resolve(call("comps_rankings", { mention: "late" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls, 1);
});

test("partial presentation excludes historical, expired, wrong-season and invalid source clocks", () => {
  const now = Date.now(), entry = { validatedAt: new Date(now).toISOString(), updatedAt: now,
    metadata: { updatedAt: now }, value: { query: { seasonContextId: "set18-live" }, source: { updatedAt: now } } };
  assert.equal(currentDeadlineEvidence([entry], now, "set18-live").length, 1);
  for (const change of [
    e => { e.temporalStatus = "historical"; }, e => { e.metadata.stale = true; },
    e => { e.value.query.seasonContextId = "set17-live"; }, e => { e.validatedAt = null; },
    e => { e.value.source.updatedAt = now + 1; }, e => { e.value.source.updatedAt = now - 31 * 60 * 1000; },
    e => { e.updatedAt = "invalid"; }, e => { e.value.cache = { expiresAt: now }; },
    e => { e.value.formation = { source: { updatedAt: now - 6 * 60 * 1000 } }; }
  ]) { const bad = structuredClone(entry); change(bad); assert.equal(currentDeadlineEvidence([bad], now, "set18-live").length, 0); }
});
