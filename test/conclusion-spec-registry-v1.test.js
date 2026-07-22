import assert from "node:assert/strict";
import test from "node:test";

import {
  CONCLUSION_SPEC_REGISTRY,
  CONCLUSION_SPECS,
  ConclusionSpecRegistry,
  ConclusionSpecRegistryError
} from "../src/index.js";

test("ConclusionSpec Registry resolves only exact intent/questionType/resultType matches", () => {
  assert.equal(CONCLUSION_SPEC_REGISTRY.resolve({
    intent: "unit_item_rankings", questionType: "item_performance", resultType: "unit_item_rankings"
  }).id, "unit_item_rankings.item_performance");
  assert.throws(() => CONCLUSION_SPEC_REGISTRY.resolve({
    intent: "unit_item_ranking", questionType: "item_performance", resultType: "unit_item_rankings"
  }), (error) => error.code === "unregistered_conclusion_spec");
  assert.throws(() => CONCLUSION_SPEC_REGISTRY.resolve({
    intent: "comp_analysis", questionType: "popularity", resultType: "comp_analysis"
  }), (error) => error.code === "unregistered_conclusion_spec");
});

test("ConclusionSpec Registry rejects ambiguous matches at compilation", () => {
  const source = structuredClone(CONCLUSION_SPECS.find((entry) => entry.id === "unit_build_rankings.default"));
  const duplicate = { ...structuredClone(source), id: "unit_build_rankings.duplicate" };
  assert.throws(() => new ConclusionSpecRegistry([source, duplicate]), (error) => (
    error instanceof ConclusionSpecRegistryError && error.details.some((detail) => /ambiguous match/u.test(detail))
  ));
});

test("ConclusionSpec Registry fails startup compilation for missing prompts and illegal evidence", () => {
  const source = structuredClone(CONCLUSION_SPECS[0]);
  assert.throws(() => new ConclusionSpecRegistry([{ ...source, prompt: { ...source.prompt, file: "missing.md" } }]),
    (error) => error.details.some((detail) => /prompt file/u.test(detail)));
  const invalidEvidence = structuredClone(source);
  invalidEvidence.requiredEvidence[invalidEvidence.requiredAnswerDimensions[0]] = ["remote_operation:anything"];
  assert.throws(() => new ConclusionSpecRegistry([invalidEvidence]),
    (error) => error.details.some((detail) => /unsupported requiredEvidence/u.test(detail)));
  assert.throws(() => new ConclusionSpecRegistry([{
    ...structuredClone(source), validationRules: { unreviewedJudge: true }
  }]), (error) => error.details.some((detail) => /unsupported validation rule/u.test(detail)));
  assert.throws(() => new ConclusionSpecRegistry([{
    ...structuredClone(source), fallback: { renderer: "dynamic_remote_operation" }
  }]), (error) => error.details.some((detail) => /unsupported fallback renderer/u.test(detail)));
});

test("disabled ConclusionSpecs never participate in matching", () => {
  const source = { ...structuredClone(CONCLUSION_SPECS[0]), enabled: false };
  const registry = new ConclusionSpecRegistry([source]);
  assert.throws(() => registry.resolve({
    intent: source.match.intent, questionType: source.match.questionType, resultType: source.match.resultTypes[0]
  }), (error) => error.code === "unregistered_conclusion_spec");
});
