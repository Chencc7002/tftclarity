import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeRetriever } from "../src/knowledge/knowledge-retriever.js";
import { MemorySemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { createPersistentSemanticRetriever } from "../src/retrieval/semantic-retriever.js";

function currentStatsDocument(overrides = {}) {
  return {
    seasonContextId: "set17-live",
    id: "metatft:meta_snapshot:17.7:global",
    documentType: "meta_snapshot",
    content: "当前环境稳定阵容包括霞与艾欧尼亚体系。",
    contentHash: "content",
    recordHash: "record",
    patch: "17.7",
    locale: "zh-CN",
    source: "metatft",
    updatedAt: "2026-07-29T01:00:00.000Z",
    metadata: {
      namespace: "current_stats",
      currentStatsSchemaVersion: "current_stats.v2",
      source: "metatft",
      season: "set17-live",
      patch: "17.7",
      rank: "CHALLENGER,DIAMOND,GRANDMASTER,MASTER",
      timeWindow: "30d",
      region: "global",
      locale: "zh-CN",
      generatedAt: "2026-07-29T01:00:00.000Z",
      expiresAt: "2099-07-30T01:00:00.000Z"
    },
    ...overrides
  };
}

test("current_stats exposes available scopes and rejects an ungenerated scope", async () => {
  const store = new MemorySemanticDocumentStore();
  await store.upsert(currentStatsDocument(), { allowCurrentStats: true });
  const retriever = new KnowledgeRetriever({
    retriever: createPersistentSemanticRetriever({ store })
  });
  const common = {
    scopes: ["current_stats"],
    seasonContextId: "set17-live",
    season: "set17-live",
    patch: "17.7",
    timeWindow: "30d",
    region: "global",
    locale: "zh-CN",
    minimumScore: 0
  };

  const available = await retriever.searchWithStatus("当前环境", {
    ...common,
    rank: "MASTER,CHALLENGER,DIAMOND,GRANDMASTER"
  });
  assert.equal(available.currentStats.status, "available");
  assert.equal(available.currentStats.availableScopes[0].documentCount, 1);

  const unavailable = await retriever.searchWithStatus("当前环境", {
    ...common,
    rank: "GOLD"
  });
  assert.equal(unavailable.currentStats.status, "scope_unavailable");
  assert.deepEqual(unavailable.warnings, ["current_stats_scope_unavailable"]);
  assert.equal(unavailable.evidence.length, 0);
  assert.equal(unavailable.currentStats.availableScopes[0].rank, "CHALLENGER,DIAMOND,GRANDMASTER,MASTER");
});
