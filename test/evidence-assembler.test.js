import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EVIDENCE_PACK_SCHEMA_VERSION,
  EvidenceAssemblyError,
  assembleEvidencePack,
  createCatalog
} from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));

test("EvidenceAssembler produces the versioned pack and mirrors every visible build", () => {
  const pack = assembleEvidencePack({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    input: "霞怎么出装？",
    semanticEvidence: [{
      id: "unit:TFT17_Xayah:description",
      documentType: "unit_description",
      text: "霞的当前版本静态技能说明",
      score: 0.9,
      source: "official_catalog"
    }]
  });
  assert.equal(pack.schemaVersion, EVIDENCE_PACK_SCHEMA_VERSION);
  assert.equal(pack.structuredEvidence.filter((entry) => entry.evidenceId.startsWith("build:")).length, fixture.rankedBuilds.length);
  assert.ok(pack.structuredEvidence.every((entry) => entry.visible && entry.authority === "primary_statistics"));
  assert.equal(pack.semanticEvidence[0].authority, "official_static_catalog");
  assert.equal(pack.generationRules.visibleEvidenceOnly, true);
});

test("EvidenceAssembler never lets semantic evidence displace visible structured evidence", () => {
  const semanticEvidence = Array.from({ length: 50 }, (_, index) => ({
    id: `semantic:${index}`,
    documentType: "item_description",
    text: `静态说明 ${index}`,
    score: 1 - index / 100
  }));
  const pack = assembleEvidencePack({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    semanticEvidence,
    plan: { evidenceBudget: { maxItems: 10, maxCharacters: 16000 } }
  });
  assert.equal(pack.recommendations.length, fixture.rankedBuilds.length);
  assert.equal(pack.structuredEvidence.length + pack.semanticEvidence.length, 10);
});

test("EvidenceAssembler retains SemanticHit content stored in metadata", () => {
  const pack = assembleEvidencePack({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    semanticEvidence: [{
      schemaVersion: "semantic_hit.v1",
      id: "unit:TFT17_Xayah",
      documentType: "unit",
      score: 0.98,
      apiName: "TFT17_Xayah",
      patch: "17.7",
      locale: "zh-CN",
      source: "official_catalog",
      metadata: {
        content: "霞是当前版本目录中的规范棋子实体。",
        canonicalName: "霞"
      }
    }]
  });
  assert.equal(pack.semanticEvidence.length, 1);
  assert.equal(pack.semanticEvidence[0].text, "霞是当前版本目录中的规范棋子实体。");
  assert.equal(pack.semanticEvidence[0].metadata.apiName, "TFT17_Xayah");
});

test("EvidenceAssembler rejects missing or over-budget critical evidence instead of generating a partial conclusion", () => {
  assert.throws(() => assembleEvidencePack({
    result: { ...structuredClone(fixture), rankedBuilds: [] },
    catalog: createCatalog()
  }), (error) => error instanceof EvidenceAssemblyError && error.code === "stale_or_missing_evidence");

  assert.throws(() => assembleEvidencePack({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    plan: { evidenceBudget: { maxItems: 1, maxCharacters: 16000 } }
  }), EvidenceAssemblyError);
});

test("EvidenceAssembler redacts secrets, endpoints and local paths from semantic evidence", () => {
  const pack = assembleEvidencePack({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    semanticEvidence: [{
      id: "unsafe",
      text: "API_KEY=sk-secretsecret https://secret.example C:\\Users\\Chencc\\secret.txt"
    }]
  });
  const serialized = JSON.stringify(pack);
  assert.doesNotMatch(serialized, /secretsecret|secret\.example|C:\\\\Users/u);
  assert.match(serialized, /redacted-secret/u);
});
