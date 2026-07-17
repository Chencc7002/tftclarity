import assert from "node:assert/strict";
import test from "node:test";

import {
  EVIDENCE_PACK_SCHEMA_VERSION,
  INTENT_ENVELOPE_SCHEMA_VERSION,
  RETRIEVAL_PLAN_SCHEMA_VERSION,
  SEMANTIC_HIT_SCHEMA_VERSION,
  createEvidencePack,
  createRetrievalPlan,
  createSemanticHit
} from "../src/index.js";

test("all unified retrieval contracts expose stable schema versions and required fields", () => {
  const plan = createRetrievalPlan({
    intent: "unit_item_rankings",
    structuredQueries: [{ operation: "unit_builds" }],
    semanticQueries: [{ query: "剑圣" }],
    evidenceBudget: { maxItems: 12, maxCharacters: 4000 },
    requiredEvidence: ["visible_items"],
    promptKey: "unit-item-rankings"
  });
  assert.equal(plan.schemaVersion, RETRIEVAL_PLAN_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(plan), [
    "schemaVersion", "intent", "structuredQueries", "semanticQueries", "evidenceBudget",
    "requiredEvidence", "promptKey", "needsClarification", "warnings"
  ]);

  const hit = createSemanticHit({
    id: "unit:TFT17_MasterYi",
    documentType: "unit",
    score: 0.98,
    apiName: "TFT17_MasterYi",
    patch: "17.7",
    locale: "zh-CN",
    source: "official_catalog"
  });
  assert.equal(hit.schemaVersion, SEMANTIC_HIT_SCHEMA_VERSION);
  assert.equal(hit.apiName, "TFT17_MasterYi");
  assert.equal(hit.patch, "17.7");
  assert.equal(hit.locale, "zh-CN");
  assert.equal(hit.source, "official_catalog");

  const pack = createEvidencePack({
    request: { intent: "unit_item_rankings" },
    query: { unit: "TFT17_MasterYi" },
    structuredEvidence: [{ evidenceId: "item:1" }],
    semanticEvidence: [hit],
    derivedSignals: { stableCandidateIds: ["item:1"] },
    warnings: [],
    dataStatus: { patch: "17.7" },
    generationRules: { visibleEvidenceOnly: true }
  });
  assert.equal(pack.schemaVersion, EVIDENCE_PACK_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(pack), [
    "schemaVersion", "request", "query", "structuredEvidence", "semanticEvidence",
    "derivedSignals", "warnings", "dataStatus", "generationRules"
  ]);

  assert.equal(INTENT_ENVELOPE_SCHEMA_VERSION, "intent_envelope.v1");
});
