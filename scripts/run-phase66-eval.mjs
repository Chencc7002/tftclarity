import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase66Evaluation } from "../eval/phase66-runner.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase-6-6-architecture-convergence.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase-6-6-architecture-convergence.md");

function percent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

const report = await runPhase66Evaluation();
const markdown = [
  "# Phase 6.6 Architecture Convergence Evaluation",
  "",
  `- result: ${report.passed ? "PASS" : "FAIL"}`,
  `- cases: ${report.metrics.cases}`,
  `- supported plan rate: ${percent(report.metrics.supportedPlanRate)}`,
  `- tool-name accuracy: ${percent(report.metrics.toolNameAccuracy)}`,
  `- full-parameter semantic accuracy: ${percent(report.metrics.argumentSemanticAccuracy)}`,
  `- ExecutionPlan execution-source rate: ${percent(report.metrics.executionPlanSourceRate)}`,
  `- new/legacy parameter semantic equivalence: ${percent(report.metrics.parameterSemanticEquivalenceRate)}`,
  `- public business-result equivalence: ${percent(report.metrics.publicResultEquivalenceRate)}`,
  `- independent holdout action/tool accuracy: ${percent(report.metrics.holdoutActionAccuracy)} / ${percent(report.metrics.holdoutToolAccuracy)}`,
  `- unsupported honest downgrade: ${percent(report.metrics.unsupportedHonestDowngradeRate)}`,
  `- average / maximum steps: ${report.metrics.averageSteps} / ${report.metrics.maxSteps}`,
  `- security rejections: ${report.metrics.securityRejections}/${report.metrics.securityCases}`,
  ""
].join("\n");

await mkdir(REPORT_DIR, { recursive: true });
await Promise.all([
  writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(MARKDOWN_REPORT_PATH, markdown, "utf8")
]);
console.log(JSON.stringify({
  passed: report.passed,
  gates: report.gates,
  metrics: report.metrics,
  jsonReport: JSON_REPORT_PATH,
  markdownReport: MARKDOWN_REPORT_PATH
}, null, 2));
if (!report.passed) process.exitCode = 1;
