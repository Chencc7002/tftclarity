import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const seed = JSON.parse(readFileSync(new URL("../src/data/comp-profiles.json", import.meta.url), "utf8"));
const profiles = new Map(seed.profiles.map((profile) => [profile.profileKey, profile]));
const records = seed.bindings.map((binding) => ({
  binding,
  profile: profiles.get(binding.profileKey)
}));

const FAST9_CLUSTERS = new Set(["409002", "409028", "409058", "409064"]);
const THREE_COST_REROLL_CLUSTERS = new Set([
  "409003", "409008", "409009", "409011", "409013", "409014", "409016", "409018",
  "409023", "409030", "409034", "409035", "409047", "409055", "409060", "409061",
  "409062", "409063", "409066"
]);
const TWO_COST_REROLL_CLUSTERS = new Set([
  "409019", "409022", "409029", "409033", "409045", "409054", "409059", "409068"
]);

test("curated fast8 and fast9 maintenance is complete and binding-scoped", () => {
  const fastRecords = records.filter(({ profile }) => /-fast(?:8|9)-/u.test(profile.profileKey));
  assert.equal(fastRecords.length, 20);
  for (const { binding, profile } of fastRecords) {
    const expectedStrategy = FAST9_CLUSTERS.has(binding.clusterId) ? "fast9" : "fast8";
    assert.equal(binding.strategyOverride, expectedStrategy, binding.clusterId);
    assert.equal(profile.difficulty, expectedStrategy === "fast9" ? 5 : 3, binding.clusterId);
    assert.equal(profile.pivotDifficulty, expectedStrategy === "fast9" ? 3 : 4, binding.clusterId);
    assert.equal(profile.positionDifficulty, 1, binding.clusterId);
    assert.equal(profile.contestTolerance, 2, binding.clusterId);
    assert.equal(profile.econDifficulty, expectedStrategy === "fast9" ? 5 : 3, binding.clusterId);
    if (expectedStrategy === "fast9") assert.equal(profile.beginnerFriendly, false, binding.clusterId);
  }
});

test("three-cost and two-cost reroll groups copy their reviewed templates", () => {
  const expected = {
    three: {
      difficulty: 4,
      beginnerFriendly: false,
      pivotDifficulty: 5,
      positionDifficulty: 1,
      contestTolerance: 4,
      econDifficulty: 4
    },
    two: {
      difficulty: 2,
      beginnerFriendly: true,
      pivotDifficulty: 4,
      positionDifficulty: 3,
      contestTolerance: 3,
      econDifficulty: 2
    }
  };
  for (const { binding, profile } of records) {
    const template = THREE_COST_REROLL_CLUSTERS.has(binding.clusterId)
      ? expected.three
      : TWO_COST_REROLL_CLUSTERS.has(binding.clusterId)
        ? expected.two
        : null;
    if (!template) continue;
    for (const [field, value] of Object.entries(template)) {
      assert.equal(profile[field], value, `${binding.clusterId}.${field}`);
    }
  }
  assert.equal(THREE_COST_REROLL_CLUSTERS.size, 19);
  assert.equal(TWO_COST_REROLL_CLUSTERS.size, 8);
});
