import test from "node:test";
import assert from "node:assert/strict";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

test("semantic parser produces compositional task semantics for item comparison", async () => {
  const parsed = await parseSemanticTask("霞的炼刀和巨九选哪个？", {
    dynamicContext: { version: "17.7", currentTime: "2026-07-23T12:00:00+08:00" }
  });

  assert.equal(parsed.taskFrame.schemaVersion, "task-frame.v1");
  assert.equal(parsed.taskFrame.domain, "tft");
  assert.equal(parsed.taskFrame.action, "compare");
  assert.equal(parsed.taskFrame.goal, "choose_best");
  assert.deepEqual(parsed.taskFrame.subjects.map((entity) => entity.rawText), ["霞"]);
  assert.deepEqual(parsed.taskFrame.candidates.map((entity) => entity.rawText), ["炼刀", "巨九"]);
  assert.equal(parsed.taskFrame.understandingStatus, "understood_and_supported");
  assert.ok(parsed.telemetry.usage.cachedInputTokens > 0);
  assert.ok(parsed.telemetry.usage.uncachedInputTokens > 0);
  assert.ok(parsed.telemetry.usage.outputTokens > 0);
  assert.ok(parsed.telemetry.usage.cachedInputTokens + parsed.telemetry.usage.uncachedInputTokens <= parsed.telemetry.budget.maxInputTokens);
});

test("semantic parser separates understanding from support and domain status", async () => {
  const video = await parseSemanticTask("帮我找个当前版本霞的攻略视频");
  assert.equal(video.taskFrame.action, "find_video");
  assert.equal(video.taskFrame.understandingStatus, "understood_but_unsupported");

  const concept = await parseSemanticTask("九五到底是啥意思？");
  assert.equal(concept.taskFrame.action, "explain");
  assert.equal(concept.taskFrame.understandingStatus, "understood_but_unsupported");

  const mail = await parseSemanticTask("帮我写一封请假邮件");
  assert.equal(mail.taskFrame.domain, "out_of_domain");
  assert.equal(mail.taskFrame.action, "unknown");
  assert.equal(mail.taskFrame.understandingStatus, "out_of_domain");
});

test("semantic parser preserves stable prefix order and appends dynamic state last", async () => {
  const parsed = await parseSemanticTask("霞怎么出装？", {
    dynamicContext: { version: "17.7", userState: { locale: "zh-CN" } }
  });
  assert.deepEqual(parsed.messages.map((message) => message.name), [
    "fixed_rules",
    "core_tool_index",
    "retrieved_examples",
    "dynamic_context"
  ]);
  assert.equal(JSON.parse(parsed.messages.at(-1).content).version, "17.7");
});

test("semantic parser enforces output token and latency budgets", async () => {
  await assert.rejects(
    () => parseSemanticTask("霞怎么出装？", { budget: { maxOutputTokens: 1 } }),
    /token budget exceeded/u
  );

  await assert.rejects(
    () => parseSemanticTask("霞怎么出装？", {
      budget: { maxLatencyMs: 5 },
      provider: () => new Promise((resolve) => setTimeout(resolve, 30))
    }),
    (error) => error.code === "semantic_parser_timeout"
  );
});
