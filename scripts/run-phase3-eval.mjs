import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase3Evaluation } from "../eval/phase3-runner.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase-3-entity-linker.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase-3-entity-linker.md");

export function phase3Markdown(report) {
  const metrics = report.metrics;
  const failures = report.results.filter((result) => !result.passed);
  return [
    "# Phase 3 Entity and Game Concept Linking Evaluation",
    "",
    `- evaluation: \`${report.evaluationVersion}\``,
    `- dataset: \`${report.datasetVersion}\``,
    `- result: ${report.passed ? "PASS" : "FAIL"}`,
    `- current core Top-1: ${(metrics.coreTop1Accuracy * 100).toFixed(2)}% (${metrics.coreTop1Correct}/${metrics.coreTotal})`,
    `- slang and alias Top-3 recall: ${(metrics.aliasTop3Recall * 100).toFixed(2)}% (${metrics.aliasTop3Correct}/${metrics.aliasTotal})`,
    `- reusable concept accuracy: ${(metrics.conceptAccuracy * 100).toFixed(2)}% (${metrics.conceptCorrect}/${metrics.conceptTotal})`,
    `- nonexistent false-hit rate: ${(metrics.nonexistentFalseHitRate * 100).toFixed(2)}% (${metrics.nonexistentFalseHits}/${metrics.nonexistentTotal})`,
    "",
    "## Failures",
    "",
    ...(failures.length
      ? failures.map((result) => `- ${result.id} ${result.mention}: expected ${result.expectedId}, candidates ${result.actual.candidateIds.join(", ") || "none"}`)
      : ["- none"]),
    ""
  ].join("\n");
}

async function main() {
  const report = await runPhase3Evaluation();
  await mkdir(REPORT_DIR, { recursive: true });
  await Promise.all([
    writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(MARKDOWN_REPORT_PATH, phase3Markdown(report), "utf8")
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
