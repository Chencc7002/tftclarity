import { writeFile } from "node:fs/promises";

import {
  CompsContextClient,
  buildCompRankings,
  createCatalog,
  createLineupSignature,
  deriveCompStrategy,
  normalizeCompProfileRecord
} from "../src/index.js";

const SEASON_CONTEXT_ID = "set17-live";
const PROVIDER = "metatft-live";
const QUEUE = "1100";
const RANK_FILTER = ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"];
const OUTPUT_URL = new URL("../src/data/comp-profiles.json", import.meta.url);

function apiSlug(value) {
  return String(value ?? "")
    .replace(/^TFT\d+_/u, "")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
}

function primaryUnit(comp, signature) {
  const displayedLead = String(comp.name ?? "").split("·").at(-1)?.trim();
  const namedUnit = comp.units.find((unit) => String(unit.name ?? "").trim() === displayedLead);
  return namedUnit?.apiName
    ?? comp.coreBuilds?.[0]?.unitApiName
    ?? signature.units[0]
    ?? "comp";
}

function uniqueProfileKey(comp, signature, strategy, usedKeys) {
  const carry = apiSlug(primaryUnit(comp, signature)) || "comp";
  const trait = apiSlug(signature.traits[0]);
  const base = [carry, strategy, trait].filter(Boolean).join("-").slice(0, 72);
  let key = base;
  if (usedKeys.has(key)) key = `${base}-${signature.value.slice(7, 13)}`.slice(0, 80);
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${base}-${suffix}`.slice(0, 80);
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function profileRatings(comp, strategy) {
  const rosterSize = new Set(comp.units.map((unit) => unit.apiName)).size;
  const targetThreeStars = comp.units.filter((unit) => Number(unit.targetStarLevel) >= 3).length;
  const contested = Boolean(comp.contested);
  if (strategy === "reroll") {
    return {
      difficulty: targetThreeStars >= 3 ? 4 : 3,
      beginnerFriendly: targetThreeStars <= 2,
      pivotDifficulty: targetThreeStars >= 3 ? 5 : 4,
      positionDifficulty: rosterSize >= 9 ? 4 : 3,
      contestTolerance: contested ? 1 : 2,
      econDifficulty: 3
    };
  }
  if (strategy === "fast9") {
    return {
      difficulty: 5,
      beginnerFriendly: false,
      pivotDifficulty: 4,
      positionDifficulty: 4,
      contestTolerance: contested ? 2 : 3,
      econDifficulty: 5
    };
  }
  return {
    difficulty: 3,
    beginnerFriendly: true,
    pivotDifficulty: 3,
    positionDifficulty: rosterSize >= 9 ? 4 : 3,
    contestTolerance: contested ? 2 : 3,
    econDifficulty: 4
  };
}

function sourceTime(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value ?? "unknown");
}

const client = new CompsContextClient({ timeoutMs: 15000, rankingsTimeoutMs: 15000 });
const compsData = await client.getCompsData({ queue: QUEUE });
const dataClusterId = compsData?.results?.data?.cluster_id;
const compsStats = await client.getCompsStats({
  queue: QUEUE,
  patch: "current",
  days: 3,
  rank: [...RANK_FILTER].sort().join(","),
  permit_filter_adjustment: "true",
  cluster_id: dataClusterId
});
const result = buildCompRankings({ compsData, compsStats }, {
  query: {
    intent: "comp_rankings",
    seasonContextId: SEASON_CONTEXT_ID,
    patch: "current",
    queue: QUEUE,
    days: 3,
    rankFilter: RANK_FILTER,
    minSamples: 0,
    metrics: ["top4_rate"],
    limit: 200
  },
  catalog: createCatalog()
});

const usedKeys = new Set();
const profiles = [];
const bindings = [];
for (const comp of [...result.candidates].sort((left, right) => (
  Number(left.source.clusterId) - Number(right.source.clusterId)
))) {
  const signature = createLineupSignature(comp);
  const strategy = deriveCompStrategy(comp).strategy;
  const profileKey = uniqueProfileKey(comp, signature, strategy, usedKeys);
  const profile = normalizeCompProfileRecord({
    seasonContextId: SEASON_CONTEXT_ID,
    profileKey,
    ...profileRatings(comp, strategy),
    notes: [
      `自动初稿：按 ${strategy} 阵容骨架生成，难度画像需结合实战复核。`,
      `MetaTFT 生成时名称：${comp.name}。`,
      `生成口径：当前版本、近 3 天、可见阵容；来源更新时间 ${sourceTime(result.source.updatedAt)}。`
    ],
    enabled: true,
    source: "metatft_auto_seed"
  });
  profiles.push(profile);
  bindings.push({
    seasonContextId: SEASON_CONTEXT_ID,
    profileKey,
    provider: PROVIDER,
    clusterId: String(comp.source.clusterId),
    lineupSignature: signature.value,
    signatureVersion: signature.version,
    matchConfidence: 1,
    matchStatus: "verified"
  });
}

const seed = {
  schemaVersion: "comp-profile-seed.v1",
  generatedAt: new Date().toISOString(),
  source: {
    provider: PROVIDER,
    clusterId: String(result.source.clusterId ?? dataClusterId ?? ""),
    updatedAt: sourceTime(result.source.updatedAt),
    patch: "current",
    days: 3,
    queue: QUEUE,
    rankFilter: RANK_FILTER
  },
  profiles,
  bindings
};

if (process.argv.includes("--write")) {
  await writeFile(OUTPUT_URL, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT_URL.pathname,
    profiles: profiles.length,
    bindings: bindings.length,
    clusterId: seed.source.clusterId,
    updatedAt: seed.source.updatedAt
  }, null, 2));
} else {
  console.log(JSON.stringify(seed, null, 2));
}
