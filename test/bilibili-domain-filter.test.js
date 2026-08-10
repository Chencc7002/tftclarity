import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStrategyVideoDomain,
  gateStrategyVideoRequest
} from "../services/bilibili/domain-filter.mjs";

test("video request gate defaults to TFT and supports Golden Spatula or explicit dual search", () => {
  const defaulted = gateStrategyVideoRequest("霞的最新阵容攻略");
  assert.equal(defaulted.requestedEcosystem, "tft_pc");
  assert.equal(defaulted.ecosystemSource, "default");
  assert.match(defaulted.searchPlans[0].effectiveQuery, /云顶之弈/u);

  const golden = gateStrategyVideoRequest("金铲铲之战 霞阵容攻略");
  assert.equal(golden.requestedEcosystem, "golden_spatula");
  assert.equal(golden.ecosystemSource, "explicit");
  assert.equal(golden.searchPlans.length, 1);

  const both = gateStrategyVideoRequest("云顶之弈和金铲铲分别找霞攻略");
  assert.equal(both.requestedEcosystem, "both");
  assert.deepEqual(both.searchPlans.map((plan) => plan.ecosystem), ["tft_pc", "golden_spatula"]);
});

test("video request gate blocks clearly unrelated content before calling MCP", () => {
  const result = gateStrategyVideoRequest("帮我找猫咪视频");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "non_strategy_video_request");
  assert.equal(gateStrategyVideoRequest("找峡谷霞对线视频").allowed, false);
  assert.equal(gateStrategyVideoRequest("找云顶之弈猫咪视频").allowed, false);
  assert.equal(gateStrategyVideoRequest("帮我找 Python 编程教学视频").allowed, false);
  assert.equal(gateStrategyVideoRequest("帮我找摄影教学视频").reason, "tft_strategy_signal_required");
});

test("domain classification separates ecosystems and rejects unrelated gameplay or highlights", () => {
  assert.equal(classifyStrategyVideoDomain({ title: "云顶之弈 霞阵容运营攻略" }, "霞攻略", "tft_pc").domainStatus, "confirmed");
  assert.equal(classifyStrategyVideoDomain({ title: "金铲铲之战 霞阵容运营攻略" }, "霞攻略", "golden_spatula").domainStatus, "confirmed");
  assert.equal(classifyStrategyVideoDomain({ title: "金铲铲之战 霞阵容攻略" }, "霞攻略", "tft_pc").reason, "wrong_ecosystem");
  assert.equal(classifyStrategyVideoDomain({ title: "云顶之弈和金铲铲 霞阵容对比" }, "霞攻略", "tft_pc").resultEcosystem, "cross_ecosystem");
  assert.equal(classifyStrategyVideoDomain({ title: "召唤师峡谷 霞对线教学" }, "霞攻略", "tft_pc").reason, "non_tft_gameplay");
  assert.equal(classifyStrategyVideoDomain({ title: "云顶之弈比赛高光集锦" }, "霞攻略", "tft_pc").reason, "non_strategy_content");
});
