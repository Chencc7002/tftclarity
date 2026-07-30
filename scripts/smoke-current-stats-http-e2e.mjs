import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import "dotenv/config";

import { startSmallWindowServer } from "../src/app/small-window-server.js";

const outputPath = resolve(
  process.env.CURRENT_STATS_HTTP_E2E_REPORT
    ?? ".cache/current-stats/http-e2e-report.json"
);
const service = await startSmallWindowServer({
  host: "127.0.0.1",
  port: 0,
  prewarmCatalog: false,
  knowledgeMode: "on",
  embeddingMode: "on",
  coachMode: "off",
  agentRunBudget: {
    deadlineMs: 120_000,
    maxSteps: 100,
    maxToolCalls: 100,
    maxRetriesPerTool: 3,
    maxEvents: 1000
  },
  explorerTimeoutMs: 30_000,
  catalogTimeoutMs: 30_000,
  compsTimeoutMs: 30_000,
  compRankingsTimeoutMs: 30_000,
  semanticIndexPath: resolve(".cache/semantic-index.sqlite"),
  cacheStoreType: "json",
  cachePath: resolve(".cache/current-stats/http-e2e-cache.json")
});

async function ask(input, body = {}) {
  const response = await fetch(`${service.url}api/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, refresh: true, ...body })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `${input}: HTTP ${response.status} ${payload?.error ?? ""}`);
  assert.equal(payload.ok, true, `${input}: ${payload?.error ?? "request failed"}`);
  return payload;
}

function summarize(input, payload) {
  return {
    input,
    type: payload.type,
    mode: payload.mode,
    scopes: payload.answerModeRoute?.retrievalScopes ?? [],
    structuredSource: payload.queryResult?.source ?? payload.source?.provider ?? null,
    structuredCandidates: payload.queryResult?.candidates?.length ?? 0,
    currentStatsScope: payload.currentStatsScope ?? null,
    currentRecommendation: payload.assistantResponse?.content?.currentRecommendation ?? null,
    finalAnswer: payload.assistantResponse?.text ?? payload.text ?? payload.answer?.summary ?? null,
    currentStatsEvidence: (payload.knowledgeEvidence ?? [])
      .filter((record) => record.namespace === "current_stats")
      .map((record) => ({
        evidenceId: record.evidenceId,
        documentType: record.documentType,
        patch: record.patch,
        rank: record.rank,
        timeWindow: record.timeWindow,
        region: record.region,
        generatedAt: record.generatedAt
      }))
  };
}

try {
  const questions = [
    "当前环境怎么样？",
    "当前有什么稳定阵容？",
    "霞最好的装备是什么，为什么？"
  ];
  const payloads = [];
  for (const question of questions) payloads.push(await ask(question));
  const results = payloads.map((payload, index) => summarize(questions[index], payload));
  const unavailableInput = "当前环境怎么样？";
  const unavailablePayload = await ask(unavailableInput, {
    preferences: { rankFilter: ["GOLD"], days: 30 }
  });
  const unavailableScope = summarize(unavailableInput, unavailablePayload);

  assert.equal(results[0].mode, "rag");
  assert.equal(results[1].mode, "hybrid");
  for (const result of results.slice(0, 2)) {
    assert.ok(result.scopes.includes("current_stats"));
    assert.equal(result.currentStatsScope?.status, "available");
    assert.ok(result.currentStatsEvidence.length > 0);
    assert.ok(result.currentStatsEvidence.every((record) => (
      record.patch
      && record.rank
      && record.timeWindow
      && record.region
      && record.generatedAt
    )));
  }
  const exact = results[2];
  assert.equal(exact.mode, "hybrid");
  assert.equal(exact.scopes.includes("current_stats"), false);
  assert.equal(String(exact.structuredSource).toLowerCase(), "metatft");
  assert.equal(exact.currentStatsEvidence.length, 0);
  if (exact.structuredCandidates > 0) {
    assert.ok(exact.currentRecommendation?.evidenceId);
  } else {
    assert.match(exact.finalAnswer, /MetaTFT 结构化 QueryResult/);
    assert.match(exact.finalAnswer, /没有满足样本门槛和筛选条件的候选/);
  }
  assert.equal(unavailableScope.currentStatsScope?.status, "scope_unavailable");
  assert.equal(unavailableScope.currentStatsEvidence.length, 0);
  assert.ok(unavailableScope.currentStatsScope?.availableScopes?.length > 0);

  const report = {
    schemaVersion: "current_stats_http_e2e_report.v1",
    ok: true,
    testedAt: new Date().toISOString(),
    serviceUrl: service.url,
    results,
    unavailableScope
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await new Promise((resolveClose) => service.server.close(resolveClose));
  service.runtime.semanticDocumentStore?.close?.();
  service.runtime.cacheStore?.close?.();
}
