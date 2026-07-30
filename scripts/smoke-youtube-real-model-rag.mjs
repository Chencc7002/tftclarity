import assert from "node:assert/strict";
import { resolve } from "node:path";

import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createEmbeddingProviderFromConfig,
  resolveEmbeddingProviderConfig
} from "../src/llm/embedding-provider.js";
import { SQLiteSemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import {
  EmbeddingSemanticRetriever,
  HybridSemanticRetriever,
  TfidfSemanticRetriever
} from "../src/retrieval/semantic-retriever.js";

loadLocalEnvironment();

const filePath = resolve(
  process.argv[2]
  ?? ".cache/youtube-acceptance/youtube-real-model-v4.sqlite"
);
const provider = createEmbeddingProviderFromConfig(
  resolveEmbeddingProviderConfig({}, process.env)
);
assert.equal(provider.isAvailable(), true, "real embedding provider is unavailable");

const store = await SQLiteSemanticDocumentStore.open({ filePath });
try {
  const embedding = new EmbeddingSemanticRetriever({ provider, store });
  const lexical = new TfidfSemanticRetriever({ store });
  const retriever = new HybridSemanticRetriever(embedding, {
    lexicalRetriever: lexical
  });
  const scope = {
    seasonContextId: "set17-live",
    documentTypes: ["video_guide"],
    patch: "17.7",
    locale: "zh-CN",
    topK: 3,
    minimumScore: 0
  };
  const cases = [
    {
      question: "霞第一件装备应该优先做什么？",
      expected: ["鬼索的狂暴之刃"]
    },
    {
      question: "血量低于五十时应该什么时候搜牌？",
      expected: ["六级小搜"]
    },
    {
      question: "什么时候可以从八级升到九级？",
      expected: ["核心四费主C", "两星主坦", "升九"]
    }
  ];
  const results = [];
  for (const acceptanceCase of cases) {
    const hits = await retriever.search(acceptanceCase.question, scope);
    assert.ok(hits.length > 0, `no hit for: ${acceptanceCase.question}`);
    const matching = hits.find((hit) => acceptanceCase.expected.every(
      (keyword) => String(hit.metadata?.content ?? "").includes(keyword)
    ));
    assert.ok(matching, `expected evidence missing for: ${acceptanceCase.question}`);
    assert.equal(matching.source, "youtube");
    assert.equal(matching.documentType, "video_guide");
    assert.equal(matching.patch, "17.7");
    assert.equal(matching.metadata?.namespace, "video_guides");
    assert.equal(matching.metadata?.sourceId, "testmix0001");
    assert.equal(matching.metadata?.videoVersion, "c9bff7b6c92711fba47a");
    assert.equal(matching.metadata?.isCurrentVersion, true);
    results.push({
      question: acceptanceCase.question,
      hitCount: hits.length,
      matchedId: matching.id,
      score: matching.score,
      content: matching.metadata.content,
      retrievalMode: matching.metadata.retrievalMode
    });
  }

  const wrongPatch = await retriever.search(cases[0].question, {
    ...scope,
    patch: "17.6"
  });
  const wrongSeason = await retriever.search(cases[0].question, {
    ...scope,
    seasonContextId: "set16-historical"
  });
  const missingPatch = await retriever.search(cases[0].question, {
    ...scope,
    patch: undefined
  });
  assert.equal(wrongPatch.length, 0, "old patch leaked into retrieval");
  assert.equal(wrongSeason.length, 0, "other season leaked into retrieval");
  assert.equal(missingPatch.length, 0, "video guide retrieval must require an explicit patch");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    database: filePath,
    providerModel: provider.model,
    cases: results,
    isolation: {
      wrongPatchHits: wrongPatch.length,
      wrongSeasonHits: wrongSeason.length,
      missingPatchHits: missingPatch.length
    }
  }, null, 2)}\n`);
} finally {
  store.close();
}
