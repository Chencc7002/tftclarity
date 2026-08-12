import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowServer,
  prewarmSmallWindowCatalog
} from "../src/app/small-window-server.js";

loadLocalEnvironment();

const cases = [
  {
    id: "direct_answer",
    input: "ReAct 和固定执行计划有什么区别？",
    expectedTools: [],
    expectedTermination: new Set(["completed"])
  },
  {
    id: "entity_catalog_query",
    input: "当前版本暗星羁绊的效果是什么？只根据官方目录和详情工具回答。",
    expectedTools: ["entity_catalog_query"],
    expectedToolSequences: [
      ["entity_catalog_query"],
      ["entity_catalog_query", "trait_details"]
    ],
    expectedTermination: new Set(["completed"])
  },
  {
    id: "four_tool_loop",
    input: "列出暗星羁绊中的四费棋子，并分别告诉我他们当前常见的三件出装，只根据工具结果回答。",
    expectedTools: ["entity_catalog_query", "entity_catalog_query", "unit_builds_batch", "item_details_batch"],
    expectedToolSequences: [
      ["entity_catalog_query", "entity_catalog_query", "unit_builds_batch", "item_details_batch"],
      ["entity_catalog_query", "trait_details", "entity_catalog_query", "unit_builds_batch", "item_details_batch"]
    ],
    expectedTermination: new Set(["completed", "insufficient_evidence", "finish_validation_fallback"])
  },
  {
    id: "composition_member_statistics",
    input: "在暗星·科加斯阵容中，最常见的非暗星外援棋子有哪些？只根据当前统计工具回答。",
    expectedTools: ["comps_rankings"],
    expectedToolSequences: [
      ["comps_rankings"],
      ["comps_rankings", "composition_member_statistics"]
    ],
    expectedTermination: new Set(["completed", "insufficient_evidence"])
  }
];

function summarizeEvidence(entries = []) {
  return entries.map((entry) => ({
    evidenceId: entry.evidenceId,
    tool: entry.toolName,
    type: entry.type,
    updatedAt: entry.updatedAt,
    resultCount: Array.isArray(entry.value?.results) ? entry.value.results.length : null,
    entityIds: Array.isArray(entry.value?.results)
      ? entry.value.results.slice(0, 8).map((value) => value.apiName ?? value.id ?? null).filter(Boolean)
      : []
  }));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSubsequence(expected, actual) {
  let expectedIndex = 0;
  for (const value of actual) {
    if (value === expected[expectedIndex]) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}

function summarizeUsage(entries = []) {
  const successful = entries.filter((entry) => (
    entry?.requestKind === "react_decision"
    && ["ok", "retry", "error"].includes(entry?.status)
    && entry?.usage
  ));
  const totals = successful.reduce((result, entry) => {
    result.requests += Number(entry.usage?.requests ?? 1);
    result.successfulRequests += Number(
      entry.usage?.successfulRequests ?? (entry.status === "ok" ? 1 : 0)
    );
    result.retryRequests += Number(
      entry.usage?.retryRequests ?? (entry.status === "retry" ? 1 : 0)
    );
    result.failedRequests += Number(
      entry.usage?.failedRequests ?? (entry.status === "error" ? 1 : 0)
    );
    result.cachedInputTokens += Number(entry.usage?.cachedInputTokens ?? 0);
    result.uncachedInputTokens += Number(entry.usage?.uncachedInputTokens ?? 0);
    result.outputTokens += Number(entry.usage?.outputTokens ?? 0);
    return result;
  }, {
    requests: 0,
    successfulRequests: 0,
    retryRequests: 0,
    failedRequests: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0
  });
  const totalInputTokens = totals.cachedInputTokens + totals.uncachedInputTokens;
  return {
    ...totals,
    totalInputTokens,
    cacheHitRate: totalInputTokens > 0
      ? Number((totals.cachedInputTokens / totalInputTokens).toFixed(4))
      : null
  };
}

function validateCase(testCase, report) {
  const errors = [];
  if (!report.httpOk) errors.push("HTTP request failed");
  if (!["completed", "completed_with_warning"].includes(report.status)) {
    errors.push(`unexpected status: ${report.status}`);
  }
  if (!testCase.expectedTermination.has(report.terminationReason)) {
    errors.push(`unexpected termination: ${report.terminationReason}`);
  }
  const expectedToolSequences = testCase.expectedToolSequences ?? [testCase.expectedTools];
  if (!expectedToolSequences.some((sequence) => sameArray(report.tools, sequence))) {
    errors.push(`tool sequence ${JSON.stringify(report.tools)} not in ${JSON.stringify(expectedToolSequences)}`);
  }
  if (report.unknownToolCalls !== 0) errors.push("unknown tool call observed");
  if (report.unavailableToolExecutions !== 0) errors.push("unavailable tool execution observed");
  if (report.legacyCalls !== 0) errors.push("legacy recommendation chain was invoked");
  if (testCase.expectedTools.length && report.terminationReason === "completed" && report.evidence.length === 0) {
    errors.push("completed tool answer has no evidence");
  }
  if (testCase.id === "direct_answer" && report.evidence.length !== 0) {
    errors.push("direct answer created evidence");
  }
  if (testCase.id === "four_tool_loop" && !isSubsequence(
    testCase.expectedTools,
    report.evidence.map((entry) => entry.tool)
  )) {
    errors.push("four-tool answer did not retain all evidence records");
  }
  return errors;
}

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

const modelLogs = [];
let legacyCalls = 0;
const runtime = await createSmallWindowRuntimeAsync({
  prewarmCatalog: false,
  reactDecisionRequestLog: (event) => modelLogs.push(event),
  recommendForInputImpl: async () => {
    legacyCalls += 1;
    throw new Error("legacy recommendation chain invoked from ReAct smoke");
  }
});
if (typeof runtime.reactDecisionProvider !== "function") {
  throw new Error("ReAct decision provider is unavailable; configure the live LLM environment first");
}
const catalogPrewarm = await prewarmSmallWindowCatalog(runtime);

const server = createSmallWindowServer({ runtime });
const port = await listen(server);
const reports = [];
try {
  for (const testCase of cases) {
    const logStart = modelLogs.length;
    const legacyStart = legacyCalls;
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/react-chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "close"
      },
      body: JSON.stringify({
        input: testCase.input,
        conversationId: `react-live-smoke-${testCase.id}`
      })
    });
    const lines = (await response.text()).trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
    const events = lines.filter((line) => line.type === "event").map((line) => line.event);
    const complete = lines.find((line) => line.type === "complete");
    const requestLogs = modelLogs.slice(logStart);
    const actions = requestLogs.filter((entry) => entry.status === "ok").map((entry) => entry.action);
    const tools = actions.filter((action) => action.type === "call_tool").map((action) => action.tool);
    const report = {
      id: testCase.id,
      model: runtime.reactDecisionProvider.model ?? null,
      httpOk: response.ok && complete?.statusCode === 200,
      status: complete?.payload?.status ?? null,
      terminationReason: complete?.payload?.terminationReason ?? null,
      actions,
      tools,
      decisionErrors: requestLogs.filter((entry) => entry.status === "error").map((entry) => entry.error),
      decisionRetries: requestLogs.filter((entry) => entry.status === "retry").map((entry) => entry.error),
      eventTypes: events.map((event) => event.type),
      decisions: actions.length,
      toolCalls: events.filter((event) => event.type === "tool_started").length,
      unknownToolCalls: events.filter((event) => (
        event.type === "decision_rejected" && event.data?.errors?.some?.((error) => /not registered/u.test(error))
      )).length,
      unavailableToolExecutions: events.filter((event) => (
        event.type === "tool_failed" && event.data?.error?.code === "tool_not_available"
      )).length,
      evidence: summarizeEvidence(complete?.payload?.evidence),
      citedEvidenceIds: actions.findLast((action) => action.type === "finish")?.evidenceIds ?? [],
      unavailableTools: complete?.payload?.unavailableTools ?? [],
      legacyCalls: legacyCalls - legacyStart,
      latencyMs: Date.now() - startedAt,
      usage: summarizeUsage(requestLogs),
      followupUsage: summarizeUsage(requestLogs.filter((entry, index) => index > 0))
    };
    report.errors = validateCase(testCase, report);
    report.ok = report.errors.length === 0;
    reports.push(report);
  }
} finally {
  await close(server);
  runtime.conclusionWorker?.stop?.();
  await runtime.cacheStore?.close?.();
}

const summary = {
  ok: reports.every((report) => report.ok),
  schemaVersion: "react-chat-live-smoke.v1",
  passed: reports.filter((report) => report.ok).length,
  total: reports.length,
  catalogPrewarm,
  reactDecisionUsage: summarizeUsage(modelLogs),
  followupReactDecisionUsage: summarizeUsage(
    reports.flatMap((report) => report.followupUsage.requests > 0
      ? [{
          requestKind: "react_decision",
          status: "ok",
          usage: report.followupUsage
        }]
      : [])
  ),
  reports
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
