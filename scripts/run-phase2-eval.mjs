import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPhase2Cases, runPhase2Evaluation } from "../eval/phase2-runner.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = resolve(ROOT, "eval", "datasets", "natural-language-agent-phase0.v1.jsonl");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase-2-semantic-parser.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase-2-semantic-parser.md");

export function phase2Markdown(report) {
  const metrics = report.metrics;
  const failures = report.results.filter((result) => (
    !result.checks.action || !result.checks.domain || !result.checks.unsupportedUnderstood
  ));
  return [
    "# Phase 2 Semantic Task Parser Evaluation",
    "",
    `- evaluation: \`${report.evaluationVersion}\``,
    `- dataset: \`${report.datasetVersion}\``,
    `- result: ${report.passed ? "PASS" : "FAIL"}`,
    `- action accuracy: ${(metrics.actionAccuracy * 100).toFixed(2)}% (${metrics.actionCorrect}/${metrics.total})`,
    `- domain accuracy: ${(metrics.domainAccuracy * 100).toFixed(2)}% (${metrics.domainCorrect}/${metrics.total})`,
    `- unsupported understood: ${(metrics.unsupportedUnderstandingRate * 100).toFixed(2)}% (${metrics.unsupportedUnderstood}/${metrics.unsupportedTotal})`,
    `- input/output/latency budget pass: ${(metrics.inputBudgetPassRate * 100).toFixed(2)}% / ${(metrics.outputBudgetPassRate * 100).toFixed(2)}% / ${(metrics.latencyBudgetPassRate * 100).toFixed(2)}%`,
    `- average/P95 latency: ${metrics.averageDurationMs.toFixed(2)}ms / ${metrics.p95DurationMs.toFixed(2)}ms`,
    `- average cached/uncached/output tokens: ${metrics.averageCachedInputTokens.toFixed(1)} / ${metrics.averageUncachedInputTokens.toFixed(1)} / ${metrics.averageOutputTokens.toFixed(1)}`,
    "",
    "## Gate failures",
    "",
    ...(failures.length
      ? failures.map((result) => `- ${result.id}: expected ${result.expected.domain}/${result.expected.action}, actual ${result.actual.domain}/${result.actual.action}/${result.actual.understandingStatus}`)
      : ["- none"]),
    ""
  ].join("\n");
}

async function main() {
  const cases = await loadPhase2Cases(DATASET_PATH);
  const report = await runPhase2Evaluation(cases);
  await mkdir(REPORT_DIR, { recursive: true });
  await Promise.all([
    writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(MARKDOWN_REPORT_PATH, phase2Markdown(report), "utf8")
  ]);
  console.log(JSON.stringify({
    passed: report.passed,
    gates: report.gates,
    metrics: report.metrics,
    jsonReport: JSON_REPORT_PATH,
    markdownReport: MARKDOWN_REPORT_PATH
  }));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
