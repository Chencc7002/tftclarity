import assert from "node:assert/strict";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createSmallWindowRuntimeAsync, handleReactChatRequest } from "../src/app/small-window-server.js";

// Real registered production retrieval with an injected repeated decision.
// This deterministically exercises partial completion without requiring an LLM
// to fail or changing the configuration of the serving application.
loadLocalEnvironment();
const runtime = await createSmallWindowRuntimeAsync({ conversationBridgeMode: "off", agentSkillsShadowV1: false });
let decisions = 0;
runtime.reactDecisionProvider = async () => {
  decisions += 1;
  assert.ok(decisions <= 2, "Duplicate decision must stop without another tool call");
  return { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_rankings",
    arguments: { limit: 1 }, purposeCode: "retrieve_current_statistics" };
};
const events = [];
const result = await handleReactChatRequest({ input: "查询当前阵容前四率，并说明还缺少哪些信息。", locale: "zh-CN",
  seasonContextId: "set18-live", conversationId: `partial-evidence-smoke-${Date.now()}` }, runtime,
{ onProgress: (event) => events.push(event) });
assert.equal(result.statusCode, 200);
const payload = result.payload;
assert.equal(payload.terminationReason, "duplicate_call");
assert.equal(payload.answerOrigin, "system_evidence_fallback");
const entry = payload.evidence.find((entry) => entry.toolName === "comps_rankings");
assert.ok(entry?.value?.results?.length);
const row = entry.value.results[0];
assert.ok(payload.answer.includes(row.compositionRef.name));
assert.ok(payload.answer.includes(`样本 ${row.stats.games}`));
assert.ok(payload.answer.includes(`前四率 ${(row.stats.top4Rate * 100).toFixed(1)}%`));
assert.ok(payload.answer.indexOf(row.compositionRef.name) < payload.answer.indexOf("还缺什么"));
assert.doesNotMatch(payload.answer, /已取得部分有效证据/u);
assert.equal(events.filter((event) => event.type === "tool_started").length, 1);
console.log(JSON.stringify({ check: "partial-evidence-real-retrieval", passed: true,
  termination: payload.terminationReason, decisions, answer: payload.answer,
  evidenceIds: payload.evidenceIds, tool: entry.toolName, source: entry.source }));
process.exit(0);
