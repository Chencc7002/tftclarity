import assert from "node:assert/strict";
import test from "node:test";

import { rerankSemanticHits } from "../src/index.js";

function hit(id, options = {}) {
  return {
    schemaVersion: "semantic_hit.v1",
    id,
    documentType: options.documentType ?? "unit",
    score: options.score ?? 0.99,
    apiName: options.apiName,
    patch: options.patch ?? "17.7",
    locale: options.locale ?? "zh-CN",
    source: "test",
    metadata: {
      canonicalName: options.canonicalName,
      aliases: options.aliases ?? [],
      content: options.content ?? ""
    }
  };
}

test("hybrid reranking enforces API ID > canonical name > alias > keyword > vector", () => {
  const cases = [
    ["TFT17_MasterYi", "api"],
    ["易大师", "canonical"],
    ["剑圣", "alias"]
  ];
  for (const [query, expected] of cases) {
    const hits = rerankSemanticHits(query, [
      hit("vector", { score: 1, content: "高相似描述" }),
      hit("alias", { score: 0.1, aliases: ["剑圣"] }),
      hit("canonical", { score: 0.1, canonicalName: "易大师" }),
      hit("api", { score: 0.1, apiName: "TFT17_MasterYi" })
    ]);
    assert.equal(hits[0].id, expected);
  }
});

test("current patch and locale filters prevent a higher-similarity old entity from winning", () => {
  const hits = rerankSemanticHits("剑圣", [
    hit("current", { patch: "17.7", aliases: ["剑圣"], score: 0.5 }),
    hit("old", { patch: "16.8", aliases: ["剑圣"], score: 1 }),
    hit("english", { locale: "en-US", aliases: ["剑圣"], score: 1 })
  ], { patch: "17.7", locale: "zh-CN", documentTypes: ["unit"] });
  assert.deepEqual(hits.map((entry) => entry.id), ["current"]);
});

test("reranker deduplicates document IDs and keeps the strongest allowed hit", () => {
  const hits = rerankSemanticHits("易大师", [
    hit("same", { score: 0.1, content: "描述" }),
    hit("same", { score: 0.2, canonicalName: "易大师" })
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].metadata.hybridMatchType, "canonical_exact");
});
