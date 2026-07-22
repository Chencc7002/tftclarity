import { readFile, writeFile } from "node:fs/promises";

const INPUT_URL = new URL("../src/data/comp-profiles.json", import.meta.url);
const POLICY_VERSION = "set17-comp-profile-maintenance-2026-07-22";
const FAST9_CLUSTERS = new Set(["409002", "409028", "409058", "409064"]);
const THREE_COST_REROLL_CLUSTERS = new Set([
  "409003", "409008", "409009", "409011", "409013", "409014", "409016", "409018",
  "409023", "409030", "409034", "409035", "409047", "409055", "409060", "409061",
  "409062", "409063", "409066"
]);
const TWO_COST_REROLL_CLUSTERS = new Set([
  "409019", "409022", "409029", "409033", "409045", "409054", "409059", "409068"
]);

const FAST9_PROFILE = Object.freeze({
  difficulty: 5,
  beginnerFriendly: false,
  pivotDifficulty: 3,
  positionDifficulty: 1,
  contestTolerance: 2,
  econDifficulty: 5
});
const FAST8_PROFILE = Object.freeze({
  difficulty: 3,
  pivotDifficulty: 4,
  positionDifficulty: 1,
  contestTolerance: 2,
  econDifficulty: 3
});
const THREE_COST_REROLL_PROFILE = Object.freeze({
  difficulty: 4,
  beginnerFriendly: false,
  pivotDifficulty: 5,
  positionDifficulty: 1,
  contestTolerance: 4,
  econDifficulty: 4
});
const TWO_COST_REROLL_PROFILE = Object.freeze({
  difficulty: 2,
  beginnerFriendly: true,
  pivotDifficulty: 4,
  positionDifficulty: 3,
  contestTolerance: 3,
  econDifficulty: 2
});

function replaceMaintenanceNote(profile, note) {
  const notes = Array.isArray(profile.notes) ? profile.notes : [];
  return [note, ...notes.filter((value) => !String(value).startsWith("自动初稿：") && !String(value).startsWith("人工维护："))];
}

const seed = JSON.parse(await readFile(INPUT_URL, "utf8"));
const bindingByProfile = new Map(seed.bindings.map((binding) => [binding.profileKey, binding]));
const counts = { fast9: 0, fast8: 0, threeCostReroll: 0, twoCostReroll: 0, untouched: 0 };

for (const profile of seed.profiles) {
  const binding = bindingByProfile.get(profile.profileKey);
  if (!binding) throw new Error(`Profile 缺少 binding：${profile.profileKey}`);
  const clusterId = String(binding.clusterId);
  if (profile.profileKey.includes("-fast9-") || profile.profileKey.includes("-fast8-")) {
    const strategy = FAST9_CLUSTERS.has(clusterId) ? "fast9" : "fast8";
    Object.assign(profile, strategy === "fast9" ? FAST9_PROFILE : FAST8_PROFILE, {
      notes: replaceMaintenanceNote(profile, `人工维护：cluster ${clusterId} 按 ${strategy} 运营，采用 ${strategy} 统一难度模板。`),
      source: "tftclarity_curated_seed"
    });
    binding.strategyOverride = strategy;
    counts[strategy] += 1;
    continue;
  }
  if (THREE_COST_REROLL_CLUSTERS.has(clusterId)) {
    Object.assign(profile, THREE_COST_REROLL_PROFILE, {
      notes: replaceMaintenanceNote(profile, "人工维护：三费主 C reroll，采用厄运小姐模板。"),
      source: "tftclarity_curated_seed"
    });
    counts.threeCostReroll += 1;
    continue;
  }
  if (TWO_COST_REROLL_CLUSTERS.has(clusterId)) {
    Object.assign(profile, TWO_COST_REROLL_PROFILE, {
      notes: replaceMaintenanceNote(profile, "人工维护：二费主 C reroll，采用挑战贝尔维思模板。"),
      source: "tftclarity_curated_seed"
    });
    counts.twoCostReroll += 1;
    continue;
  }
  counts.untouched += 1;
}

if (counts.fast9 !== 4 || counts.fast8 !== 16 || counts.threeCostReroll !== 19 || counts.twoCostReroll !== 8) {
  throw new Error(`维护范围与预期不一致：${JSON.stringify(counts)}`);
}

seed.maintenance = {
  policyVersion: POLICY_VERSION,
  fast9Clusters: [...FAST9_CLUSTERS],
  templates: {
    threeCostReroll: "missfortune-reroll-astrait",
    twoCostReroll: "belveth-reroll-astrait"
  }
};

if (process.argv.includes("--write")) {
  await writeFile(INPUT_URL, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  ok: true,
  policyVersion: POLICY_VERSION,
  wrote: process.argv.includes("--write"),
  counts
}, null, 2));
