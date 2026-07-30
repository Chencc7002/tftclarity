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
  ?? ".cache/youtube-acceptance/youtube-live-v5.sqlite"
);
const provider = createEmbeddingProviderFromConfig(
  resolveEmbeddingProviderConfig({}, process.env)
);
assert.equal(provider.isAvailable(), true, "real embedding provider is unavailable");

const store = await SQLiteSemanticDocumentStore.open({ filePath });
try {
  const retriever = new HybridSemanticRetriever(
    new EmbeddingSemanticRetriever({ provider, store }),
    { lexicalRetriever: new TfidfSemanticRetriever({ store }) }
  );
  const scope = {
    seasonContextId: "set17-live",
    documentTypes: ["video_guide"],
    patch: "17.7",
    locale: "en",
    // Match the production KnowledgeRetriever default. A four-result smoke
    // under-represents the candidate pool once the full acceptance corpus is
    // indexed and can hide otherwise valid evidence behind unrelated videos.
    topK: 8,
    minimumScore: 0
  };
  const cases = [
    {
      question: "What items reduce enemy armor and magic resistance?",
      expected: ["shred", "sunder"]
    },
    {
      question: "How early should I build anti-heal?",
      expected: ["stage 4", "stage 5"]
    },
    {
      question: "Why should I fully itemize my main tank?",
      expected: ["multiply with HP", "main tank"]
    },
    {
      question: "Where should utility items go in the late game?",
      expected: ["secondary carry", "three items"]
    }
  ];
  const results = [];
  for (const acceptanceCase of cases) {
    const hits = await retriever.search(acceptanceCase.question, scope);
    const matching = hits.find((hit) => acceptanceCase.expected.every(
      (keyword) => String(hit.metadata?.content ?? "").toLowerCase().includes(
        keyword.toLowerCase()
      )
    ));
    assert.ok(matching, `expected evidence missing for: ${acceptanceCase.question}`);
    assert.equal(matching.source, "youtube");
    assert.equal(matching.documentType, "video_guide");
    assert.equal(matching.patch, "17.7");
    assert.equal(matching.metadata?.namespace, "video_guides");
    assert.equal(matching.metadata?.sourceId, "BpFL4kmfp1Q");
    assert.equal(matching.metadata?.videoVersion, "69688f6117e4d18f63d3");
    assert.equal(matching.metadata?.isCurrentVersion, true);
    assert.equal(matching.metadata?.aiGenerated, true);
    assert.equal(
      matching.metadata?.contentOrigin,
      "ai_generated_transcript_summary"
    );
    assert.equal(
      matching.metadata?.reviewStatus,
      "ai_generated_unreviewed"
    );
    assert.match(
      String(matching.metadata?.contentDisclosure ?? ""),
      /AI-generated/i
    );
    results.push({
      question: acceptanceCase.question,
      hitCount: hits.length,
      matchedId: matching.id,
      score: matching.score,
      content: matching.metadata.content,
      retrievalMode: matching.metadata.retrievalMode,
      aiGenerated: matching.metadata.aiGenerated,
      reviewStatus: matching.metadata.reviewStatus
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
  const wrongLocale = await retriever.search(cases[0].question, {
    ...scope,
    locale: "zh-CN"
  });
  const missingPatch = await retriever.search(cases[0].question, {
    ...scope,
    patch: undefined
  });
  const historicalQuery = "霞在 Shredder 阵容中的核心装备是什么？";
  const historicalHits = await retriever.search(historicalQuery, {
    ...scope,
    seasonContextId: "set3-historical",
    patch: "10.11"
  });
  const historicalMatch = historicalHits.find((hit) => (
    hit.metadata?.sourceId === "ag_FVgVScMk"
    && /xayah/i.test(String(hit.metadata?.content ?? ""))
    && /last whisper/i.test(String(hit.metadata?.content ?? ""))
  ));
  const currentScopeXayahHits = await retriever.search(historicalQuery, scope);
  assert.ok(historicalMatch, "historical Xayah evidence is not retrievable");
  assert.equal(
    currentScopeXayahHits.some(
      (hit) => hit.metadata?.sourceId === "ag_FVgVScMk"
    ),
    false,
    "historical video leaked into the current season scope"
  );
  assert.equal(wrongPatch.length, 0, "old patch leaked into retrieval");
  assert.equal(wrongSeason.length, 0, "other season leaked into retrieval");
  assert.equal(wrongLocale.length, 0, "other locale leaked into retrieval");
  assert.equal(missingPatch.length, 0, "video retrieval requires explicit patch");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    database: filePath,
    providerModel: provider.model,
    cases: results,
    isolation: {
      wrongPatchHits: wrongPatch.length,
      wrongSeasonHits: wrongSeason.length,
      wrongLocaleHits: wrongLocale.length,
      missingPatchHits: missingPatch.length,
      historicalHitCount: historicalHits.length,
      historicalMatchedId: historicalMatch.id,
      historicalLeaksIntoCurrentScope: currentScopeXayahHits.filter(
        (hit) => hit.metadata?.sourceId === "ag_FVgVScMk"
      ).length
    }
  }, null, 2)}\n`);
} finally {
  store.close();
}
