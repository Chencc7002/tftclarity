import assert from "node:assert/strict";
import test from "node:test";

import {
  createCatalog,
  generateEvidenceBackedConclusion,
  parseQuery
} from "../src/index.js";
import { UNIT_ALIAS_OVERRIDES } from "../src/data/domain-alias-overrides.js";

const baseCatalog = createCatalog();
const syntheticSpecialItems = ["artifact", "radiant", "emblem"].flatMap((category) => (
  Array.from({ length: 3 }, (_, index) => ({
    apiName: `TFT_Test_${category}_${index + 1}`,
    zhName: `测试${category}${index + 1}`,
    shortName: `测试${category}${index + 1}`,
    aliases: [],
    category,
    current: true
  }))
));
const catalog = createCatalog({
  units: UNIT_ALIAS_OVERRIDES.map((unit, index) => ({
    ...unit,
    cost: (index % 5) + 1,
    current: true
  })),
  traits: baseCatalog.traits,
  items: [...baseCatalog.items, ...syntheticSpecialItems]
});

function categoryItems(category) {
  return catalog.items.filter((item) => item.category === category).slice(0, 3);
}

function rankingResult(unit, category) {
  const intent = category === "emblem" ? "unit_emblem_rankings" : "unit_item_rankings";
  const items = categoryItems(category);
  return {
    type: intent,
    parsed: {
      intent,
      unit: unit.apiName,
      confidence: 1,
      parser: { entityMatches: [] }
    },
    query: {
      intent,
      unit: unit.apiName,
      starLevel: [Number(unit.cost) <= 3 ? 3 : 2],
      itemPolicy: category === "artifact"
        ? "include_artifact"
        : category === "radiant"
          ? "include_radiant"
          : "include_special",
      itemCategories: [category],
      lockedItems: [],
      excludedItems: [],
      comparisonItems: [],
      rankFilter: ["CHALLENGER", "DIAMOND"],
      days: 3,
      minSamples: 0,
      sort: "top4_first",
      assumptions: []
    },
    validation: { valid: true, errors: [], warnings: [] },
    clarification: { needsClarification: false, blocking: false },
    itemRankings: items.map((item, index) => ({
      apiName: item.apiName,
      stats: {
        games: [900, 1200, 700][index],
        avgPlacement: [3.72, 3.88, 4.06][index],
        top4Rate: [0.64, 0.61, 0.57][index],
        winRate: [0.19, 0.17, 0.13][index]
      },
      coverage: [0.06, 0.08, 0.04][index]
    })),
    itemRankingMethodology: {
      methodology: category === "emblem"
        ? "presence_once_per_complete_build"
        : "special_item_outlier_cleaned_avg_placement_only",
      totalGames: 2800,
      completeBuildCount: 3,
      coverageReliable: true,
      sampleFloor: { outlierFloor: 14, relativeRatio: 0.02 }
    },
    source: { provider: "MetaTFT", cache: "live", updatedAt: new Date().toISOString() },
    cache: { query: { hit: false } }
  };
}

function validProviderOutput(evidence) {
  const contract = evidence.questionContract;
  const rankingDimension = contract.requiredAnswerDimensions.find((dimension) => (
    dimension === "item_performance_ranking" || dimension === "emblem_performance_ranking"
  ));
  const reliabilityDimension = "metric_reliability";
  const directIds = evidence.itemRankingContext.directAnalysisEvidenceIds;
  return {
    schemaVersion: "llm_conclusion.v2",
    contractId: contract.contractId,
    status: "ok",
    addressedDimensions: [...contract.requiredAnswerDimensions],
    missingDimensions: [],
    missingEvidence: [],
    headline: "当前排行已有可验证的代表候选",
    summary: "榜首候选与最高样本候选已按当前查询口径进行比较。",
    reasons: [
      {
        dimension: rankingDimension,
        evidenceIds: directIds,
        text: "榜首候选与最高样本候选的完整表现记录支持当前排行判断。"
      },
      {
        dimension: reliabilityDimension,
        evidenceIds: [directIds.at(-1)],
        text: "最高样本候选提供了可复核的可靠性参考。"
      }
    ],
    alternatives: [],
    nextAction: "结合当前可获得的装备，在榜首与高样本候选中选择。",
    riskNotice: null
  };
}

test("every catalog hero can build a validated conclusion for artifact, radiant, and emblem rankings", async () => {
  assert.ok(catalog.units.length >= 50, `expected full hero catalog, got ${catalog.units.length}`);
  for (const category of ["artifact", "radiant", "emblem"]) {
    assert.equal(categoryItems(category).length, 3, `missing ${category} catalog fixtures`);
  }

  for (const unit of catalog.units) {
    for (const category of ["artifact", "radiant", "emblem"]) {
      const categoryInputs = {
        artifact: [
          `${unit.zhName}神器排行`,
          `推荐${unit.zhName}神器`,
          `${unit.zhName}神器推荐`
        ],
        radiant: [
          `${unit.zhName}光明装备排行`,
          `推荐${unit.zhName}光明装备`,
          `${unit.zhName}光明装推荐`
        ],
        emblem: [
          `${unit.zhName}哪个转职好`,
          `推荐${unit.zhName}转职`,
          `${unit.zhName}转职排行`
        ]
      }[category];
      for (const input of categoryInputs) {
        const parsed = parseQuery(input, { catalog });
        assert.equal(parsed.unit, unit.apiName, `${unit.apiName}/${category}/${input}: parser unit`);
        assert.equal(
          parsed.intent,
          category === "emblem" ? "unit_emblem_rankings" : "unit_item_rankings",
          `${unit.apiName}/${category}/${input}: parser intent`
        );
        assert.ok(parsed.itemCategories.includes(category), `${unit.apiName}/${category}/${input}: parser category`);
      }

      const conclusion = await generateEvidenceBackedConclusion({
        result: rankingResult(unit, category),
        catalog,
        input: categoryInputs[0],
        config: { enabled: true, model: "matrix-provider", maxCorrections: 0 },
        provider: async ({ evidence }) => validProviderOutput(evidence)
      });
      assert.equal(
        conclusion.status,
        "generated",
        `${unit.apiName}/${category}: ${conclusion.reason ?? conclusion.error ?? "unknown"}`
      );
    }
  }
});
