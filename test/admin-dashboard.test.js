import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  aggregateAdminDashboardMetrics,
  estimateLlmCacheSavingsUsd,
  estimateLlmUsageCostUsd
} from "../src/core/admin-dashboard-metrics.js";
import { MemoryCacheStore } from "../src/data/cache-store.js";
import { SQLiteCacheStore } from "../src/data/sqlite-cache-store.js";
import { PostgresStore } from "../src/storage/postgres/postgres-store.js";
import {
  createSmallWindowHandler,
  createSmallWindowRuntimeAsync,
  handleAdminDashboardRequest
} from "../src/app/small-window-server.js";

function invokeHandler(handler, { method = "GET", url = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))] : []);
    req.method = method;
    req.url = url;
    req.headers = { host: "127.0.0.1:4173", ...headers };
    req.socket = { remoteAddress: "127.0.0.1" };

    const chunks = [];
    const resHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        resHeaders[String(name).toLowerCase()] = value;
      },
      getHeader(name) {
        return resHeaders[String(name).toLowerCase()];
      },
      writeHead(code, hdrs = {}) {
        this.statusCode = code;
        for (const [k, v] of Object.entries(hdrs)) {
          resHeaders[String(k).toLowerCase()] = v;
        }
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: this.statusCode,
          headers: resHeaders,
          text,
          json() {
            return JSON.parse(text);
          }
        });
      }
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("aggregateAdminDashboardMetrics computes UV/DAU, KV Cache savings, daily series, and breakdowns cleanly", () => {
  const nowMs = Date.parse("2026-11-28T12:00:00.000Z");
  const todayIso = "2026-11-28T09:30:00.000Z";
  const yesterdayIso = "2026-11-27T18:00:00.000Z";
  const oldIso = "2026-10-01T10:00:00.000Z";

  const result = aggregateAdminDashboardMetrics({
    nowMs,
    days: 7,
    queryEvents: [
      {
        queryId: "q1",
        seasonContextId: "set19-pbe",
        visitorScope: "visitor-a",
        conversationId: "c1",
        input: "热门阵容排行",
        resultType: "comp_rankings",
        cacheHit: true,
        llmUsed: false,
        durationMs: 42,
        createdAt: todayIso
      },
      {
        queryId: "q2",
        seasonContextId: "set19-pbe",
        visitorScope: "visitor-a",
        conversationId: "c1",
        input: "转职强度查询",
        resultType: "emblem_rankings",
        cacheHit: false,
        llmUsed: false,
        durationMs: 180,
        createdAt: todayIso
      },
      {
        queryId: "q3",
        seasonContextId: "set19-pbe",
        visitorScope: "visitor-b",
        conversationId: "c2",
        input: "卡莎带什么装备最强",
        resultType: "react_chat",
        cacheHit: false,
        llmUsed: true,
        llmModel: "deepseek-flash",
        durationMs: 2400,
        createdAt: yesterdayIso
      },
      {
        queryId: "q-old",
        seasonContextId: "set17-live",
        visitorScope: "visitor-old",
        conversationId: "c-old",
        input: "过时查询",
        resultType: "comp_rankings",
        cacheHit: false,
        llmUsed: false,
        durationMs: 100,
        createdAt: oldIso
      }
    ],
    llmEvents: [
      {
        eventId: "e1",
        seasonContextId: "set19-pbe",
        stage: "react_decision",
        model: "deepseek-flash",
        status: "ok",
        cachedInputTokens: 9000,
        uncachedInputTokens: 1000,
        outputTokens: 500,
        durationMs: 1200,
        createdAt: todayIso
      },
      {
        eventId: "e2",
        seasonContextId: "set19-pbe",
        stage: "conclusion",
        model: "deepseek-flash",
        status: "retry",
        cachedInputTokens: 0,
        uncachedInputTokens: 2000,
        outputTokens: 300,
        durationMs: 900,
        createdAt: yesterdayIso
      }
    ],
    feedbackEvents: [
      { seasonContextId: "set19-pbe", rating: "helpful", createdAt: todayIso },
      { seasonContextId: "set19-pbe", rating: "down", createdAt: yesterdayIso }
    ]
  });

  assert.equal(result.summary.totalQueries, 3);
  assert.equal(result.summary.uniqueVisitors, 2);
  assert.equal(result.summary.todayQueries, 2);
  assert.equal(result.summary.todayActiveVisitors, 1);
  assert.equal(result.summary.uniqueConversations, 2);
  assert.equal(result.summary.llmQueries, 1);
  assert.equal(result.summary.quickQueries, 2);
  assert.equal(result.summary.positiveFeedbacks, 1);
  assert.equal(result.summary.negativeFeedbacks, 1);
  assert.equal(result.dailySeries.length, 7);

  assert.equal(result.tokens.totalCalls, 2);
  assert.equal(result.tokens.okCalls, 1);
  assert.equal(result.tokens.retryCalls, 1);
  assert.equal(result.tokens.cachedInputTokens, 9000);
  assert.equal(result.tokens.uncachedInputTokens, 3000);
  assert.equal(result.tokens.outputTokens, 800);
  assert.equal(result.tokens.totalTokens, 12800);
  assert.equal(result.tokens.cacheHitRate, 0.75);

  const expectedCost = estimateLlmUsageCostUsd("deepseek-flash", {
    cachedInputTokens: 9000,
    uncachedInputTokens: 3000,
    outputTokens: 800
  });
  const expectedSavings = estimateLlmCacheSavingsUsd("deepseek-flash", {
    cachedInputTokens: 9000
  });
  assert.ok(Math.abs(result.tokens.estimatedCostUsd - expectedCost) < 1e-6);
  assert.ok(Math.abs(result.tokens.estimatedSavingsUsd - expectedSavings) < 1e-6);
  assert.equal(result.byModel.length, 1);
  assert.equal(result.byModel[0].model, "deepseek-flash");
  assert.equal(result.byStage.length, 2);
  assert.equal(result.recentQueries.length, 3);
  assert.match(result.recentQueries[0].visitorBadge, /^u_[a-f0-9]{6}$/);

  const empty = aggregateAdminDashboardMetrics({ nowMs, days: 3 });
  assert.equal(empty.summary.totalQueries, 0);
  assert.equal(empty.tokens.cacheHitRate, 0);
  assert.equal(empty.dailySeries.length, 3);
});

test("SQLiteCacheStore persists and queries llm_usage_events and query event summaries", async () => {
  const store = await SQLiteCacheStore.open({ filePath: ":memory:" });
  store.addQueryEvent({
    queryId: "sq-1",
    seasonContextId: "set19-pbe",
    visitorScope: "v1",
    input: "查看转职强度排行",
    resultType: "emblem_rankings",
    cacheHit: true,
    llmUsed: false,
    durationMs: 35
  });
  store.addLlmUsageEvent({
    seasonContextId: "set19-pbe",
    stage: "react_decision",
    model: "deepseek-flash",
    status: "ok",
    cachedInputTokens: 4000,
    uncachedInputTokens: 500,
    outputTokens: 200,
    estimatedCostUsd: 0.000207,
    durationMs: 850
  });

  const queries = store.listQueryEventSummaries({ seasonContextId: "set19-pbe" });
  const llms = store.listLlmUsageEvents({ seasonContextId: "set19-pbe" });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].resultType, "emblem_rankings");
  assert.equal(llms.length, 1);
  assert.equal(llms[0].cachedInputTokens, 4000);
  assert.equal(llms[0].model, "deepseek-flash");
});

test("PostgresStore degrades gracefully if llm_usage_events migration is not yet applied", async () => {
  const missingTableError = Object.assign(new Error('relation "llm_usage_events" does not exist'), { code: "42P01" });
  const pg = new PostgresStore({
    pool: {
      async query() {
        throw missingTableError;
      }
    }
  });
  const inserted = await pg.addLlmUsageEvent({ model: "deepseek-flash", stage: "react_decision" });
  const listed = await pg.listLlmUsageEvents({ limit: 10 });
  assert.equal(inserted, null);
  assert.deepEqual(listed, []);
});

test("Admin dashboard routes enforce admin auth and return telemetry + live runtime status", async () => {
  const cacheStore = new MemoryCacheStore();
  cacheStore.addQueryEvent({
    queryId: "q-http-1",
    seasonContextId: "set19-pbe",
    visitorScope: "visitor-http-1",
    conversationId: "conv-1",
    input: "热门阵容排行",
    resultType: "comp_rankings",
    cacheHit: true,
    llmUsed: false,
    durationMs: 25
  });

  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore,
    adminToken: "secret-admin-token",
    prewarmCatalog: false,
    llmProvider: "openai-compatible",
    llmEndpoint: "https://example.invalid/v1/chat/completions",
    llmModel: "deepseek-flash",
    llmApiKey: "dummy-key",
    reactDecisionFetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                schemaVersion: "react-action.v1",
                type: "finish",
                answer: "测试回答",
                evidenceIds: [],
                reasonCode: "direct_answer",
                narrative: null
              })
            }
          }],
          usage: {
            prompt_tokens: 5000,
            prompt_cache_hit_tokens: 4500,
            prompt_cache_miss_tokens: 500,
            completion_tokens: 250
          }
        };
      }
    })
  }, { ...process.env, TFT_AGENT_ADMIN_TOKEN: "secret-admin-token" });

  // Trigger a real reactDecisionProvider call to verify automatic onRequestLog -> addLlmUsageEvent wiring.
  await runtime.reactDecisionProvider({
    systemPrompt: "sys",
    messages: [{ role: "user", content: "hi" }],
    tools: []
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  const handler = createSmallWindowHandler({ runtime });

  const unauthPage = await invokeHandler(handler, { url: "/admin/dashboard" });
  assert.equal(unauthPage.statusCode, 401);
  assert.match(String(unauthPage.headers["www-authenticate"] ?? ""), /Basic realm="TFTClarity Admin"/);

  const unauthDirectHtml = await invokeHandler(handler, { url: "/admin-dashboard.html" });
  assert.equal(unauthDirectHtml.statusCode, 401);

  const unauthApi = await invokeHandler(handler, { url: "/api/admin/dashboard" });
  assert.equal(unauthApi.statusCode, 404);

  const basicAuth = `Basic ${Buffer.from("admin:secret-admin-token").toString("base64")}`;
  const authPage = await invokeHandler(handler, {
    url: "/admin/dashboard",
    headers: { authorization: basicAuth }
  });
  assert.equal(authPage.statusCode, 200);
  assert.match(authPage.text, /运营与 Token 看板/);

  const authApi = await invokeHandler(handler, {
    url: "/api/admin/dashboard?days=7",
    headers: { authorization: "Bearer secret-admin-token" }
  });
  assert.equal(authApi.statusCode, 200);
  const body = authApi.json();
  assert.equal(body.ok, true);
  assert.equal(body.dashboard.summary.totalQueries, 1);
  assert.equal(body.dashboard.summary.uniqueVisitors, 1);
  assert.equal(body.dashboard.tokens.totalCalls, 1);
  assert.equal(body.dashboard.tokens.cachedInputTokens, 4500);
  assert.equal(body.dashboard.tokens.uncachedInputTokens, 500);
  assert.equal(body.dashboard.tokens.outputTokens, 250);
  assert.equal(body.dashboard.tokens.cacheHitRate, 0.9);
  assert.ok(body.dashboard.runtime.concurrency.llm);
  assert.ok(body.dashboard.runtime.modelTiering);

  const direct = await handleAdminDashboardRequest(runtime, { days: 7 });
  assert.equal(direct.ok, true);
  assert.equal(direct.dashboard.byModel[0].model, "deepseek-flash");

  runtime.eventLoopMonitor?.disable?.();
});
