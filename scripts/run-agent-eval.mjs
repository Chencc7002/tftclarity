import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentEvalDataset, runAgentEvaluation } from "../eval/runner.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = resolve(ROOT, "eval", "datasets", "core-agent-cases.jsonl");
const FIXTURE_PATH = resolve(ROOT, "test", "fixtures", "comp-rankings", "metatft-comps-page-minimal.json");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "agent-eval.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "agent-eval.md");

export function agentEvaluationMarkdown(report) {
  const metrics = report.metrics;
  return [
    "# Core Agent Evaluation",
    "",
    `- dataset: \`${report.datasetVersion}\``,
    `- result: ${metrics.failed === 0 ? "PASS" : "FAIL"}`,
    `- total: ${metrics.total}`,
    `- passed: ${metrics.passed}`,
    `- failed: ${metrics.failed}`,
    `- skipped: ${metrics.skipped}`,
    `- task success rate: ${(metrics.task_success_rate * 100).toFixed(1)}%`,
    `- intent accuracy: ${(metrics.intent_accuracy * 100).toFixed(1)}%`,
    `- clarification accuracy: ${(metrics.clarification_accuracy * 100).toFixed(1)}%`,
    `- tool selection accuracy: ${(metrics.tool_selection_accuracy * 100).toFixed(1)}%`,
    `- tool input validity rate: ${(metrics.tool_input_validity_rate * 100).toFixed(1)}%`,
    `- fallback rate: ${(metrics.fallback_rate * 100).toFixed(1)}%`,
    `- timeout rate: ${(metrics.timeout_rate * 100).toFixed(1)}%`,
    `- average duration: ${metrics.average_duration_ms.toFixed(1)}ms`,
    `- p95 duration: ${metrics.p95_duration_ms.toFixed(1)}ms`,
    "",
    "## Cases",
    "",
    ...report.results.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.actual.intent ?? result.actual.error ?? "unknown"}`),
    ""
  ].join("\n");
}

export function agentEvaluationExitCode(report) {
  return report?.metrics?.failed > 0 ? 1 : 0;
}

async function main() {
  const [cases, fixtureText] = await Promise.all([
    loadAgentEvalDataset(DATASET_PATH),
    readFile(FIXTURE_PATH, "utf8")
  ]);
  const report = await runAgentEvaluation(cases, { compFixture: JSON.parse(fixtureText) });
  if (Object.values(report.metrics).some((value) => typeof value === "number" && Number.isNaN(value))) {
    throw new Error("Agent evaluation produced NaN metrics");
  }
  await mkdir(REPORT_DIR, { recursive: true });
  await Promise.all([
    writeFile(JSON_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(MARKDOWN_REPORT_PATH, agentEvaluationMarkdown(report), "utf8")
  ]);
  console.log(JSON.stringify({
    ...report.metrics,
    jsonReport: JSON_REPORT_PATH,
    markdownReport: MARKDOWN_REPORT_PATH
  }));
  process.exitCode = agentEvaluationExitCode(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
