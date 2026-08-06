import test from "node:test";
import assert from "node:assert/strict";

import {
  createTaskFrame,
  resolvedTaskFrameToParsed
} from "../src/index.js";

test("resolved composition tasks preserve non-reroll and low-contest preferences", () => {
  const parsed = resolvedTaskFrameToParsed(createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      reroll: false,
      contested: "low",
      sort: "robust_first",
      limit: 3
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  }), {
    presentation: { requestedCount: 3 },
    taskRelation: "new",
    dialogueAct: "start_task",
    input: "推荐三套稳定、没那么卷的非赌狗阵容"
  });

  assert.equal(parsed.intent, "comp_rankings");
  assert.equal(parsed.preferenceRequested, true);
  assert.deepEqual(parsed.preferenceConditions, {
    strategy: null,
    reroll: false,
    goal: null,
    contested: "low",
    difficulty: null,
    beginnerFriendly: null,
    count: 3,
    returnAll: false
  });
  assert.equal(parsed.sort, "robust_first");
});

test("resolved ordinal composition targets become focused comp queries", () => {
  const parsed = resolvedTaskFrameToParsed(createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      comp: {
        rawText: "result 2",
        expectedType: "composition",
        resolvedId: "comp-b",
        confidence: 1
      },
      avoidItemComponents: [{
        rawText: "大剑",
        expectedType: "item",
        resolvedId: "TFT_Item_BFSword",
        confidence: 1
      }]
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  }), {
    presentation: {
      resultReference: { scope: "last_result", ordinal: 2 }
    },
    taskRelation: "modify",
    dialogueAct: "modify"
  });

  assert.equal(parsed.compId, "comp-b");
  assert.deepEqual(parsed.avoidItemComponents, ["TFT_Item_BFSword"]);
});

test("explicit popular and trend wording overrides generic model ranking defaults", () => {
  const genericFrame = createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      metrics: ["top4_rate", "win_share"],
      limit: 5
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });

  const popular = resolvedTaskFrameToParsed(genericFrame, {
    input: "推荐当前版本热门阵容"
  });
  assert.equal(popular.intent, "comp_rankings");
  assert.equal(popular.popularRequested, true);
  assert.equal(popular.limit, 21);

  const trend = resolvedTaskFrameToParsed(genericFrame, {
    input: "当前版本阵容趋势"
  });
  assert.equal(trend.intent, "comp_trends");
  assert.equal(trend.trendRequested, true);
  assert.equal(trend.popularRequested, false);

  const trendWithAnalysisPlan = resolvedTaskFrameToParsed(createTaskFrame({
    action: "analyze",
    goal: "comp_trends",
    confidence: 1,
    understandingStatus: "understood_and_supported"
  }), {
    input: "当前版本阵容趋势",
    executionPlan: { steps: [{ tool: "comps_analysis" }] }
  });
  assert.equal(trendWithAnalysisPlan.intent, "comp_trends");
});

test("explicit single-item ranking wording overrides the shared unit-builds plan", () => {
  const genericUnitRankingFrame = createTaskFrame({
    action: "rank",
    goal: "unit_build_rankings",
    subjects: [{
      rawText: "霞",
      expectedType: "champion",
      resolvedId: "TFT17_Xayah",
      confidence: 1
    }],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const executionPlan = { steps: [{ tool: "unit_builds" }] };

  for (const input of [
    "霞单装备排行",
    "霞的单件装备排名",
    "霞核心装备优先级",
    "霞哪个单件装备表现最好",
    "霞神器排行",
    "霞的光明装备哪个最好"
  ]) {
    const parsed = resolvedTaskFrameToParsed(genericUnitRankingFrame, {
      input,
      executionPlan
    });
    assert.equal(parsed.intent, "unit_item_rankings", input);
    assert.equal(parsed.unit, "TFT17_Xayah", input);
  }

  for (const input of ["霞三件装备排行", "霞出装排行"]) {
    const parsed = resolvedTaskFrameToParsed(genericUnitRankingFrame, {
      input,
      executionPlan
    });
    assert.equal(parsed.intent, "unit_build_rankings", input);
  }
});
