import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFactorSchemaEnvelope,
  collectFactorObservations,
  validateNormalizedFactorSchema
} from "../src/knowledge/mechanism-factor-normalizer.js";

test("normalizer evidence IDs remain traceable to case fields", () => {
  const observations = collectFactorObservations([{
    caseId: "case:a",
    unitObservations: [{
      label: "攻击频率",
      description: "提高攻击次数",
      sourceRefs: ["unit.stats.attackSpeed"],
      claimType: "mechanism_inference",
      confidence: 0.8
    }],
    itemObservations: [{
      label: "法力回复",
      description: "提供法力",
      sourceRefs: ["items[0].effect"],
      claimType: "official_fact",
      confidence: 0.9,
      conditions: []
    }],
    relationshipCandidates: [],
    statisticalObservations: [],
    unknownFactors: []
  }]);
  assert.equal(observations.length, 2);
  const [positive, negative] = observations;
  const schema = buildFactorSchemaEnvelope({
    factors: [{
      factorId: "factor:output-frequency",
      name: "输出频率",
      definition: "提高单位时间内的攻击或触发次数",
      parentFactorId: null,
      positiveObservationIds: [positive.observationId],
      negativeObservationIds: [negative.observationId],
      adjacentFactors: ["资源回复"],
      conditions: [],
      requiresCondition: false,
      firstDiscoveredCaseId: "case:a",
      supportingCaseCount: 1,
      applicableSeasons: ["S17"],
      reviewStatus: "needs_review"
    }],
    theoryCandidates: [],
    unmappedFactors: []
  }, observations);
  assert.deepEqual(validateNormalizedFactorSchema(schema, observations), []);
  assert.equal(schema.evidenceIndex[positive.observationId].caseId, "case:a");
});

test("normalizer rejects entity-specific theory and untraceable evidence", () => {
  const observations = [{
    observationId: "observation:one",
    caseId: "case:a",
    kind: "unit_factor",
    sourceRefs: ["unit.ability.description"],
    claimType: "official_fact"
  }];
  const schema = {
    schemaVersion: "mechanism-factor-schema.v1",
    factors: [],
    theoryCandidates: [{
      theoryId: "theory:specific",
      statement: "霞必须出某装备",
      relationType: "固定答案",
      premiseFactorIds: [],
      resultFactorIds: [],
      supportingObservationIds: ["observation:missing"],
      counterObservationIds: [],
      conditions: [],
      failureConditions: [],
      formulaStatus: "not_applicable",
      causal: false
    }],
    unmappedFactors: []
  };
  const errors = validateNormalizedFactorSchema(schema, observations, { entityNames: ["霞"] });
  assert.equal(errors.some((entry) => entry.includes("unknown")), true);
  assert.equal(errors.some((entry) => entry.includes("contains_entity_name")), true);
  assert.equal(errors.includes("contains_fixed_build_answer"), true);
});

test("single-character entity detection does not reject ordinary Chinese words", () => {
  const observations = [{
    observationId: "observation:one",
    caseId: "case:a",
    kind: "unit_factor",
    sourceRefs: ["unit.ability.description"],
    claimType: "official_fact"
  }, {
    observationId: "observation:two",
    caseId: "case:b",
    kind: "unit_factor",
    sourceRefs: ["unit.ability.description"],
    claimType: "official_fact"
  }];
  const schema = {
    schemaVersion: "mechanism-factor-schema.v1",
    factors: [],
    theoryCandidates: [{
      theoryId: "theory:threshold",
      statement: "最大生命值降低会使百分比阈值更容易达到。",
      relationType: "threshold",
      premiseFactorIds: [],
      resultFactorIds: [],
      supportingObservationIds: ["observation:one"],
      counterObservationIds: ["observation:two"],
      conditions: [],
      failureConditions: [],
      formulaStatus: "qualitative_only",
      causal: false
    }],
    unmappedFactors: []
  };
  assert.deepEqual(validateNormalizedFactorSchema(schema, observations, { entityNames: ["易"] }), []);
});
