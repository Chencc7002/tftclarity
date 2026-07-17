import assert from "node:assert/strict";
import test from "node:test";

import {
  StructuredRetriever,
  createRetrievalPlan
} from "../src/index.js";

test("StructuredRetriever executes only allowlisted operations with allowlisted parameters", async () => {
  let received;
  const retriever = new StructuredRetriever({
    handlers: {
      unit_builds: async (params) => {
        received = params;
        return { rows: [], patch: params.patch, updatedAt: "2026-07-17T00:00:00Z", cache: "fresh" };
      }
    }
  });
  const plan = createRetrievalPlan({
    intent: "unit_build_rankings",
    structuredQueries: [{
      id: "structured:unit_builds",
      source: "metatft",
      operation: "unit_builds",
      params: { unit: "TFT17_Xayah", days: 3, patch: "17.7", arbitraryUrl: "https://evil.example" },
      required: true
    }]
  });
  const [result] = await retriever.execute(plan);
  assert.deepEqual(received, { unit: "TFT17_Xayah", days: 3, patch: "17.7" });
  assert.equal(result.operation, "unit_builds");
  assert.equal(result.metadata.patch, "17.7");
  assert.equal(result.metadata.cache, "fresh");
});

test("StructuredRetriever rejects model-invented operations and mismatched sources", async () => {
  const retriever = new StructuredRetriever();
  const invented = createRetrievalPlan({
    intent: "unit_build_rankings",
    structuredQueries: [{ source: "metatft", operation: "fetch_any_url", params: {}, required: true }]
  });
  await assert.rejects(() => retriever.execute(invented), (error) => error.code === "operation_not_allowed");

  const wrongSource = createRetrievalPlan({
    intent: "unit_build_rankings",
    structuredQueries: [{ source: "semantic_index", operation: "unit_builds", params: {}, required: true }]
  });
  await assert.rejects(() => retriever.execute(wrongSource), (error) => error.code === "operation_not_allowed");
});

test("StructuredRetriever keeps detail queries catalog-only and does not require an LLM", async () => {
  const retriever = new StructuredRetriever({
    handlers: { unit_details: async ({ apiName }) => ({ apiName, stats: { hp: 1000 } }) }
  });
  const plan = createRetrievalPlan({
    intent: "unit_details",
    structuredQueries: [{ source: "official_catalog", operation: "unit_details", params: { apiName: "TFT17_Xayah" }, required: true }],
    promptKey: null
  });
  const [result] = await retriever.execute(plan);
  assert.equal(result.value.apiName, "TFT17_Xayah");
  assert.equal(plan.promptKey, null);
});
