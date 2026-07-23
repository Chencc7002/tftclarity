import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { AGENT_TOOL_SCHEMA_VERSION } from "../src/agent/tools/registry.js";
import {
  LIVE_SEMANTIC_TASK_PROMPT_VERSION,
  createChatSemanticTaskProvider
} from "../src/llm/chat-semantic-task-provider.js";
import { resolveStructuredParserConfig } from "../src/llm/chat-structured-parser.js";
import { SEMANTIC_PARSER_CONTEXT_VERSION } from "../src/understanding/context-policy.js";
import { TASK_FRAME_SCHEMA_VERSION } from "../src/understanding/task-frame.js";
import {
  loadLiveLlmCases,
  runLiveLlmEvaluation
} from "../eval/live-llm-runner.mjs";

loadLocalEnvironment();
if (process.env.TFT_AGENT_LIVE_LLM !== "1") {
  throw new Error("Live LLM evaluation is disabled. Set TFT_AGENT_LIVE_LLM=1 explicitly.");
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = resolve(ROOT, "eval", "datasets", "live-llm-smoke.v1.jsonl");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase-0-3-live-llm.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase-0-3-live-llm.md");

function markdown(report) {
  const failures = report.results.filter((result) => (
    result.error
    || !result.checks.domain
    || !result.checks.action
    || !result.checks.understandingStatus
    || result.checks.entityRecall < 1
  ));
  return [
    "# Phase 0-3 Live LLM Smoke Evaluation",
    "",
    `- result: ${report.passed ? "PASS" : "FAIL"}`,
    `- provider/model: \`${report.configuration.provider}\` / \`${report.configuration.model}\``,
    `- endpoint host: \`${report.configuration.endpointHost}\``,
    `- dataset: \`${report.datasetVersion}\` (${report.metrics.total} cases)`,
    `- structured output: ${(report.metrics.structuredOutputRate * 100).toFixed(2)}%`,
    `- domain/action/status accuracy: ${(report.metrics.domainAccuracy * 100).toFixed(2)}% / ${(report.metrics.actionAccuracy * 100).toFixed(2)}% / ${(report.metrics.understandingStatusAccuracy * 100).toFixed(2)}%`,
    `- entity mention recall: ${(report.metrics.entityMentionRecall * 100).toFixed(2)}%`,
    `- cached/uncached/output tokens: ${report.metrics.totalCachedInputTokens} / ${report.metrics.totalUncachedInputTokens} / ${report.metrics.totalOutputTokens}`,
    `- average/P95/total latency: ${report.metrics.averageDurationMs.toFixed(2)}ms / ${report.metrics.p95DurationMs.toFixed(2)}ms / ${report.metrics.totalDurationMs.toFixed(2)}ms`,
    `- retries: ${report.metrics.totalRetries}`,
    `- first-token latency: unavailable (non-streaming chat completion)`,
    "",
    "## Mismatches and failures",
    "",
    ...(failures.length
      ? failures.map((result) => (
        `- ${result.id}: expected ${result.expected.domain}/${result.expected.action}/${result.expected.understandingStatus}; actual ${result.actual ? `${result.actual.domain}/${result.actual.action}/${result.actual.understandingStatus}` : result.error?.category}; entity recall ${(result.checks.entityRecall * 100).toFixed(0)}%`
      ))
      : ["- none"]),
    ""
  ].join("\n");
}

const config = resolveStructuredParserConfig({
  mode: "always",
  timeoutMs: 45000,
  maxTokens: 1200,
  temperature: 0
});
if (!config.enabled) {
  throw new Error("Live LLM provider is not configured. Configure endpoint, model and API key in the environment.");
}
const cases = await loadLiveLlmCases(DATASET_PATH);
const report = await runLiveLlmEvaluation(cases, {
  createProvider: (onRequestLog) => createChatSemanticTaskProvider({
    ...config,
    timeoutMs: 45000,
    maxTokens: 1200,
    temperature: 0,
    thinkingMode: "disabled",
    onRequestLog
  })
});
report.configuration = {
  provider: config.provider,
  model: config.model,
  endpointHost: new URL(config.endpoint).host,
  temperature: 0,
  responseFormat: config.includeResponseFormat === false ? "plain_json" : "json_object",
  streaming: false,
  thinkingMode: "disabled",
  estimatedCostUsd: null,
  costNote: "Provider pricing was not configured; token counts are recorded for external cost calculation."
};
report.versions = {
  taskFrame: TASK_FRAME_SCHEMA_VERSION,
  semanticContext: SEMANTIC_PARSER_CONTEXT_VERSION,
  livePrompt: LIVE_SEMANTIC_TASK_PROMPT_VERSION,
  toolRegistry: AGENT_TOOL_SCHEMA_VERSION
};
report.executedAt = new Date().toISOString();

await mkdir(REPORT_DIR, { recursive: true });
await Promise.all([
  writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(MARKDOWN_REPORT_PATH, markdown(report), "utf8")
]);
console.log(JSON.stringify({
  passed: report.passed,
  configuration: report.configuration,
  versions: report.versions,
  gates: report.gates,
  metrics: report.metrics,
  jsonReport: JSON_REPORT_PATH,
  markdownReport: MARKDOWN_REPORT_PATH
}, null, 2));
if (!report.passed) process.exitCode = 1;
