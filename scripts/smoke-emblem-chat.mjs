import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createSmallWindowRuntimeAsync, handleReactChatRequest } from "../src/app/small-window-server.js";

loadLocalEnvironment();
const runtime = await createSmallWindowRuntimeAsync({ reactEmblemRankings: true, reactGroundingMode: "strict",
  conversationBridgeMode: "off", agentSkillsShadowV1: false });
assert.equal(typeof runtime.reactDecisionProvider, "function", "A configured live ReAct provider is required");
const directory = ".cache/emblem-integration-20260907";
await mkdir(directory, { recursive: true });
const results = [];
const messages = [];
async function run(input, verify) {
  const events = [];
  const startedAt = Date.now();
  const result = await handleReactChatRequest({ input, messages: [...messages], locale: "zh-CN",
    seasonContextId: "set18-live", conversationId: "emblem-chat-live" }, runtime,
  { onProgress: event => events.push(event) });
  results.push({ input, durationMs: Date.now() - startedAt, result, events });
  await writeFile(`${directory}/react-live.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ input, statusCode: result.statusCode, termination: result.payload.terminationReason,
    tools: result.payload.evidence?.map(entry => entry.toolName), answer: result.payload.answer }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.terminationReason, "completed");
  verify(result.payload);
  messages.push({ role: "user", content: input }, { role: "assistant", content: result.payload.answer });
  return result.payload;
}
const first = await run("我有金锅锅，按平均名次给我排前三个能合成的转职。请比较样本数和前四率，说明数据局限。", payload => {
  const evidence = payload.evidence.find(entry => entry.toolName === "emblem_rankings");
  assert.ok(evidence);
  assert.equal(evidence.value.query.recipeBase, "pan");
  assert.ok(evidence.value.rows.length >= 2);
  assert.ok(evidence.value.rows.every(row => row.recipeBase === "pan"));
});
const rows = first.evidence.find(entry => entry.toolName === "emblem_rankings").value.rows;
await run(`只比较${rows[0].item.name}和${rows[1].item.name}，前四率差多少个百分点？不要把相关性说成合成收益。`, payload => {
  const evidence = payload.evidence.find(entry => entry.toolName === "emblem_rankings" && entry.value.analysis.comparisons.length);
  assert.ok(evidence, "Comparison must use current server-calculated differences");
});
await run(`${rows[0].item.name}最常见的携带英雄是谁？按携带样本数说，不需要装备效果解释。`, payload => {
  assert.ok(payload.evidence.some(entry => entry.toolName === "emblem_carriers" && entry.value.carriers?.length));
});
console.log("Live emblem chat checks passed: 3/3");
