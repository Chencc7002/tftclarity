import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyCompPreferenceSearch,
  createCatalog,
  MemoryCacheStore,
  parseCompPreferenceConditions,
  parseQuery,
  recommendForInput,
  validateCompPreferenceConditions,
  validateStructuredParserOutput
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

const PAGE_FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

function comp(id, options = {}) {
  return {
    compId: `cluster:${id}`,
    name: options.name ?? id,
    pageOrder: options.pageOrder ?? 0,
    strategy: options.strategy ?? "fast9",
    profile: options.profile === undefined ? {
      difficulty: 2,
      beginnerFriendly: true,
      pivotDifficulty: 2,
      positionDifficulty: 2,
      contestTolerance: 4,
      econDifficulty: 2,
      notes: []
    } : options.profile,
    stats: {
      games: options.games ?? 1000,
      top4Rate: options.top4Rate ?? 0.6,
      winRate: options.winRate ?? 0.15,
      avgPlacement: options.avgPlacement ?? 4,
      selectionRate: options.selectionRate ?? 0.3,
      pickRate: (options.selectionRate ?? 0.3) / 8
    },
    source: { clusterId: id }
  };
}

function result(candidates, minSamples = 100) {
  return {
    type: "comp_rankings",
    query: { intent: "comp_rankings", minSamples, seasonContextId: "set17-live" },
    candidates,
    rankings: { top4Rate: candidates, winRate: [], winShare: [], avgPlacement: [], popularity: [] },
    references: [],
    warnings: []
  };
}

function structuredPreference(overrides = {}) {
  return {
    intent: "comp_rankings",
    entities: { unit_mentions: [], item_mentions: [], trait_mentions: [] },
    constraints: {
      star_level: [], item_count: null, item_policy: null, locked_items: [],
      comparison_items: [], comparison_mode: null, primary_metric: null,
      excluded_items: [], min_samples: null, sort: null, rank_filter: [],
      days: null, patch: null, queue: null, metrics: [], limit: null,
      strategy: "fast9", reroll: null, goal: "top4", contested: "low",
      difficulty: "low", beginner_friendly: true, count: 3,
      ...overrides
    },
    needs_clarification: false,
    clarification_question: null
  };
}

test("base natural-language comp preferences map to the strict protocol", () => {
  const cases = [
    ["我想玩95", { strategy: "fast9" }],
    ["我想玩赌狗", { strategy: "reroll", reroll: true }],
    ["我不喜欢赌狗", { reroll: false }],
    ["我想稳定上分", { goal: "top4" }],
    ["我想吃鸡", { goal: "top1" }],
    ["不想卷", { contested: "low" }],
    ["简单一点", { difficulty: "low" }],
    ["适合新手", { beginnerFriendly: true }],
    ["推荐3套", { count: 3 }]
  ];
  for (const [input, expected] of cases) {
    const parsed = parseCompPreferenceConditions(input);
    assert.equal(parsed.requested, true, input);
    for (const [key, value] of Object.entries(expected)) assert.equal(parsed.conditions[key], value, input);
  }
});

test("combined conditions merge without dropping count, negation, or goal", () => {
  assert.deepEqual(parseCompPreferenceConditions("推荐3套不卷、适合新手的95阵容").conditions, {
    strategy: "fast9",
    reroll: null,
    goal: null,
    contested: "low",
    difficulty: null,
    beginnerFriendly: true,
    count: 3
  });
  assert.deepEqual(parseCompPreferenceConditions("我不想赌狗，只想稳定上分").conditions, {
    strategy: null,
    reroll: false,
    goal: "top4",
    contested: null,
    difficulty: null,
    beginnerFriendly: null,
    count: 3
  });
  assert.deepEqual(parseCompPreferenceConditions("给我两套吃鸡上限高但不要太难的阵容").conditions, {
    strategy: null,
    reroll: null,
    goal: "top1",
    contested: null,
    difficulty: "low",
    beginnerFriendly: null,
    count: 2
  });
  assert.equal(parseCompPreferenceConditions("推荐11套不卷阵容").conditions.count, 10);
  assert.equal(parseCompPreferenceConditions("推荐0套不卷阵容").conditions.count, 1);
});

test("protocol rejects unknown fields and contradictory reroll conditions", () => {
  assert.throws(() => validateCompPreferenceConditions({ selectedCompIds: ["cluster:a"] }), (error) => (
    error.code === "invalid_comp_preference_conditions" && error.field === "selectedCompIds"
  ));
  assert.throws(() => validateCompPreferenceConditions({ strategy: "reroll", reroll: false }), (error) => (
    error.field === "reroll"
  ));
});

test("deterministic filtering applies strategy, Profile, contest evidence, reliability sorting, and count", () => {
  const searched = applyCompPreferenceSearch(result([
    comp("a", { top4Rate: 0.62, games: 1200, pageOrder: 0 }),
    comp("b", { top4Rate: 0.70, games: 110, pageOrder: 1 }),
    comp("c", { strategy: "reroll", top4Rate: 0.8, games: 2000 }),
    comp("d", { selectionRate: 0.9, top4Rate: 0.75, games: 1500 }),
    comp("e", { profile: { difficulty: 5, beginnerFriendly: false, contestTolerance: 1 }, games: 1600 })
  ]), {
    conditions: {
      strategy: "fast9", reroll: null, goal: "top4", contested: "low",
      difficulty: "low", beginnerFriendly: true, count: 2
    }
  });
  assert.equal(searched.preferenceSearch.status, "ok");
  assert.equal(searched.preferenceSearch.returnedCount, 2);
  assert.equal(searched.preferenceSearch.ranking.performedBy, "deterministic_code");
  assert.deepEqual(searched.rankings.top4Rate.map((entry) => entry.compId), ["cluster:b", "cluster:a"]);
  assert.ok(searched.rankings.top4Rate.every((entry) => entry.preferenceMatch.conditions.count === 2));
  assert.ok(searched.rankings.top4Rate[0].preferenceMatch.ranking.reliability
    < searched.rankings.top4Rate[1].preferenceMatch.ranking.reliability);
  assert.ok(searched.preferenceSearch.excluded.strategy_mismatch >= 1);
  assert.ok(searched.preferenceSearch.excluded.contested_mismatch >= 1);
});

test("missing Profile, low samples, and true zero results are explicit and never promoted", () => {
  const missingProfile = applyCompPreferenceSearch(result([comp("missing", { profile: null })]), {
    conditions: { beginnerFriendly: true, count: 3 }
  });
  assert.equal(missingProfile.preferenceSearch.status, "insufficient_profile");
  assert.equal(missingProfile.preferenceSearch.returnedCount, 0);
  assert.match(missingProfile.warnings.join("\n"), /缺少已验证的人工 Profile/);

  const lowSample = applyCompPreferenceSearch(result([comp("low", { games: 40 })], 100), {
    conditions: { strategy: "fast9", count: 3 }
  });
  assert.equal(lowSample.preferenceSearch.status, "low_sample_only");
  assert.equal(lowSample.preferenceSearch.returnedCount, 0);
  assert.equal(lowSample.references.length, 1);
  assert.equal(Object.values(lowSample.rankings).flat().length, 0);

  const zero = applyCompPreferenceSearch(result([comp("reroll", { strategy: "reroll" })]), {
    conditions: { strategy: "fast9", count: 3 }
  });
  assert.equal(zero.preferenceSearch.status, "zero_results");
  assert.equal(zero.preferenceSearch.returnedCount, 0);
  assert.match(zero.warnings.at(-1), /没有同时满足/);
});

test("explicit null Profile and metric values remain missing evidence", () => {
  const missingDifficulty = applyCompPreferenceSearch(result([comp("profile-null", {
    profile: {
      difficulty: null,
      beginnerFriendly: null,
      contestTolerance: null
    }
  })]), {
    conditions: { difficulty: "low", count: 3 }
  });
  assert.equal(missingDifficulty.preferenceSearch.status, "insufficient_profile");
  assert.equal(missingDifficulty.preferenceSearch.returnedCount, 0);

  const missingContest = applyCompPreferenceSearch(result([comp("contest-null", {
    profile: {
      difficulty: 2,
      beginnerFriendly: true,
      contestTolerance: null
    },
    selectionRate: null
  })]), {
    conditions: { contested: "low", count: 3 }
  });
  assert.equal(missingContest.preferenceSearch.status, "insufficient_evidence");
  assert.equal(missingContest.preferenceSearch.returnedCount, 0);

  const metricNullComp = comp("metric-null", { games: 40 });
  metricNullComp.stats.top4Rate = null;
  const missingMetric = applyCompPreferenceSearch(result([metricNullComp], 100), {
    conditions: { strategy: "fast9", goal: "top4", count: 3 }
  });
  assert.equal(missingMetric.preferenceSearch.status, "insufficient_evidence");
  assert.equal(missingMetric.preferenceSearch.lowSampleMatches, 0);
  assert.equal(missingMetric.references.length, 0);
  assert.equal(missingMetric.preferenceSearch.excluded.missing_goal_metrics, 1);
});

test("structured LLM output can express preferences but cannot return decisions", () => {
  const valid = validateStructuredParserOutput(structuredPreference());
  assert.equal(valid.valid, true, valid.errors.join("; "));
  assert.deepEqual({
    strategy: valid.value.constraints.strategy,
    goal: valid.value.constraints.goal,
    count: valid.value.constraints.count
  }, { strategy: "fast9", goal: "top4", count: 3 });

  const bypass = structuredPreference();
  bypass.constraints.selected_comp_ids = ["cluster:a"];
  const rejected = validateStructuredParserOutput(bypass);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => error.includes("selected_comp_ids is not supported")));
});

test("end-to-end LLM conditions remain structured and deterministic count wins over model output", async () => {
  const parsed = parseQuery("推荐2套不卷、适合新手的95阵容", { catalog: createCatalog() });
  assert.equal(parsed.intent, "comp_rankings");
  assert.equal(parsed.preferenceRequested, true);
  assert.equal(parsed.preferenceConditions.count, 2);

  const enrich = (entry) => ({
    ...entry,
    strategy: "fast9",
    profile: {
      difficulty: 2,
      beginnerFriendly: true,
      pivotDifficulty: 2,
      positionDifficulty: 2,
      contestTolerance: 5,
      econDifficulty: 2,
      notes: []
    }
  });
  const response = await recommendForInput("推荐2套不卷、适合新手的95阵容", {
    catalog: createCatalog(),
    compResponse: PAGE_FIXTURE,
    useSession: false,
    useStructuredParser: "always",
    structuredParser: async () => structuredPreference({ count: 5 }),
    preferences: { minSamples: 0, days: 3, patch: "current", queue: "1100", rankFilter: [] },
    compEnrichmentService: {
      async enrichRankingResult(value) {
        return {
          ...value,
          candidates: value.candidates.map(enrich),
          rankings: Object.fromEntries(Object.entries(value.rankings).map(([key, entries]) => [key, entries.map(enrich)])),
          references: value.references.map(enrich)
        };
      }
    }
  });
  assert.equal(response.parsed.parser.structuredParser.valid, true);
  assert.equal(response.query.preferenceConditions.count, 2);
  assert.equal(response.preferenceSearch.requestedCount, 2);
  assert.ok(response.preferenceSearch.returnedCount <= 2);
  assert.equal(response.preferenceSearch.ranking.performedBy, "deterministic_code");
});

test("HTTP response exposes the protocol and only serialized deterministic recommendations", async () => {
  const enrich = (entry) => ({
    ...entry,
    strategy: "fast9",
    profile: {
      difficulty: 2,
      beginnerFriendly: true,
      pivotDifficulty: 2,
      positionDifficulty: 2,
      contestTolerance: 5,
      econDifficulty: 2,
      notes: []
    }
  });
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: null,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {
      getCompsData: async () => PAGE_FIXTURE.compsData,
      getCompsStats: async () => PAGE_FIXTURE.compsStats
    },
    compEnrichmentService: {
      async enrichRankingResult(value) {
        return {
          ...value,
          candidates: value.candidates.map(enrich),
          rankings: Object.fromEntries(Object.entries(value.rankings).map(([key, entries]) => [key, entries.map(enrich)])),
          references: value.references.map(enrich)
        };
      }
    }
  });
  const { statusCode, payload } = await handleRecommendRequest({
    input: "推荐2套不卷、适合新手的95阵容",
    preferences: { minSamples: 0 }
  }, runtime);
  const recommendations = Object.values(payload.rankings).flat();
  assert.equal(statusCode, 200);
  assert.equal(payload.type, "comp_rankings");
  assert.equal(payload.preferenceSearch.requestedCount, 2);
  assert.equal(payload.preferenceSearch.ranking.performedBy, "deterministic_code");
  assert.equal(recommendations.length, 2, JSON.stringify({
    query: payload.query,
    preferenceSearch: payload.preferenceSearch,
    warnings: payload.warnings,
    rankings: payload.rankings
  }, null, 2));
  assert.ok(recommendations.every((entry) => entry.preferenceMatch.conditions.strategy === "fast9"));
  assert.equal(payload.answer.methodology.includes("确定性代码"), true);
  assert.equal("candidates" in payload, false);
  assert.equal(JSON.stringify(payload).includes("placement_count"), false);
});

test("a fresh ordinary comp request clears previous natural-language conditions", async () => {
  const cacheStore = new MemoryCacheStore();
  const enrich = (entry) => ({
    ...entry,
    strategy: "fast9",
    profile: {
      difficulty: 2,
      beginnerFriendly: true,
      pivotDifficulty: 2,
      positionDifficulty: 2,
      contestTolerance: 5,
      econDifficulty: 2,
      notes: []
    }
  });
  const options = {
    catalog: createCatalog(),
    cacheStore,
    compResponse: PAGE_FIXTURE,
    preferences: { minSamples: 0, days: 3, patch: "current", queue: "1100", rankFilter: [] },
    compEnrichmentService: {
      async enrichRankingResult(value) {
        return {
          ...value,
          candidates: value.candidates.map(enrich),
          rankings: Object.fromEntries(Object.entries(value.rankings).map(([key, entries]) => [key, entries.map(enrich)])),
          references: value.references.map(enrich)
        };
      }
    }
  };
  const preferred = await recommendForInput("推荐2套不卷的95阵容", options);
  assert.equal(preferred.query.preferenceRequested, true);

  const ordinary = await recommendForInput("当前最热门阵容", options);
  assert.equal(ordinary.query.preferenceRequested, false);
  assert.equal(ordinary.query.preferenceConditions, null);
  assert.equal(ordinary.query.popularRequested, true);
});
