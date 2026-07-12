import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  compStructuredFilterParams,
  createAppliedCompConstraint,
  createUnavailableCompConstraint,
  normalizeCompCandidateRows,
  selectStableCompCandidate
} from "../src/core/comp-filter.js";
import {
  planMetaTFTCompCandidates,
  planMetaTFTUnitBuilds
} from "../src/core/query-planner.js";
import {
  makeCompCandidateCacheKey,
  makeQueryCacheKey,
  MemoryCacheStore
} from "../src/data/cache-store.js";
import { recommendForInput } from "../src/core/recommendation-service.js";
import { createRecommendationFromRows } from "../src/core/recommendation-service.js";
import { createCatalog } from "../src/data/static-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await readFile(join(here, "fixtures", "comp-filter", "metatft-data-explorer-comp-contract.json"), "utf8"));
const buildRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [300, 250, 220, 180, 120, 90, 60, 30]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_RunaansHurricane",
    placement_count: [120, 110, 100, 90, 80, 70, 60, 50]
  }
];

function candidateResponse(overrides = {}) {
  return {
    data: [
      {
        units_traits: contract.comps.A.id,
        comp_name: "太空律动蛇",
        placement_count: contract.comps.A.placement_count
      },
      {
        units_traits: contract.comps.B.id,
        comp_name: "太空律动盾",
        placement_count: contract.comps.B.placement_count
      }
    ],
    filter_adjustment: { sample_size: contract.candidateQuery.response.filter_adjustment.sample_size },
    ...overrides
  };
}

function baseQuery(comp = null) {
  return {
    intent: "unit_build_rankings",
    unit: "TFT17_Xayah",
    starLevel: [2],
    itemCount: 3,
    traitFilters: [],
    ownedItems: [],
    excludedItems: [],
    itemPolicy: "ordinary_only",
    rankFilter: contract.common.rank.split(","),
    days: 3,
    patch: "current",
    queue: "1100",
    minSamples: 100,
    sort: "top4_first",
    comp
  };
}

test("captured Explorer contract identifies Comp as a units_traits variant and serializes sf AND filters", () => {
  assert.equal(contract.semantics.isClusterId, false);
  const materializeCapturedRequest = (id) => {
    const encoding = contract.finalRequestEncoding;
    const request = encoding.matrixRequests[id];
    return {
      endpoint: encoding.endpoint,
      params: {
        ...encoding.sharedParams,
        ...encoding.compParams[request.compProfile],
        ...request.overrides
      }
    };
  };
  const capturedNone = materializeCapturedRequest("A_none");
  const capturedA = materializeCapturedRequest("B_compA");
  const capturedB = materializeCapturedRequest("C_compB");
  const capturedDays = materializeCapturedRequest("D_compA_days1");
  const capturedRank = materializeCapturedRequest("E_compA_masterPlus");
  assert.equal(capturedNone.endpoint, contract.semantics.finalEndpoint);
  assert.equal(Object.keys(capturedNone.params).some((key) => key.startsWith("sf[")), false);
  assert.equal(capturedA.params["sf[0][and][18][trait]"], "TFT17_Stargazer_Serpent_1");
  assert.equal(capturedB.params["sf[0][and][18][trait]"], "TFT17_Stargazer_Shield_1");
  assert.equal(capturedDays.params.days, "1");
  assert.equal(capturedRank.params.rank, "CHALLENGER,GRANDMASTER,MASTER");
  const selected = selectStableCompCandidate(candidateResponse(), {
    unit: "TFT17_Xayah",
    minSamples: 100
  });
  assert.equal(selected.candidate.id, contract.comps.A.id);
  assert.equal(selected.candidate.sampleCount, contract.comps.A.sampleCount);

  const constraint = createAppliedCompConstraint(selected.candidate, { selection: "automatic" });
  const params = compStructuredFilterParams(constraint);
  assert.equal(params["sf[0][and][0][unit_unique]"], "TFT17_Aatrox-1");
  assert.equal(params["sf[0][and][8][unit_unique]"], "TFT17_Xayah-1");
  assert.equal(params["sf[0][and][18][trait]"], "TFT17_Stargazer_Serpent_1");

  const plan = planMetaTFTUnitBuilds(baseQuery(constraint));
  assert.equal(plan.params.trait, undefined);
  assert.equal(plan.params["sf[0][and][18][trait]"], "TFT17_Stargazer_Serpent_1");
  assert.equal(plan.params.permit_filter_adjustment, "true");
});

test("candidate and final requests share hero, days, rank, patch, and queue", () => {
  const query = baseQuery();
  const candidatePlan = planMetaTFTCompCandidates(query);
  const finalPlan = planMetaTFTUnitBuilds(query);
  assert.equal(candidatePlan.params.unit_unique, "TFT17_Xayah-1");
  for (const key of ["days", "rank", "patch", "queue", "permit_filter_adjustment"]) {
    assert.equal(candidatePlan.params[key], finalPlan.params[key]);
  }
});

test("no stable Comp produces comp=none with no sf or trait fallback and isolated cache keys", () => {
  const low = candidateResponse({
    data: [
      { units_traits: contract.comps.A.id, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  });
  const selected = selectStableCompCandidate(low, { unit: "TFT17_Xayah", minSamples: 100 });
  assert.equal(selected.candidate, null);
  const unavailable = createUnavailableCompConstraint({ stabilityThreshold: 100 });
  const noCompPlan = planMetaTFTUnitBuilds(baseQuery(unavailable));
  assert.equal(noCompPlan.params.trait, undefined);
  assert.equal(Object.keys(noCompPlan.params).some((key) => key.startsWith("sf[")), false);

  const applied = createAppliedCompConstraint(normalizeCompCandidateRows(candidateResponse(), {
    unit: "TFT17_Xayah"
  })[0]);
  assert.notEqual(makeQueryCacheKey(baseQuery(applied)), makeQueryCacheKey(baseQuery(unavailable)));
});

test("automatic Comp selection is a real preflight request and the highest stable sample reaches unit_builds", async () => {
  const calls = [];
  const result = await recommendForInput("大师以上霞什么三件装备最强？", {
    useSession: false,
    preferences: { minSamples: 100 },
    metaTFTClient: {
      async getCompCandidates(plan) {
        calls.push({ type: "candidates", plan });
        return candidateResponse();
      },
      async getUnitBuilds(plan) {
        calls.push({ type: "final", plan });
        return { data: buildRows };
      }
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.query.comp.status, "applied");
  assert.equal(result.query.comp.value.selection, "automatic");
  assert.equal(result.query.comp.value.id, contract.comps.A.id);
  assert.equal(calls.length, 2);
  for (const key of ["days", "rank", "patch", "queue"]) {
    assert.deepEqual(calls[0].plan.params[key], calls[1].plan.params[key]);
  }
  assert.equal(calls[1].plan.params.trait, undefined);
  assert.equal(calls[1].plan.params["sf[0][and][18][trait]"], "TFT17_Stargazer_Serpent_1");
});

test("automatic Comp miss executes the final query without Comp and states the unrestricted scope", async () => {
  let finalPlan;
  const result = await recommendForInput("霞什么三件装备最强？", {
    useSession: false,
    preferences: { minSamples: 100 },
    metaTFTClient: {
      async getCompCandidates() {
        return {
          data: [{ units_traits: contract.comps.A.id, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
        };
      },
      async getUnitBuilds(plan) {
        finalPlan = plan;
        return { data: buildRows };
      }
    }
  });
  assert.equal(result.query.comp.status, "not_available");
  assert.equal(result.query.comp.value, null);
  assert.equal(finalPlan.params.trait, undefined);
  assert.equal(Object.keys(finalPlan.params).some((key) => key.startsWith("sf[")), false);
  assert.match(result.text, /当前条件下未找到达到稳定门槛的 Comp；以下结果未限制 Comp/);
});

test("an explicit named Comp is inherited across a days follow-up while final stats are re-queried", async () => {
  const cacheStore = new MemoryCacheStore();
  const candidatePlans = [];
  const finalPlans = [];
  const client = {
    async getCompCandidates(plan) {
      candidatePlans.push(plan);
      return candidateResponse();
    },
    async getUnitBuilds(plan) {
      finalPlans.push(plan);
      return { data: buildRows };
    }
  };

  const first = await recommendForInput("霞在太空律动蛇阵容里什么装备最强？", {
    cacheStore,
    metaTFTClient: client,
    preferences: { minSamples: 100 }
  });
  const second = await recommendForInput("近一天呢？", {
    cacheStore,
    metaTFTClient: client,
    preferences: { minSamples: 100 }
  });

  assert.equal(first.query.comp.value.selection, "explicit");
  assert.equal(first.query.comp.source, "current_input");
  assert.equal(second.query.comp.value.id, first.query.comp.value.id);
  assert.equal(second.query.comp.source, "conversation");
  assert.equal(second.query.days, 1);
  assert.equal(candidatePlans.length, 1);
  assert.equal(finalPlans.length, 2);
  assert.equal(finalPlans[0].params.days, "3");
  assert.equal(finalPlans[1].params.days, "1");
  assert.equal(finalPlans[1].params["sf[0][and][18][trait]"], "TFT17_Stargazer_Serpent_1");
});

test("Comp candidate cache keys change for every sample-scope dimension", () => {
  const common = {
    unit: "TFT17_Xayah",
    days: 3,
    rankFilter: ["MASTER"],
    patch: "current",
    queue: "1100",
    minSamples: 100,
    semanticsVersion: contract.semantics.version
  };
  const base = makeCompCandidateCacheKey(common);
  for (const change of [
    { unit: "TFT17_Nunu" },
    { days: 1 },
    { rankFilter: ["CHALLENGER"] },
    { patch: "17.7" },
    { queue: "PBE" }
  ]) {
    assert.notEqual(makeCompCandidateCacheKey({ ...common, ...change }), base);
  }
});

test("automatic Comp is fetched again when hero, days, rank, patch, or queue changes", async () => {
  const cacheStore = new MemoryCacheStore();
  const catalog = createCatalog({
    units: [
      { apiName: "TFT17_Xayah", zhName: "霞", aliases: ["霞", "xayah"] },
      { apiName: "TFT17_Nunu", zhName: "努努", aliases: ["努努", "nunu"] }
    ]
  });
  const candidatePlans = [];
  const finalPlans = [];
  const client = {
    async getCompCandidates(plan) {
      candidatePlans.push(plan);
      const unit = plan.params.unit_unique.replace(/-1$/, "");
      return {
        data: [{
          units_traits: `TFT17_Aatrox&${unit}|TFT17_Stargazer_1`,
          comp_name: `scope-${unit}`,
          placement_count: [20, 20, 20, 20, 20, 20, 20, 20]
        }]
      };
    },
    async getUnitBuilds(plan) {
      finalPlans.push(plan);
      const unit = plan.endpoint.split("/").at(-1);
      return {
        data: [{
          unit_builds: `${unit}&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane`,
          placement_count: [30, 25, 20, 15, 10, 8, 6, 4]
        }]
      };
    }
  };
  const common = {
    minSamples: 100,
    days: 3,
    rankFilter: ["MASTER"],
    patch: "current",
    queue: "1100"
  };
  const runs = [
    ["霞什么三件装备最强？", common],
    ["霞什么三件装备最强？", { ...common, days: 1 }],
    ["霞什么三件装备最强？", { ...common, rankFilter: ["CHALLENGER"] }],
    ["霞什么三件装备最强？", { ...common, patch: "17.7" }],
    ["霞什么三件装备最强？", { ...common, queue: "PBE" }],
    ["努努什么三件装备最强？", common]
  ];

  for (const [input, preferences] of runs) {
    const result = await recommendForInput(input, {
      useSession: false,
      cacheStore,
      catalog,
      metaTFTClient: client,
      preferences
    });
    assert.equal(result.query.comp?.status, "applied", `${input}:${JSON.stringify(preferences)}:${JSON.stringify(result.validation)}`);
    assert.equal(result.query.comp.value.selection, "automatic");
  }

  assert.equal(candidatePlans.length, runs.length);
  assert.equal(finalPlans.length, runs.length);
  assert.deepEqual(candidatePlans.map((plan) => ({
    unit: plan.params.unit_unique,
    days: plan.params.days,
    rank: plan.params.rank,
    patch: plan.params.patch,
    queue: plan.params.queue
  })), [
    { unit: "TFT17_Xayah-1", days: "3", rank: "MASTER", patch: "current", queue: "1100" },
    { unit: "TFT17_Xayah-1", days: "1", rank: "MASTER", patch: "current", queue: "1100" },
    { unit: "TFT17_Xayah-1", days: "3", rank: "CHALLENGER", patch: "current", queue: "1100" },
    { unit: "TFT17_Xayah-1", days: "3", rank: "MASTER", patch: "17.7", queue: "1100" },
    { unit: "TFT17_Xayah-1", days: "3", rank: "MASTER", patch: "current", queue: "PBE" },
    { unit: "TFT17_Nunu-1", days: "3", rank: "MASTER", patch: "current", queue: "1100" }
  ]);
});

test("a no-Comp result is not inherited and the next scope can select a fresh automatic Comp", async () => {
  const cacheStore = new MemoryCacheStore();
  let candidateCalls = 0;
  const client = {
    async getCompCandidates() {
      candidateCalls += 1;
      return {
        data: [{
          units_traits: contract.comps.A.id,
          comp_name: "观星霞",
          placement_count: candidateCalls === 1
            ? [1, 1, 1, 1, 1, 1, 1, 1]
            : [20, 20, 20, 20, 20, 20, 20, 20]
        }]
      };
    },
    async getUnitBuilds() {
      return { data: buildRows };
    }
  };

  const first = await recommendForInput("霞什么三件装备最强？", {
    cacheStore,
    metaTFTClient: client,
    preferences: { minSamples: 100 }
  });
  const second = await recommendForInput("近一天呢？", {
    cacheStore,
    metaTFTClient: client,
    preferences: { minSamples: 100 }
  });

  assert.equal(first.query.comp.status, "not_available");
  assert.equal(second.query.days, 1);
  assert.equal(second.query.comp.status, "applied");
  assert.equal(second.query.comp.value.selection, "automatic");
  assert.equal(candidateCalls, 2);
});

test("build ranking, single-item, completion, and comparison work with applied and unrestricted Comp scopes", () => {
  const candidate = normalizeCompCandidateRows(candidateResponse(), { unit: "TFT17_Xayah" })[0];
  const scopes = [
    createAppliedCompConstraint(candidate, { selection: "explicit" }),
    createUnavailableCompConstraint({ stabilityThreshold: 100 })
  ];
  const cases = [
    ["霞什么三件装备最强？", "unit_build_rankings"],
    ["霞哪个单件装备表现最好？", "unit_item_rankings"],
    ["霞已经有羊刀，剩下两件怎么带？", "unit_build_completion"],
    ["霞的羊刀和无尽哪个更好？", "unit_item_comparison"]
  ];

  for (const comp of scopes) {
    for (const [input, intent] of cases) {
      const result = createRecommendationFromRows(input, buildRows, { comp });
      assert.equal(result.validation.valid, true, `${intent}:${comp.status}`);
      assert.equal(result.type, intent, `${intent}:${comp.status}`);
      assert.equal(result.query.comp.status, comp.status);
      const hasStructuredComp = Object.keys(result.plan.params).some((key) => key.startsWith("sf["));
      assert.equal(hasStructuredComp, comp.status === "applied");
      assert.equal(result.plan.params.trait, undefined);
    }
  }
});
