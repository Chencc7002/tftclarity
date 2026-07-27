import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ToolRegistry,
  createStructuredToolDefinitions,
  interpretTurn,
  matchTaskCapabilities,
  planExecution,
  reduceConversationState
} from "../src/index.js";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { tftConversationPolicy } from "../src/domain/tft/conversation-policy.js";
import { createChatSemanticTaskProvider } from "../src/llm/chat-semantic-task-provider.js";
import { resolveStructuredParserConfig } from "../src/llm/chat-structured-parser.js";
import {
  CONVERSATION_STATE_V2_LIVE_DATASET_VERSION,
  buildConversationStateV2LiveCases
} from "../eval/datasets/conversation-state-v2-live-cases.mjs";
import { createPhase3EvaluationCatalog } from "../eval/datasets/entity-linking-phase3-cases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "conversation-state-v2-live.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "conversation-state-v2-live.md");
const repetitions = Math.max(3, Number(process.env.TFT_AGENT_CONVERSATION_V2_EVAL_REPETITIONS ?? 3));
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.TFT_AGENT_CONVERSATION_V2_EVAL_CONCURRENCY ?? 3))
);
const threshold = 0.95;

loadLocalEnvironment();

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function includesExpected(actual, expected) {
  return Object.entries(expected ?? {}).every(([key, value]) => {
    if (value === null) return actual?.[key] == null;
    return same(actual?.[key], value);
  });
}

function frameSemantics(frame, expected) {
  if (expected == null) return frame == null;
  if (!frame) return false;
  if (expected.action && frame.action !== expected.action) return false;
  if (Object.hasOwn(expected, "strategy")) {
    if ((frame.constraints?.strategy ?? null) !== expected.strategy) return false;
  }
  if (expected.rank) {
    if (!same(frame.constraints?.rank, expected.rank)) return false;
  }
  if (expected.unit) {
    const unit = array(frame.subjects).find((entity) => entity.expectedType === "champion");
    if (unit?.resolvedId !== expected.unit) return false;
  }
  return true;
}

function percent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

async function writeReport(report) {
  const failures = array(report.results).filter((result) => !result.passed);
  const markdown = [
    "# ConversationState v2 real LLM evaluation",
    "",
    `- status: ${report.status}`,
    `- provider/model: \`${report.configuration.provider}\` / \`${report.configuration.model ?? "not configured"}\``,
    `- dataset: \`${report.datasetVersion}\``,
    `- cases/repetitions/requests: ${report.metrics.cases} / ${report.metrics.repetitions} / ${report.metrics.requests}`,
    `- Pass^${report.metrics.repetitions}: ${percent(report.metrics.passPowerK)} (gate ${percent(threshold)})`,
    `- run / relation / reducer decision: ${percent(report.metrics.runAccuracy)} / ${percent(report.metrics.relationAccuracy)} / ${percent(report.metrics.decisionAccuracy)}`,
    `- tool / complete parameter semantics: ${percent(report.metrics.toolAccuracy)} / ${percent(report.metrics.argumentAccuracy)}`,
    `- provider fallback: ${report.metrics.providerFallbacks}/${report.metrics.requests} (${percent(report.metrics.providerFallbackRate)})`,
    `- invalid-response retries: ${report.metrics.invalidResponseRetries}`,
    `- tokens cached/uncached/output: ${report.metrics.tokens.cachedInput} / ${report.metrics.tokens.uncachedInput} / ${report.metrics.tokens.output}`,
    `- executable command: \`${report.command}\``,
    ...(report.skipReason ? ["", `Skipped: ${report.skipReason}`] : []),
    "",
    "## Failed runs",
    "",
    ...(failures.length
      ? failures.map((failure) => (
        `- ${failure.caseId}#${failure.repetition}: ${failure.failedChecks.join(", ")}; fallback=${failure.providerFallback?.reason ?? "none"}`
      ))
      : ["- none"]),
    ""
  ].join("\n");
  await mkdir(REPORT_DIR, { recursive: true });
  await Promise.all([
    writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(MARKDOWN_REPORT_PATH, markdown, "utf8")
  ]);
}

function skippedReport(reason, configuration = {}) {
  return {
    schemaVersion: "conversation-state-v2-live-evaluation.v1",
    status: "SKIPPED",
    passed: false,
    datasetVersion: CONVERSATION_STATE_V2_LIVE_DATASET_VERSION,
    configuration: {
      provider: configuration.provider ?? "off",
      model: configuration.model ?? null,
      endpointHost: endpointHost(configuration.endpoint),
      concurrency,
      temperature: 0
    },
    metrics: {
      cases: buildConversationStateV2LiveCases().length,
      repetitions,
      requests: 0,
      passPowerK: 0,
      runAccuracy: 0,
      relationAccuracy: 0,
      decisionAccuracy: 0,
      toolAccuracy: 0,
      argumentAccuracy: 0,
      providerFallbacks: 0,
      providerFallbackRate: 0,
      invalidResponseRetries: 0,
      tokens: { cachedInput: 0, uncachedInput: 0, output: 0 }
    },
    skipReason: reason,
    command: "npm run eval:conversation:v2:live",
    results: []
  };
}

let config;
try {
  config = resolveStructuredParserConfig({
    mode: "always",
    timeoutMs: 45000,
    maxTokens: 900,
    temperature: 0
  });
} catch (error) {
  const report = skippedReport(error.message);
  await writeReport(report);
  console.log(JSON.stringify({
    ...report,
    jsonReport: JSON_REPORT_PATH,
    markdownReport: MARKDOWN_REPORT_PATH
  }, null, 2));
  process.exit(0);
}

if (!config.enabled) {
  const report = skippedReport("Current environment does not configure an OpenAI-compatible provider.", config);
  await writeReport(report);
  console.log(JSON.stringify({
    ...report,
    jsonReport: JSON_REPORT_PATH,
    markdownReport: MARKDOWN_REPORT_PATH
  }, null, 2));
  process.exit(0);
}

const cases = buildConversationStateV2LiveCases();
const catalog = createPhase3EvaluationCatalog();
const registry = new ToolRegistry(createStructuredToolDefinitions());
const jobs = cases.flatMap((testCase) => Array.from({ length: repetitions }, (_, index) => ({
  testCase,
  repetition: index + 1,
  input: testCase.inputs[index % testCase.inputs.length]
})));
let cursor = 0;
const results = [];

async function runJob(job) {
  const requestLogs = [];
  const provider = createChatSemanticTaskProvider({
    ...config,
    timeoutMs: 45000,
    maxTokens: 900,
    temperature: 0,
    thinkingMode: "disabled",
    onRequestLog: (entry) => requestLogs.push(entry)
  });
  const interpretation = await interpretTurn({
    currentMessage: job.input,
    conversationState: job.testCase.state,
    semanticProvider: provider,
    catalog,
    domainPolicy: tftConversationPolicy,
    budget: {
      maxInputTokens: 1600,
      maxOutputTokens: 900,
      maxLatencyMs: 45000
    }
  });
  const resolution = reduceConversationState({
    state: job.testCase.state,
    delta: interpretation.turnDelta,
    domainPolicy: tftConversationPolicy
  });
  let planning = null;
  if (resolution.decision === "execute") {
    const capabilityMatch = matchTaskCapabilities(resolution.resolvedTaskFrame, registry);
    planning = await planExecution(resolution.resolvedTaskFrame, capabilityMatch, { registry });
  }
  const actualTool = planning?.plan?.steps?.[0]?.tool ?? null;
  const actualArguments = planning?.plan?.steps?.[0]?.arguments ?? null;
  const expected = job.testCase.expected;
  const checks = {
    relation: expected.relations.includes(interpretation.turnDelta.taskRelation),
    dialogueAct: expected.dialogueActs.includes(interpretation.turnDelta.dialogueAct),
    decision: resolution.decision === expected.decision,
    frame: frameSemantics(resolution.resolvedTaskFrame, expected.frame),
    presentation: includesExpected(interpretation.turnDelta.presentation, expected.presentation),
    tool: actualTool === expected.tool,
    arguments: expected.tool === null
      ? actualArguments === null
      : includesExpected(actualArguments, expected.arguments)
  };
  const providerFallback = interpretation.telemetry.providerFallback;
  const passed = Object.values(checks).every(Boolean) && providerFallback?.used !== true;
  return {
    caseId: job.testCase.id,
    category: job.testCase.category,
    repetition: job.repetition,
    input: job.input,
    passed,
    checks,
    failedChecks: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key),
    providerFallback,
    providerLog: requestLogs.at(-1) ?? null,
    actual: {
      delta: interpretation.turnDelta,
      decision: resolution.decision,
      resolvedTaskFrame: resolution.resolvedTaskFrame,
      tool: actualTool,
      arguments: actualArguments
    }
  };
}

async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor];
    cursor += 1;
    try {
      results.push(await runJob(job));
    } catch (error) {
      results.push({
        caseId: job.testCase.id,
        category: job.testCase.category,
        repetition: job.repetition,
        input: job.input,
        passed: false,
        checks: {},
        failedChecks: ["evaluation_error"],
        providerFallback: { used: true, reason: "evaluation_error" },
        providerLog: null,
        error: String(error?.message ?? error)
      });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
results.sort((left, right) => (
  left.caseId.localeCompare(right.caseId) || left.repetition - right.repetition
));

const byCase = new Map(cases.map((testCase) => [
  testCase.id,
  results.filter((result) => result.caseId === testCase.id)
]));
const rate = (predicate) => results.filter(predicate).length / Math.max(1, results.length);
const providerLogs = results.map((result) => result.providerLog).filter(Boolean);
const providerFallbacks = results.filter((result) => result.providerFallback?.used === true);
const passPowerK = [...byCase.values()].filter((runs) => (
  runs.length === repetitions && runs.every((run) => run.passed)
)).length / Math.max(1, cases.length);
const tokens = providerLogs.reduce((total, log) => ({
  cachedInput: total.cachedInput + Number(log.usage?.cachedInputTokens ?? 0),
  uncachedInput: total.uncachedInput + Number(log.usage?.uncachedInputTokens ?? 0),
  output: total.output + Number(log.usage?.outputTokens ?? 0)
}), { cachedInput: 0, uncachedInput: 0, output: 0 });
const report = {
  schemaVersion: "conversation-state-v2-live-evaluation.v1",
  status: passPowerK >= threshold ? "PASS" : "FAIL",
  passed: passPowerK >= threshold,
  datasetVersion: CONVERSATION_STATE_V2_LIVE_DATASET_VERSION,
  executedAt: new Date().toISOString(),
  configuration: {
    provider: config.provider,
    model: config.model,
    endpointHost: endpointHost(config.endpoint),
    concurrency,
    temperature: 0
  },
  metrics: {
    cases: cases.length,
    repetitions,
    requests: results.length,
    passPowerK,
    runAccuracy: rate((result) => result.passed),
    relationAccuracy: rate((result) => result.checks.relation === true),
    decisionAccuracy: rate((result) => result.checks.decision === true),
    toolAccuracy: rate((result) => result.checks.tool === true),
    argumentAccuracy: rate((result) => result.checks.arguments === true),
    providerFallbacks: providerFallbacks.length,
    providerFallbackRate: providerFallbacks.length / Math.max(1, results.length),
    providerFallbackReasons: Object.fromEntries(
      [...new Set(providerFallbacks.map((result) => result.providerFallback.reason))].map((reason) => [
        reason,
        providerFallbacks.filter((result) => result.providerFallback.reason === reason).length
      ])
    ),
    invalidResponseRetries: providerLogs.reduce((sum, log) => sum + Number(log.retryCount ?? 0), 0),
    tokens
  },
  command: "npm run eval:conversation:v2:live",
  results
};
await writeReport(report);
console.log(JSON.stringify({
  status: report.status,
  passed: report.passed,
  metrics: report.metrics,
  configuration: report.configuration,
  jsonReport: JSON_REPORT_PATH,
  markdownReport: MARKDOWN_REPORT_PATH
}, null, 2));
if (!report.passed) process.exitCode = 1;
