import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createChatSemanticTaskProvider } from "../src/llm/chat-semantic-task-provider.js";
import { resolveStructuredParserConfig } from "../src/llm/chat-structured-parser.js";
import { buildLiveLlmT3Cases } from "../eval/datasets/live-llm-t3-cases.mjs";
import { runLiveLlmT3Evaluation } from "../eval/live-llm-t3-runner.mjs";

loadLocalEnvironment();
if (process.env.TFT_AGENT_LIVE_LLM_T3 !== "1") {
  throw new Error("Live LLM T3 is disabled. Set TFT_AGENT_LIVE_LLM_T3=1 explicitly.");
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase-6-6-1-live-llm-t3.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase-6-6-1-live-llm-t3.md");
const repetitions = Math.max(3, Number(process.env.TFT_AGENT_T3_REPETITIONS ?? 3));
const concurrency = Math.max(1, Math.min(8, Number(process.env.TFT_AGENT_T3_CONCURRENCY ?? 4)));

function percent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function markdown(report) {
  const failures = report.results.filter((result) => !result.passed);
  return [
    "# Phase 6.6.1 Real LLM T3 Evaluation",
    "",
    `- result: ${report.passed ? "PASS" : "FAIL"}`,
    `- provider/model: \`${report.configuration.provider}\` / \`${report.configuration.model}\``,
    `- dataset: \`${report.datasetVersion}\``,
    `- cases/repetitions/requests: ${report.metrics.cases} / ${report.metrics.repetitions} / ${report.metrics.requests}`,
    `- request success / controlled provider fallback: ${percent(report.metrics.requestSuccessRate)} / ${percent(report.metrics.providerFallbackRate)} (${report.metrics.providerFallbacks})`,
    `- Pass@${report.metrics.repetitions}: ${percent(report.metrics.passAtK)}`,
    `- Pass^${report.metrics.repetitions}: ${percent(report.metrics.passPowerK)}`,
    `- entity mention / Top1: ${percent(report.metrics.entityMentionRecall)} / ${percent(report.metrics.entityResolutionTop1Accuracy)}`,
    `- tool selection: ${percent(report.metrics.toolSelectionAccuracy)}`,
    `- complete argument semantics / plan shape: ${percent(report.metrics.argumentSemanticAccuracy)} / ${percent(report.metrics.planShapeAccuracy)}`,
    `- unsupported honest downgrade: ${percent(report.metrics.unsupportedHonestDowngradeRate)}`,
    `- context Pass^${report.metrics.repetitions}: ${percent(report.metrics.contextPassPowerK)}`,
    `- clarification: ${percent(report.metrics.clarificationAccuracy)}`,
    `- domain/action/status: ${percent(report.metrics.domainAccuracy)} / ${percent(report.metrics.actionAccuracy)} / ${percent(report.metrics.statusAccuracy)}`,
    `- tokens cached/uncached/output/total: ${report.metrics.tokens.cachedInput} / ${report.metrics.tokens.uncachedInput} / ${report.metrics.tokens.output} / ${report.metrics.tokens.total}`,
    `- tokens per request P50/P95: ${report.metrics.tokens.perRequestP50} / ${report.metrics.tokens.perRequestP95}`,
    `- latency average/P50/P95/wall: ${report.metrics.latency.averageMs.toFixed(2)} / ${report.metrics.latency.p50Ms.toFixed(2)} / ${report.metrics.latency.p95Ms.toFixed(2)} / ${report.metrics.latency.wallMs.toFixed(2)} ms`,
    "",
    "## Category slices",
    "",
    ...Object.entries(report.slices).map(([category, value]) => (
      `- ${category}: pass ${percent(value.passRate)}, Pass@${report.metrics.repetitions} ${percent(value.passAtK)}, Pass^${report.metrics.repetitions} ${percent(value.passPowerK)}, entity ${percent(value.entityResolutionAccuracy)}, tool ${percent(value.toolSelectionAccuracy)}, arguments ${percent(value.argumentSemanticAccuracy)}, clarification ${percent(value.clarificationAccuracy)}`
    )),
    "",
    "## Failed runs",
    "",
    ...(failures.length ? failures.map((result) => (
      `- ${result.id}#${result.repetition}: expected ${result.expected.action}/${result.expected.status}/${result.expected.tool ?? "none"}/${result.expected.clarification ? "clarify" : "answer"}; actual ${result.actual ? `${result.actual.action}/${result.actual.status}/${result.actual.tool ?? "none"}/${result.actual.clarification ? "clarify" : "answer"}` : result.error?.category}`
    )) : ["- none"]),
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
  throw new Error("Live LLM provider is not configured.");
}
const report = await runLiveLlmT3Evaluation(buildLiveLlmT3Cases(), {
  repetitions,
  concurrency,
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
  streaming: false,
  concurrency
};
report.executedAt = new Date().toISOString();
await mkdir(REPORT_DIR, { recursive: true });
await Promise.all([
  writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(MARKDOWN_REPORT_PATH, markdown(report), "utf8")
]);
console.log(JSON.stringify({
  passed: report.passed,
  gates: report.gates,
  metrics: report.metrics,
  slices: report.slices,
  configuration: report.configuration,
  jsonReport: JSON_REPORT_PATH,
  markdownReport: MARKDOWN_REPORT_PATH
}, null, 2));
if (!report.passed) process.exitCode = 1;
