import { createHash } from "node:crypto";

// Reference USD per 1M tokens (DeepSeek Flash official off-peak rates; other models reference public list prices).
export const ADMIN_MODEL_PRICING_PER_1M = Object.freeze({
  "deepseek-v4-flash": { input: 0.15, cachedInput: 0.003, output: 0.60 },
  "deepseek-flash": { input: 0.15, cachedInput: 0.003, output: 0.60 },
  "deepseek-v4-pro": { input: 0.55, cachedInput: 0.055, output: 2.19 },
  "deepseek-chat": { input: 0.27, cachedInput: 0.07, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, cachedInput: 0.14, output: 2.19 },
  "qwen-turbo-latest": { input: 0.05, cachedInput: 0.01, output: 0.20 },
  "qwen3-flash": { input: 0.05, cachedInput: 0.01, output: 0.20 },
  "gemini-2.5-flash-lite": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gemini-2.5-flash": { input: 0.15, cachedInput: 0.0375, output: 0.60 },
  "gpt-4.1-nano": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gpt-4.1-mini": { input: 0.40, cachedInput: 0.10, output: 1.60 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.00 },
  "glm-4-flash": { input: 0.014, cachedInput: 0.014, output: 0.014 }
});

export const USD_TO_CNY_RATE = 7.25;

export function pricingForModel(model) {
  const key = String(model ?? "").trim().toLowerCase();
  if (ADMIN_MODEL_PRICING_PER_1M[key]) return ADMIN_MODEL_PRICING_PER_1M[key];
  if (key.includes("deepseek") && key.includes("flash")) return ADMIN_MODEL_PRICING_PER_1M["deepseek-flash"];
  if (key.includes("deepseek") && key.includes("pro")) return ADMIN_MODEL_PRICING_PER_1M["deepseek-v4-pro"];
  if (key.includes("deepseek")) return ADMIN_MODEL_PRICING_PER_1M["deepseek-chat"];
  if (key.includes("qwen") && (key.includes("turbo") || key.includes("flash"))) return ADMIN_MODEL_PRICING_PER_1M["qwen-turbo-latest"];
  if (key.includes("gemini") && key.includes("lite")) return ADMIN_MODEL_PRICING_PER_1M["gemini-2.5-flash-lite"];
  if (key.includes("glm") && key.includes("flash")) return ADMIN_MODEL_PRICING_PER_1M["glm-4-flash"];
  return ADMIN_MODEL_PRICING_PER_1M["deepseek-flash"];
}

export function estimateLlmUsageCostUsd(model, usage = {}) {
  const rate = pricingForModel(model);
  const cached = Math.max(0, Number(usage.cachedInputTokens ?? usage.cached_input_tokens ?? 0) || 0);
  const uncached = Math.max(0, Number(usage.uncachedInputTokens ?? usage.uncached_input_tokens ?? 0) || 0);
  const output = Math.max(0, Number(usage.outputTokens ?? usage.output_tokens ?? 0) || 0);
  return ((cached * rate.cachedInput) + (uncached * rate.input) + (output * rate.output)) / 1_000_000;
}

export function estimateLlmCacheSavingsUsd(model, usage = {}) {
  const rate = pricingForModel(model);
  const cached = Math.max(0, Number(usage.cachedInputTokens ?? usage.cached_input_tokens ?? 0) || 0);
  return Math.max(0, cached * (rate.input - rate.cachedInput)) / 1_000_000;
}

function dateKeyFromIso(value, fallbackMs) {
  const ms = Date.parse(String(value ?? ""));
  return new Date(Number.isFinite(ms) ? ms : fallbackMs).toISOString().slice(0, 10);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

function shortVisitorBadge(scope) {
  const value = String(scope ?? "local");
  if (value === "local") return "local";
  return `u_${createHash("sha256").update(value).digest("hex").slice(0, 6)}`;
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(6));
}

export function aggregateAdminDashboardMetrics({
  queryEvents = [],
  llmEvents = [],
  feedbackEvents = [],
  days = 7,
  seasonContextId = null,
  nowMs = Date.now()
} = {}) {
  const safeDays = Math.max(1, Math.min(90, Number.isInteger(Number(days)) ? Number(days) : 7));
  const sinceMs = nowMs - safeDays * 24 * 60 * 60 * 1000;
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);

  const inRange = (iso) => {
    const ms = Date.parse(String(iso ?? ""));
    return Number.isFinite(ms) && ms >= sinceMs;
  };
  const matchesSeason = (entrySeason) => !seasonContextId || seasonContextId === "all"
    || String(entrySeason ?? "") === String(seasonContextId);

  const queries = queryEvents.filter((entry) => inRange(entry.createdAt) && matchesSeason(entry.seasonContextId));
  const llm = llmEvents.filter((entry) => inRange(entry.createdAt) && matchesSeason(entry.seasonContextId));
  const feedbacks = feedbackEvents.filter((entry) => inRange(entry.createdAt) && matchesSeason(entry.seasonContextId));

  // Pre-seed continuous daily buckets so charts have no missing date gaps.
  const dailyMap = new Map();
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const key = new Date(nowMs - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dailyMap.set(key, {
      date: key,
      queries: 0,
      visitors: new Set(),
      llmQueries: 0,
      llmCalls: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    });
  }

  const allVisitors = new Set();
  const todayVisitors = new Set();
  const conversations = new Set();
  const durations = [];
  const byResultTypeMap = new Map();
  const bySeasonMap = new Map();
  let todayQueries = 0;
  let todayLlmQueries = 0;
  let llmQueries = 0;
  let cacheHits = 0;

  for (const event of queries) {
    const visitor = String(event.visitorScope ?? "local");
    const isAiQuery = Boolean(event.llmUsed)
      || event.resultType === "react_chat_result"
      || event.resultType === "react_chat"
      || event.resultType === "coach_answer";
    allVisitors.add(visitor);
    if (event.conversationId) conversations.add(String(event.conversationId));
    if (event.cacheHit) cacheHits += 1;
    if (isAiQuery) llmQueries += 1;
    const duration = Number(event.durationMs);
    if (Number.isFinite(duration) && duration >= 0) durations.push(duration);

    const dayKey = dateKeyFromIso(event.createdAt, nowMs);
    if (dayKey === todayKey) {
      todayQueries += 1;
      todayVisitors.add(visitor);
      if (isAiQuery) todayLlmQueries += 1;
    }
    const bucket = dailyMap.get(dayKey);
    if (bucket) {
      bucket.queries += 1;
      bucket.visitors.add(visitor);
      if (isAiQuery) bucket.llmQueries += 1;
    }

    const rType = String(event.resultType || "other");
    byResultTypeMap.set(rType, (byResultTypeMap.get(rType) ?? 0) + 1);

    const sKey = String(event.seasonContextId || "unknown");
    const sRow = bySeasonMap.get(sKey) ?? { seasonContextId: sKey, queries: 0, visitors: new Set() };
    sRow.queries += 1;
    sRow.visitors.add(visitor);
    bySeasonMap.set(sKey, sRow);
  }

  const byModelMap = new Map();
  const byStageMap = new Map();
  let totalCalls = 0;
  let okCalls = 0;
  let retryCalls = 0;
  let errorCalls = 0;
  let totalCached = 0;
  let totalUncached = 0;
  let totalOutput = 0;
  let totalCostUsd = 0;
  let totalSavingsUsd = 0;
  let todayCostUsd = 0;
  let todayTotalTokens = 0;

  for (const event of llm) {
    const model = String(event.model || "unknown");
    const stage = String(event.stage || "react_decision");
    const status = String(event.status || "ok");
    const cached = Math.max(0, Number(event.cachedInputTokens ?? 0) || 0);
    const uncached = Math.max(0, Number(event.uncachedInputTokens ?? 0) || 0);
    const output = Math.max(0, Number(event.outputTokens ?? 0) || 0);
    const costUsd = Number.isFinite(Number(event.estimatedCostUsd)) && Number(event.estimatedCostUsd) > 0
      ? Number(event.estimatedCostUsd)
      : estimateLlmUsageCostUsd(model, { cachedInputTokens: cached, uncachedInputTokens: uncached, outputTokens: output });
    const savingsUsd = estimateLlmCacheSavingsUsd(model, { cachedInputTokens: cached });

    totalCalls += 1;
    if (status === "ok") okCalls += 1;
    else if (status === "retry") retryCalls += 1;
    else errorCalls += 1;

    totalCached += cached;
    totalUncached += uncached;
    totalOutput += output;
    totalCostUsd += costUsd;
    totalSavingsUsd += savingsUsd;

    const dayKey = dateKeyFromIso(event.createdAt, nowMs);
    if (dayKey === todayKey) {
      todayCostUsd += costUsd;
      todayTotalTokens += cached + uncached + output;
    }
    const bucket = dailyMap.get(dayKey);
    if (bucket) {
      bucket.llmCalls += 1;
      bucket.cachedInputTokens += cached;
      bucket.uncachedInputTokens += uncached;
      bucket.outputTokens += output;
      bucket.estimatedCostUsd += costUsd;
    }

    const mRow = byModelMap.get(model) ?? {
      model,
      calls: 0,
      retries: 0,
      errors: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      durationSumMs: 0,
      durationCount: 0,
      estimatedCostUsd: 0
    };
    mRow.calls += 1;
    if (status === "retry") mRow.retries += 1;
    else if (status !== "ok") mRow.errors += 1;
    mRow.cachedInputTokens += cached;
    mRow.uncachedInputTokens += uncached;
    mRow.outputTokens += output;
    const dur = Number(event.durationMs);
    if (Number.isFinite(dur) && dur >= 0) {
      mRow.durationSumMs += dur;
      mRow.durationCount += 1;
    }
    mRow.estimatedCostUsd += costUsd;
    byModelMap.set(model, mRow);

    const stRow = byStageMap.get(stage) ?? {
      stage,
      calls: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    };
    stRow.calls += 1;
    stRow.cachedInputTokens += cached;
    stRow.uncachedInputTokens += uncached;
    stRow.outputTokens += output;
    stRow.estimatedCostUsd += costUsd;
    byStageMap.set(stage, stRow);
  }

  let positiveFeedbacks = 0;
  let negativeFeedbacks = 0;
  for (const fb of feedbacks) {
    if (fb.rating === "helpful" || fb.rating === "up" || fb.rating === "positive") positiveFeedbacks += 1;
    else if (fb.rating === "unhelpful" || fb.rating === "down" || fb.rating === "negative") negativeFeedbacks += 1;
  }

  const totalInput = totalCached + totalUncached;
  const totalQueries = queries.length;
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((acc, v) => acc + v, 0) / durations.length)
    : 0;

  const dailySeries = [...dailyMap.values()].map((row) => ({
    date: row.date,
    queries: row.queries,
    uniqueVisitors: row.visitors.size,
    llmQueries: row.llmQueries,
    llmCalls: row.llmCalls,
    cachedInputTokens: row.cachedInputTokens,
    uncachedInputTokens: row.uncachedInputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.cachedInputTokens + row.uncachedInputTokens + row.outputTokens,
    estimatedCostUsd: roundUsd(row.estimatedCostUsd),
    estimatedCostCny: Number((row.estimatedCostUsd * USD_TO_CNY_RATE).toFixed(4))
  }));

  const byModel = [...byModelMap.values()]
    .map((row) => {
      const inputSum = row.cachedInputTokens + row.uncachedInputTokens;
      return {
        model: row.model,
        calls: row.calls,
        retries: row.retries,
        errors: row.errors,
        cachedInputTokens: row.cachedInputTokens,
        uncachedInputTokens: row.uncachedInputTokens,
        outputTokens: row.outputTokens,
        totalTokens: inputSum + row.outputTokens,
        cacheHitRate: inputSum > 0 ? Number((row.cachedInputTokens / inputSum).toFixed(4)) : 0,
        avgDurationMs: row.durationCount > 0 ? Math.round(row.durationSumMs / row.durationCount) : 0,
        estimatedCostUsd: roundUsd(row.estimatedCostUsd),
        estimatedCostCny: Number((row.estimatedCostUsd * USD_TO_CNY_RATE).toFixed(4))
      };
    })
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.calls - a.calls);

  const byStage = [...byStageMap.values()]
    .map((row) => ({
      stage: row.stage,
      calls: row.calls,
      totalTokens: row.cachedInputTokens + row.uncachedInputTokens + row.outputTokens,
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
      estimatedCostCny: Number((row.estimatedCostUsd * USD_TO_CNY_RATE).toFixed(4))
    }))
    .sort((a, b) => b.calls - a.calls);

  const byResultType = [...byResultTypeMap.entries()]
    .map(([resultType, count]) => ({
      resultType,
      count,
      share: totalQueries > 0 ? Number((count / totalQueries).toFixed(4)) : 0
    }))
    .sort((a, b) => b.count - a.count);

  const bySeason = [...bySeasonMap.values()]
    .map((row) => ({
      seasonContextId: row.seasonContextId,
      queries: row.queries,
      uniqueVisitors: row.visitors.size,
      share: totalQueries > 0 ? Number((row.queries / totalQueries).toFixed(4)) : 0
    }))
    .sort((a, b) => b.queries - a.queries);

  const recentQueries = [...queries]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, 15)
    .map((event) => ({
      createdAt: event.createdAt ?? null,
      seasonContextId: event.seasonContextId ?? null,
      visitorBadge: shortVisitorBadge(event.visitorScope),
      resultType: event.resultType ?? "other",
      input: String(event.input ?? "").slice(0, 80),
      cacheHit: Boolean(event.cacheHit),
      llmUsed: Boolean(event.llmUsed),
      llmModel: event.llmModel ?? null,
      durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null
    }));

  return {
    window: {
      days: safeDays,
      seasonContextId: seasonContextId || "all",
      since: new Date(sinceMs).toISOString(),
      generatedAt: new Date(nowMs).toISOString()
    },
    summary: {
      totalQueries,
      uniqueVisitors: allVisitors.size,
      todayQueries,
      todayActiveVisitors: todayVisitors.size,
      todayLlmQueries,
      uniqueConversations: conversations.size,
      avgQueriesPerVisitor: allVisitors.size > 0 ? Number((totalQueries / allVisitors.size).toFixed(2)) : 0,
      llmQueries,
      quickQueries: Math.max(0, totalQueries - llmQueries),
      cacheHitRate: totalQueries > 0 ? Number((cacheHits / totalQueries).toFixed(4)) : 0,
      avgDurationMs,
      p95DurationMs: percentile(durations, 95),
      totalFeedbacks: feedbacks.length,
      positiveFeedbacks,
      negativeFeedbacks
    },
    tokens: {
      totalCalls,
      okCalls,
      retryCalls,
      errorCalls,
      cachedInputTokens: totalCached,
      uncachedInputTokens: totalUncached,
      totalInputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      cacheHitRate: totalInput > 0 ? Number((totalCached / totalInput).toFixed(4)) : 0,
      estimatedCostUsd: roundUsd(totalCostUsd),
      estimatedCostCny: Number((totalCostUsd * USD_TO_CNY_RATE).toFixed(4)),
      estimatedSavingsUsd: roundUsd(totalSavingsUsd),
      estimatedSavingsCny: Number((totalSavingsUsd * USD_TO_CNY_RATE).toFixed(4)),
      todayEstimatedCostUsd: roundUsd(todayCostUsd),
      todayEstimatedCostCny: Number((todayCostUsd * USD_TO_CNY_RATE).toFixed(4)),
      todayTotalTokens
    },
    dailySeries,
    byModel,
    byStage,
    byResultType,
    bySeason,
    recentQueries
  };
}
