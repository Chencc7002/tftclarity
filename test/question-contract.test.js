import assert from "node:assert/strict";
import test from "node:test";

import {
  CONCLUSION_SPEC_REGISTRY,
  createCatalog,
  createIntentEnvelope,
  createQuestionContract,
  questionContractFingerprint,
  validateQuestionContract
} from "../src/index.js";

const catalog = createCatalog();

function build(overrides = {}) {
  const input = overrides.input ?? "霞已有羊刀怎么补？";
  const query = {
    intent: "unit_build_completion",
    unit: "TFT17_Xayah",
    lockedItems: ["TFT_Item_GuinsoosRageblade"],
    days: 3,
    rankFilter: ["EMERALD", "DIAMOND"],
    seasonContextId: overrides.seasonContextId ?? "set17-live",
    assumptions: [{
      key: "unit", value: "TFT17_Xayah", source: "conversation", origin: "current_input",
      origins: ["current_input", "conversation"]
    }],
    constraintSources: { unit: { source: "conversation", confidence: 0.96 } },
    ...(overrides.query ?? {})
  };
  const intentEnvelope = createIntentEnvelope({
    input,
    parsed: { intent: query.intent, unit: query.unit, confidence: 1, parser: { entityMatches: [] } },
    query,
    validation: { valid: true },
    catalog
  });
  const spec = CONCLUSION_SPEC_REGISTRY.resolve({ intent: query.intent, questionType: "default", resultType: query.intent });
  return createQuestionContract({
    originalQuestion: input,
    intentEnvelope,
    query,
    result: { type: query.intent, query, validation: { valid: true } },
    spec,
    seasonContextId: query.seasonContextId,
    principalId: overrides.principalId ?? "user-a",
    conversationId: overrides.conversationId ?? "conversation-a"
  });
}

test("Question Contract has a stable canonical fingerprint and preserves inherited-field origins", () => {
  const first = build();
  const reordered = build({ query: { rankFilter: ["EMERALD", "DIAMOND"], days: 3 } });
  assert.equal(first.contractId, reordered.contractId);
  assert.equal(questionContractFingerprint(first), first.contractId);
  assert.deepEqual(first.constraints.assumptions.unit.origins, ["current_input", "conversation"]);
  assert.equal(validateQuestionContract(first).valid, true);
});

test("Question Contract isolates new questions, seasons, principals and conversations", () => {
  const base = build();
  for (const candidate of [
    build({ input: "霞三件套是什么？" }),
    build({ seasonContextId: "set18-pbe" }),
    build({ principalId: "user-b" }),
    build({ conversationId: "conversation-b" })
  ]) assert.notEqual(candidate.contractId, base.contractId);
});

test("Question Contract rejects unvalidated queries and low-confidence envelopes enter clarification", () => {
  const query = { intent: "unit_build_rankings", unit: "TFT17_Xayah" };
  const envelope = createIntentEnvelope({
    input: "霞怎么出装", parsed: { intent: query.intent, confidence: 0.4 }, query,
    validation: { valid: true }, catalog
  });
  const spec = CONCLUSION_SPEC_REGISTRY.resolve({ intent: query.intent, questionType: "default", resultType: query.intent });
  const contract = createQuestionContract({
    originalQuestion: "霞怎么出装", intentEnvelope: envelope, query,
    result: { type: query.intent, query }, spec
  });
  assert.equal(contract.needsClarification, true);
  assert.throws(() => createQuestionContract({
    originalQuestion: "霞怎么出装", intentEnvelope: envelope,
    query: { ...query, validation: { valid: false } }, result: { type: query.intent }, spec
  }), /validated Query/u);
});

test("Question Contract redacts secrets, internal URLs and local paths before entering Evidence Pack", () => {
  const contract = build({ input: "霞怎么出装 api_key=secret123 https://internal.example C:\\private\\token.txt" });
  assert.doesNotMatch(contract.originalQuestion, /secret123|internal\.example|private\\token/u);
  assert.match(contract.originalQuestion, /\[redacted-secret\]|\[redacted-url\]|\[redacted-path\]/u);
});
