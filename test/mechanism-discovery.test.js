import test from "node:test";
import assert from "node:assert/strict";
import {
  assignUnitsToDiscoverySplits,
  buildFactorDiscoveryPack,
  normalizeFactorCandidate,
  selectStratifiedDiscoveryCases,
  validateFactorCandidate
} from "../src/knowledge/mechanism-discovery.js";

function record(unit, index, games, avgPlacement = 4.5) {
  return {
    caseId: `case:${unit}:${index}`,
    season: "S17",
    patch: "16.14",
    unit: {
      apiName: unit,
      name: unit,
      role: "测试",
      entityType: "playable_candidate",
      stats: { attackSpeed: 0.7 },
      ability: { name: "技能", type: "主动", description: "造成伤害。" },
      mechanicAtoms: [],
      sourceHash: "unit-hash",
      sourceUrl: "https://official.example/chess",
      sourceQuality: { textComplete: true }
    },
    items: ["A", "B", `C${index}`].map((apiName) => ({
      apiName,
      name: apiName,
      effect: "+10攻击速度",
      mechanicAtoms: [],
      sourceHash: `${apiName}-hash`,
      sourceUrl: "https://official.example/items",
      sourceQuality: { textComplete: true }
    })),
    rawItems: ["A", "B", `C${index}`],
    stats: {
      games,
      avgPlacement,
      top4Rate: 0.5,
      winRate: 0.1,
      sampleEvidence: { tier: games >= 400 ? "general_comparison" : "weak" }
    },
    evidencePolicy: { officialTextComplete: true, causalClaimAllowed: false }
  };
}

test("unit split is deterministic, exhaustive, and hero-isolated", () => {
  const cases = Array.from({ length: 20 }, (_unused, unitIndex) => (
    Array.from({ length: 3 }, (_value, caseIndex) => record(`Unit${unitIndex}`, caseIndex, 500))
  )).flat();
  const left = assignUnitsToDiscoverySplits(cases, { seed: "fixed" });
  const right = assignUnitsToDiscoverySplits([...cases].reverse(), { seed: "fixed" });
  assert.deepEqual(left, right);
  assert.deepEqual(left.counts, { discovery: 14, adjustment: 3, blind: 3 });
  assert.equal(new Set(left.assignments.map((entry) => entry.apiName)).size, 20);
});

test("stratified sampling only reads the requested hero split", () => {
  const cases = Array.from({ length: 10 }, (_unused, unitIndex) => (
    Array.from({ length: 10 }, (_value, caseIndex) => (
      record(`Unit${unitIndex}`, caseIndex, caseIndex % 3 === 0 ? 200 : 1000, 3.5 + caseIndex / 10)
    ))
  )).flat();
  const split = assignUnitsToDiscoverySplits(cases, { seed: "fixed" });
  const selected = selectStratifiedDiscoveryCases(cases, [], split, { limit: 40 });
  const discoveryUnits = new Set(split.assignments
    .filter((entry) => entry.split === "discovery")
    .map((entry) => entry.apiName));
  assert.equal(selected.cases.length, 40);
  assert.equal(selected.cases.every((entry) => discoveryUnits.has(entry.unit.apiName)), true);
  assert.equal(selected.manifest.cases.some((entry) => entry.stratum === "low_sample_mechanism"), true);
});

test("factor candidate validator enforces traceable non-causal hypotheses", () => {
  const caseRecord = record("UnitA", 1, 1000);
  const pack = buildFactorDiscoveryPack(caseRecord);
  const candidate = {
    schemaVersion: "factor_candidate.v1",
    caseId: caseRecord.caseId,
    unitObservations: [{
      label: "持续技能输出",
      description: "技能造成伤害",
      sourceRefs: ["unit.ability.description"],
      claimType: "official_fact",
      confidence: 0.9
    }],
    itemObservations: [{
      itemApiName: "A",
      label: "攻击频率",
      description: "提高攻击速度",
      sourceRefs: ["items[0].effect"],
      conditions: [],
      claimType: "official_fact",
      confidence: 0.9
    }],
    relationshipCandidates: [{
      label: "疑似数值联动",
      description: "可能存在乘法联动",
      relationType: "multiplicative_hypothesis",
      items: ["A"],
      sourceRefs: ["unit.ability.description", "items[0].effect"],
      conditions: [],
      failureConditions: [],
      claimType: "mechanism_inference",
      formulaStatus: "hypothesis",
      causal: false,
      confidence: 0.5
    }],
    statisticalObservations: [],
    unknownFactors: []
  };
  assert.deepEqual(validateFactorCandidate(candidate, pack), []);
  candidate.relationshipCandidates[0].formulaStatus = "not_applicable";
  candidate.relationshipCandidates[0].causal = true;
  assert.deepEqual(validateFactorCandidate(candidate, pack), [
    "relationshipCandidates[0].causal:must_be_false",
    "relationshipCandidates[0].formulaStatus:multiplicative_must_be_hypothesis"
  ]);
});

test("candidate normalization only downgrades unverified formula states", () => {
  const normalized = normalizeFactorCandidate({
    caseId: "wrong",
    relationshipCandidates: [
      { relationType: "other", formulaStatus: "no_sufficient_evidence" },
      { relationType: "multiplicative_hypothesis", formulaStatus: "verified" }
    ]
  }, { caseId: "expected" });
  assert.equal(normalized.caseId, "expected");
  assert.deepEqual(normalized.relationshipCandidates.map((entry) => entry.formulaStatus), [
    "qualitative_only",
    "hypothesis"
  ]);
});
