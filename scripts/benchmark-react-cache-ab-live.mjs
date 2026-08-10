import { randomUUID } from "node:crypto";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStructuredParserConfig } from "../src/llm/chat-structured-parser.js";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowServer
} from "../src/app/small-window-server.js";

loadLocalEnvironment();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeIdleConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function captureProductionRequest() {
  const requests = [];
  const captureProvider = async (request) => {
    requests.push(structuredClone(request));
    return {
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "缓存基准请求已采集。",
      evidenceIds: [],
      reasonCode: "direct_answer",
      narrative: null
    };
  };
  captureProvider.providerKind = "benchmark_capture";
  captureProvider.model = "benchmark-capture";

  const runtime = await createSmallWindowRuntimeAsync({
    prewarmCatalog: false,
    reactDecisionProvider: captureProvider
  });
  const server = createSmallWindowServer({ runtime });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/react-chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({
        input: "请简短说明这是一次缓存结构基准测试。",
        conversationId: `react-cache-ab-capture-${randomUUID()}`
      })
    });
    await response.text();
    if (!response.ok || requests.length !== 1) {
      throw new Error(`failed to capture one production ReAct request: HTTP ${response.status}, requests=${requests.length}`);
    }
    return requests[0];
  } finally {
    await close(server);
  }
}

function benchmarkEvidence(index, toolName) {
  const evidenceId = `benchmark-evidence-${index}`;
  const value = {
    benchmarkStep: index,
    results: Array.from({ length: 12 }, (_, resultIndex) => ({
      id: `${toolName}-${index}-${resultIndex}`,
      name: `基准结果${resultIndex + 1}`,
      sampleSize: 12000 - (resultIndex * 317),
      averagePlacement: Number((3.1 + resultIndex / 20).toFixed(2)),
      top4Rate: Number((0.7 - resultIndex / 100).toFixed(4))
    }))
  };
  const evidence = {
    evidenceId,
    toolName,
    type: "benchmark_tool_observation",
    source: "cache_ab_fixture",
    updatedAt: "2026-08-10T00:00:00.000Z",
    temporalStatus: "current",
    value
  };
  return { evidenceId, evidence, value };
}

function buildRounds(capturedRequest, roundCount = 5) {
  const baseState = structuredClone(capturedRequest.state ?? {});
  const toolCatalog = structuredClone(capturedRequest.toolCatalog ?? []);
  if (toolCatalog.length === 0) throw new Error("production ReAct tool catalog is empty");

  const transcript = structuredClone(baseState.transcript ?? []);
  const observations = [];
  const evidence = structuredClone(baseState.evidence ?? []);
  const rounds = [];
  for (let index = 0; index < roundCount; index += 1) {
    rounds.push({
      schemaVersion: "react-decision-request.v1",
      state: {
        ...structuredClone(baseState),
        question: "这是 ReAct KV Cache A/B 基准。根据当前上下文返回一个合法、简短的 react-action.v1。",
        iteration: index + 1,
        decisionCount: index,
        toolCallCount: index,
        remainingBudget: { decisions: roundCount + 3 - index, toolCalls: null },
        observations: structuredClone(observations),
        evidence: structuredClone(evidence),
        transcript: structuredClone(transcript),
        warnings: index >= 3 ? ["benchmark_warning_visible"] : []
      },
      toolCatalog
    });
    if (index === roundCount - 1) break;

    const toolName = toolCatalog[index % toolCatalog.length].name;
    const decision = {
      schemaVersion: "react-action.v1",
      type: "call_tool",
      tool: toolName,
      arguments: {},
      purposeCode: "retrieve_supporting_knowledge"
    };
    const fixture = benchmarkEvidence(index + 1, toolName);
    const observation = {
      type: "tool_result",
      tool: toolName,
      status: "ok",
      toolCallId: `benchmark-call-${index + 1}`,
      evidenceId: fixture.evidenceId,
      evidenceStatus: "valid",
      value: fixture.value,
      evidence: fixture.evidence
    };
    transcript.push({ type: "decision", value: decision });
    transcript.push({ type: "observation", value: observation });
    transcript.push({
      type: "runtime_state",
      value: {
        iteration: index + 2,
        decisionCount: index + 1,
        toolCallCount: index + 1,
        remainingBudget: { decisions: roundCount + 2 - index, toolCalls: null },
        warnings: index >= 2 ? ["benchmark_warning_visible"] : []
      }
    });
    observations.push(observation);
    evidence.push(fixture.evidence);
  }
  return rounds;
}

function summarizeUsage(logs) {
  const requests = logs.filter((entry) => entry?.usage);
  const totals = requests.reduce((result, entry) => {
    result.cachedInputTokens += Number(entry.usage.cachedInputTokens ?? 0);
    result.uncachedInputTokens += Number(entry.usage.uncachedInputTokens ?? 0);
    result.outputTokens += Number(entry.usage.outputTokens ?? 0);
    return result;
  }, { cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
  const totalInputTokens = totals.cachedInputTokens + totals.uncachedInputTokens;
  return {
    requests: requests.length,
    successfulRequests: requests.filter((entry) => entry.status === "ok").length,
    retryRequests: requests.filter((entry) => entry.status === "retry").length,
    failedRequests: requests.filter((entry) => entry.status === "error").length,
    ...totals,
    totalInputTokens,
    cacheHitRate: totalInputTokens > 0 ? totals.cachedInputTokens / totalInputTokens : null
  };
}

async function runArm({ config, layout, namespace, rounds }) {
  const logs = [];
  const provider = createReactDecisionProvider({
    ...config,
    timeoutMs: 30_000,
    maxTokens: 500,
    thinkingMode: "disabled",
    messageLayout: layout,
    cacheNamespace: namespace,
    onRequestLog: (entry) => logs.push(entry)
  });
  const errors = [];
  const logsByRound = [];
  for (let index = 0; index < rounds.length; index += 1) {
    const logStart = logs.length;
    try {
      await provider(rounds[index], { runId: `${namespace}-${index + 1}` });
    } catch (error) {
      errors.push(String(error?.message ?? error));
    }
    logsByRound.push(logs.slice(logStart));
    await wait(index === 0 ? 1_500 : 350);
  }
  const usage = summarizeUsage(logs);
  const followupUsage = summarizeUsage(logsByRound.slice(1).flat());
  return {
    layout: provider.messageLayout,
    rounds: rounds.length,
    usage,
    followupUsage,
    errors
  };
}

const config = resolveStructuredParserConfig({}, process.env);
if (!config.enabled) throw new Error("live LLM configuration is unavailable");

const capturedRequest = await captureProductionRequest();
const rounds = buildRounds(capturedRequest);
const benchmarkId = randomUUID().replaceAll("-", "");
const legacy = await runArm({
  config,
  layout: "legacy_full_state",
  namespace: `aaaaaaaa-${benchmarkId}`,
  rounds
});
const appendOnly = await runArm({
  config,
  layout: "append_only",
  namespace: `bbbbbbbb-${benchmarkId}`,
  rounds
});

const legacyRate = legacy.usage.cacheHitRate ?? 0;
const appendRate = appendOnly.usage.cacheHitRate ?? 0;
const result = {
  ok: legacy.errors.length === 0 && appendOnly.errors.length === 0,
  schemaVersion: "react-cache-ab-live.v1",
  model: config.model,
  roundsPerArm: rounds.length,
  productionToolCount: capturedRequest.toolCatalog?.length ?? 0,
  isolation: "distinct_equal_length_namespace_at_first_system_token",
  legacy,
  appendOnly,
  comparison: {
    cacheHitRatePercentagePointGain: (appendRate - legacyRate) * 100,
    cacheHitRateMultiplier: legacyRate > 0 ? appendRate / legacyRate : null,
    uncachedInputTokenReduction: legacy.usage.uncachedInputTokens > 0
      ? 1 - (appendOnly.usage.uncachedInputTokens / legacy.usage.uncachedInputTokens)
      : null
  }
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
