import assert from "node:assert/strict";
import test from "node:test";

import {
  COMP_PROFILE_DEFAULTS,
  COMP_STRATEGY_ALGORITHM_VERSION,
  LINEUP_SIGNATURE_VERSION,
  CompEnrichmentService,
  MemoryCacheStore,
  SQLiteCacheStore,
  assembleEvidencePack,
  createCatalog,
  createLineupSignature,
  deriveCompStrategy,
  normalizeCompProfileRecord,
  validateCompProfile
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleAdminCompProfileSave
} from "../src/app/small-window-server.js";

function comp(clusterId, options = {}) {
  return {
    compId: `cluster:${clusterId}`,
    name: options.name ?? `阵容 ${clusterId}`,
    source: { clusterId },
    units: options.units ?? [
      { apiName: "TFT17_A", core: true },
      { apiName: "TFT17_B", core: true },
      { apiName: "TFT17_C" },
      { apiName: "TFT17_D" },
      { apiName: "TFT17_E" },
      { apiName: "TFT17_F" },
      { apiName: "TFT17_G" },
      { apiName: "TFT17_H" }
    ],
    traits: options.traits ?? [{ filterId: "TFT17_TraitA_4", tier: 2 }],
    rollTiming: options.rollTiming
  };
}

function validProfile(overrides = {}) {
  return {
    difficulty: 3,
    beginnerFriendly: true,
    pivotDifficulty: 2,
    positionDifficulty: 4,
    contestTolerance: 2,
    econDifficulty: 3,
    notes: ["需要保留转型牌"],
    ...overrides
  };
}

function rankingResult(comps) {
  return {
    query: { seasonContextId: "set17-live" },
    rankings: { top4Rate: comps },
    rising: [],
    falling: [],
    improving: [],
    references: []
  };
}

async function nodeSQLite() {
  try {
    return await import("node:sqlite");
  } catch {
    return null;
  }
}

test("Comp Profile accepts exactly seven validated fields and applies documented defaults", () => {
  assert.deepEqual(validateCompProfile({}), COMP_PROFILE_DEFAULTS);
  assert.deepEqual(validateCompProfile(validProfile()), validProfile());
  assert.throws(() => validateCompProfile({ difficulty: 0 }), (error) => error.code === "invalid_comp_profile" && error.field === "difficulty");
  assert.throws(() => validateCompProfile({ beginnerFriendly: "yes" }), (error) => error.field === "beginnerFriendly");
  assert.throws(() => validateCompProfile({ notes: Array(21).fill("x") }), (error) => error.field === "notes");
  assert.throws(() => validateCompProfile({ strategy: "fast9" }), (error) => error.field === "strategy");
  assert.throws(() => normalizeCompProfileRecord({
    profileKey: "profile-one",
    profile: validProfile(),
    arbitraryField: true
  }), (error) => error.field === "arbitraryField");
});

test("lineup signatures are order independent, versioned, and react to core lineup drift", () => {
  const first = createLineupSignature(comp("one"));
  const reordered = createLineupSignature({
    ...comp("two"),
    units: [...comp("two").units].reverse(),
    traits: [...comp("two").traits].reverse()
  });
  const drifted = createLineupSignature(comp("three", {
    units: [{ apiName: "TFT17_A", core: true }, { apiName: "TFT17_Z", core: true }]
  }));
  assert.equal(first.version, LINEUP_SIGNATURE_VERSION);
  assert.equal(first.value, reordered.value);
  assert.notEqual(first.value, drifted.value);
});

test("strategy derivation only emits reroll, fast8, or fast9 with reasons and confidence", () => {
  const reroll = deriveCompStrategy(comp("reroll", {
    units: [{ apiName: "TFT17_A", core: true, targetStarLevel: 3 }]
  }));
  const fast8 = deriveCompStrategy(comp("fast8"));
  const fast9 = deriveCompStrategy(comp("fast9", {
    units: Array.from({ length: 9 }, (_, index) => ({ apiName: `TFT17_${index}`, core: true }))
  }));
  assert.deepEqual([reroll.strategy, fast8.strategy, fast9.strategy], ["reroll", "fast8", "fast9"]);
  for (const result of [reroll, fast8, fast9]) {
    assert.equal(result.algorithmVersion, COMP_STRATEGY_ALGORITHM_VERSION);
    assert.ok(result.reason.length > 0);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test("database profile overlay is immediate and isolated by SeasonContext", async () => {
  const store = new MemoryCacheStore();
  const service = new CompEnrichmentService({
    cacheStore: store,
    seedData: {
      profiles: [{ seasonContextId: "set17-live", profileKey: "seed-profile", ...validProfile({ difficulty: 2 }), enabled: true, source: "seed" }],
      bindings: []
    }
  });
  assert.equal((await service.effectiveProfiles("set17-live")).get("seed-profile").difficulty, 2);
  await service.saveProfile({ seasonContextId: "set17-live", profileKey: "seed-profile", profile: validProfile({ difficulty: 5 }) });
  await service.saveProfile({ seasonContextId: "set18-live", profileKey: "seed-profile", profile: validProfile({ difficulty: 1 }) });
  assert.equal((await service.effectiveProfiles("set17-live")).get("seed-profile").difficulty, 5);
  assert.equal((await service.effectiveProfiles("set18-live")).get("seed-profile").difficulty, 1);
  assert.equal((await service.effectiveProfiles("set17-live")).size, 1);
});

test("admin Profile writes reject undefined root fields before persistence or audit", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    catalog: createCatalog()
  });
  await assert.rejects(() => handleAdminCompProfileSave({
    seasonContextId: "set17-live",
    profileKey: "profile-one",
    profile: validProfile(),
    strategy: "fast9"
  }, runtime), (error) => (
    error.code === "invalid_comp_profile"
    && error.field === "strategy"
    && error.statusCode === 400
  ));
  assert.equal(runtime.cacheStore.listCompProfiles({ seasonContextId: "set17-live" }).length, 0);
  assert.equal(runtime.cacheStore.listAdminAudits({ seasonContextId: "set17-live" }).length, 0);
});

test("only a verified exact binding applies a Profile; drift and low confidence require review", async () => {
  const store = new MemoryCacheStore();
  const service = new CompEnrichmentService({ cacheStore: store, seedData: { profiles: [], bindings: [] } });
  await service.saveProfile({ seasonContextId: "set17-live", profileKey: "profile-one", profile: validProfile() });
  const current = comp("cluster-a");
  const signature = createLineupSignature(current);
  await service.bindProfile({
    seasonContextId: "set17-live",
    profileKey: "profile-one",
    provider: "metatft-live",
    clusterId: "cluster-a",
    lineupSignature: signature,
    matchConfidence: 1,
    matchStatus: "verified"
  });
  const matched = await service.enrichComp(current, { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.equal(matched.profileBinding.status, "matched");
  assert.equal(matched.profileKey, "profile-one");
  assert.equal(matched.profile.difficulty, 3);
  assert.deepEqual(matched.enrichmentSources, {
    facts: "metatft",
    strategy: "tftclarity_automatic_derivation",
    profile: "tftclarity_profile"
  });

  const clusterChanged = await service.enrichComp({ ...current, compId: "cluster:cluster-b", source: { clusterId: "cluster-b" } }, {
    seasonContextId: "set17-live",
    provider: "metatft-live"
  });
  assert.equal(clusterChanged.profileBinding.status, "cluster_changed");
  assert.equal(clusterChanged.profile, null);

  const signatureDrift = await service.enrichComp(comp("cluster-a", {
    units: [{ apiName: "TFT17_CHANGED", core: true }]
  }), { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.equal(signatureDrift.profileBinding.status, "signature_drift");
  assert.equal(signatureDrift.profile, null);

  await service.bindProfile({
    seasonContextId: "set17-live",
    profileKey: "profile-one",
    provider: "metatft-live",
    clusterId: "cluster-a",
    lineupSignature: signature,
    matchConfidence: 0.4,
    matchStatus: "low_confidence"
  });
  const low = await service.enrichComp(current, { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.equal(low.profileBinding.status, "low_confidence");
  assert.equal(low.profile, null);
});

test("ambiguous candidates and multiple Profiles never silently apply an old Profile", async () => {
  const store = new MemoryCacheStore();
  const service = new CompEnrichmentService({ cacheStore: store, seedData: { profiles: [], bindings: [] } });
  for (const profileKey of ["profile-one", "profile-two"]) {
    await service.saveProfile({ seasonContextId: "set17-live", profileKey, profile: validProfile() });
  }
  const current = comp("cluster-a");
  const signature = createLineupSignature(current);
  await service.bindProfile({ seasonContextId: "set17-live", profileKey: "profile-one", provider: "metatft-live", clusterId: "cluster-a", lineupSignature: signature });
  const duplicated = await service.enrichRankingResult(rankingResult([
    current,
    { ...current, compId: "cluster:cluster-b", source: { clusterId: "cluster-b" }, name: "重复候选" }
  ]), { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.ok(duplicated.rankings.top4Rate.every((entry) => entry.profileBinding.status === "multiple_candidates"));
  assert.ok(duplicated.rankings.top4Rate.every((entry) => entry.profile === null));

  await service.bindProfile({ seasonContextId: "set17-live", profileKey: "profile-two", provider: "metatft-live", clusterId: "cluster-a", lineupSignature: signature });
  const conflict = await service.enrichRankingResult(rankingResult([current]), { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.equal(conflict.rankings.top4Rate[0].profileBinding.status, "multiple_profiles");
  assert.equal(conflict.rankings.top4Rate[0].profile, null);
});

test("ranking enrichment reports coverage, source disappearance, and three Evidence Pack sources", async () => {
  const store = new MemoryCacheStore();
  const service = new CompEnrichmentService({ cacheStore: store, seedData: { profiles: [], bindings: [] } });
  await service.saveProfile({ seasonContextId: "set17-live", profileKey: "missing-profile", profile: validProfile() });
  await service.bindProfile({
    seasonContextId: "set17-live",
    profileKey: "missing-profile",
    provider: "metatft-live",
    clusterId: "gone-cluster",
    lineupSignature: createLineupSignature(comp("gone-cluster"))
  });
  const result = await service.enrichRankingResult(rankingResult([comp("current")]), {
    seasonContextId: "set17-live",
    provider: "metatft-live"
  });
  assert.equal(result.enrichment.currentComps, 1);
  assert.equal(result.enrichment.matched, 0);
  assert.ok(result.enrichment.reviewQueue.some((entry) => entry.matchStatus === "source_missing"));

  const fixture = {
    type: "unit_build_rankings",
    query: { intent: "unit_item_rankings", seasonContextId: "set17-live", unit: "TFT17_Xayah" },
    rankedBuilds: [{
      items: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
      stats: { games: 100, avgPlacement: 3.5, top4Rate: 0.6, winRate: 0.2 }
    }],
    source: { provider: "MetaTFT", patch: "17.7" },
    enrichment: result.enrichment
  };
  const pack = assembleEvidencePack({ result: fixture, catalog: createCatalog() });
  assert.deepEqual(pack.dataStatus.enrichmentSources, {
    facts: "metatft",
    strategy: "tftclarity_automatic_derivation",
    profile: "tftclarity_profile"
  });
});

test("ranking enrichment applies strategy and verified Profiles to the complete candidate pool", async () => {
  const store = new MemoryCacheStore();
  const service = new CompEnrichmentService({ cacheStore: store, seedData: { profiles: [], bindings: [] } });
  const current = comp("candidate-only");
  await service.saveProfile({
    seasonContextId: "set17-live",
    profileKey: "candidate-profile",
    profile: validProfile()
  });
  await service.bindProfile({
    seasonContextId: "set17-live",
    profileKey: "candidate-profile",
    provider: "metatft-live",
    clusterId: "candidate-only",
    lineupSignature: createLineupSignature(current)
  });
  const enriched = await service.enrichRankingResult({
    ...rankingResult([]),
    candidates: [current]
  }, { seasonContextId: "set17-live", provider: "metatft-live" });
  assert.equal(enriched.candidates.length, 1);
  assert.equal(enriched.candidates[0].strategy, "fast8");
  assert.equal(enriched.candidates[0].profileKey, "candidate-profile");
  assert.equal(enriched.candidates[0].profileBinding.status, "matched");
});

test("SQLite Comp Profiles persist and allow the same profileKey in separate seasons", async (context) => {
  const sqlite = await nodeSQLite();
  if (!sqlite) return context.skip("node:sqlite unavailable");
  const database = new sqlite.DatabaseSync(":memory:");
  const store = new SQLiteCacheStore({ database });
  store.upsertCompProfile({ seasonContextId: "set17-live", profileKey: "same-profile", ...validProfile({ difficulty: 2 }) });
  store.upsertCompProfile({ seasonContextId: "set18-live", profileKey: "same-profile", ...validProfile({ difficulty: 5 }) });
  store.upsertCompProfileBinding({
    seasonContextId: "set17-live",
    profileKey: "same-profile",
    provider: "metatft-live",
    clusterId: "cluster-a",
    lineupSignature: "sha256:test",
    signatureVersion: LINEUP_SIGNATURE_VERSION,
    matchConfidence: 1,
    matchStatus: "verified"
  });
  assert.equal(store.getCompProfile("same-profile", { seasonContextId: "set17-live" }).difficulty, 2);
  assert.equal(store.getCompProfile("same-profile", { seasonContextId: "set18-live" }).difficulty, 5);
  assert.equal(store.listCompProfileBindings({ seasonContextId: "set17-live" })[0].signatureVersion, LINEUP_SIGNATURE_VERSION);
  assert.equal(store.listCompProfileBindings({ seasonContextId: "set18-live" }).length, 0);
  database.close();
});
