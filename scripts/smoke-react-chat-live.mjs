import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowServer
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
    input: "列出当前版本暗星羁绊中的所有棋子，只根据目录结果回答。",
    expectedTools: ["entity_catalog_query"],
    expectedTermination: new Set(["completed"])
  },
  {
    id: "two_tool_loop",
    input: "列出暗星羁绊中的四费棋子，并分别告诉我他们当前常见的三件出装，只根据工具结果回答。",
    expectedTools: ["entity_catalog_query", "unit_builds_batch"],
    expectedTermination: new Set(["completed"])
  },
  {
    id: "composition_member_statistics",
    input: "在暗星羁绊阵容中，最常见的非暗星外援棋子有哪些？只根据当前统计工具回答。",
    expectedTools: ["composition_member_statistics"],
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

function validateCase(testCase, report) {
  const errors = [];
  if (!report.httpOk) errors.push("HTTP request failed");
  if (!["completed", "completed_with_warning"].includes(report.status)) {
    errors.push(`unexpected status: ${report.status}`);
  }
  if (!testCase.expectedTermination.has(report.terminationReason)) {
    errors.push(`unexpected termination: ${report.terminationReason}`);
  }
  if (!sameArray(report.tools, testCase.expectedTools)) {
    errors.push(`tool sequence ${JSON.stringify(report.tools)} != ${JSON.stringify(testCase.expectedTools)}`);
  }
  if (report.unknownToolCalls !== 0) errors.push("unknown tool call observed");
  if (report.unavailableToolExecutions !== 0) errors.push("unavailable tool execution observed");
  if (report.legacyCalls !== 0) errors.push("legacy recommendation chain was invoked");
  if (report.toolCalls > 3) errors.push("tool budget exceeded");
  if (testCase.expectedTools.length && report.terminationReason === "completed" && report.evidence.length === 0) {
    errors.push("completed tool answer has no evidence");
  }
  if (testCase.id === "direct_answer" && report.evidence.length !== 0) {
    errors.push("direct answer created evidence");
  }
  if (testCase.id === "two_tool_loop" && report.evidence.map((entry) => entry.tool).join(",") !== testCase.expectedTools.join(",")) {
    errors.push("two-tool answer did not retain both evidence records");
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
      latencyMs: Date.now() - startedAt
    };
    report.errors = validateCase(testCase, report);
    report.ok = report.errors.length === 0;
    reports.push(report);
  }
} finally {
  await close(server);
}

const summary = {
  ok: reports.every((report) => report.ok),
  schemaVersion: "react-chat-live-smoke.v1",
  passed: reports.filter((report) => report.ok).length,
  total: reports.length,
  reports
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
