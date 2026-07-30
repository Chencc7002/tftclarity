import assert from "node:assert/strict";
import test from "node:test";

import {
  TFT_CAPABILITY_REGISTRY,
  createSystemInteractionResult,
  createSystemInteractionRouter,
  routeSystemInteraction,
  validateSystemInteractionResult
} from "../src/index.js";

test("SystemInteractionRouter handles greeting deterministically", () => {
  for (const input of ["你好", "您好！", "hi", "hello", "在吗", "早上好", "晚上好"]) {
    const result = routeSystemInteraction({ input });
    assert.equal(result.handled, true, input);
    assert.equal(result.interactionType, "greeting", input);
    assert.equal(result.answerMode, "system_help", input);
    assert.equal(result.showEvidencePanel, false, input);
    assert.match(result.answer, /TFT 数据分析与攻略助手/u);
    assert.equal(validateSystemInteractionResult(result).valid, true);
  }
});

test("capability help is rendered only from the real Capability Registry", () => {
  const result = routeSystemInteraction({ input: "你能做什么" });
  assert.equal(result.interactionType, "capability_help");
  for (const capability of TFT_CAPABILITY_REGISTRY.capabilities) {
    assert.ok(result.answer.includes(capability), capability);
  }
  for (const rule of TFT_CAPABILITY_REGISTRY.authorityRules) {
    assert.ok(result.answer.includes(rule), rule);
  }
  assert.doesNotMatch(result.answer, /实时对局控制|代练|自动下棋/u);
});

test("usage help lists only registry-backed working examples", () => {
  const result = routeSystemInteraction({ input: "怎么使用" });
  assert.equal(result.interactionType, "usage_help");
  assert.deepEqual(
    result.answer.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2)),
    TFT_CAPABILITY_REGISTRY.usageExamples
  );
});

test("TFT questions and greeting-prefixed TFT questions pass through", () => {
  assert.deepEqual(
    routeSystemInteraction({ input: "霞最好的装备是什么" }),
    { handled: false }
  );
  assert.deepEqual(
    routeSystemInteraction({ input: "你好，霞最好的装备是什么" }),
    { handled: false }
  );
});

test("obvious non-TFT requests use the deterministic out-of-domain response", () => {
  for (const input of ["帮我写论文", "今天天气怎么样", "讲一个故事"]) {
    const result = routeSystemInteraction({ input });
    assert.equal(result.interactionType, "out_of_domain", input);
    assert.equal(result.showEvidencePanel, false, input);
    assert.match(result.answer, /主要提供 TFT 数据查询和攻略分析/u);
  }
});

test("SystemInteractionRouter supports registered handlers without server conditionals", () => {
  const router = createSystemInteractionRouter({
    handlers: [{
      interactionType: "greeting",
      matches: ({ input }) => input === "ping",
      handle: () => createSystemInteractionResult({
        interactionType: "greeting",
        answer: "pong"
      })
    }]
  });
  assert.equal(router.route({ input: "ping" }).answer, "pong");
  assert.deepEqual(router.route({ input: "other" }), { handled: false });
});
