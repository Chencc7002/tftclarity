import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATASET_VERSION,
  REQUIRED_FAILURE_LABELS,
  REQUIRED_PHENOMENA,
  buildNaturalLanguageAgentCases
} from "../eval/datasets/natural-language-agent-cases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = resolve(ROOT, "eval", "datasets", "natural-language-agent-phase0.v1.jsonl");
const REPORT_DIR = resolve(ROOT, ".cache", "eval");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "phase0-baseline.json");
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIR, "phase0-baseline.md");

const PII_PATTERNS = Object.freeze([
  { name: "email", expression: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u },
  { name: "url", expression: /https?:\/\/\S+/u },
  { name: "phone", expression: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
  { name: "long_number", expression: /(?<!\d)\d{8,}(?!\d)/u }
]);

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

export function serializeDataset(cases) {
  return cases.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

export function evaluatePhase0Cases(cases) {
  const failures = [];
  const ids = new Set();
  const inputs = new Set();
  const failureCounts = Object.fromEntries(REQUIRED_FAILURE_LABELS.map((label) => [label, 0]));
  const phenomenonCounts = Object.fromEntries(REQUIRED_PHENOMENA.map((label) => [label, 0]));
  const sourceCounts = {};
  const styleCounts = {};

  for (const record of cases) {
    if (!record?.id || ids.has(record.id)) failures.push({ id: record?.id ?? null, code: "duplicate_or_missing_id" });
    ids.add(record?.id);
    const normalizedInput = String(record?.input ?? "").normalize("NFKC").trim();
    if (!normalizedInput || inputs.has(normalizedInput)) failures.push({ id: record?.id ?? null, code: "duplicate_or_missing_input" });
    inputs.add(normalizedInput);
    if (record?.datasetVersion !== DATASET_VERSION) failures.push({ id: record?.id ?? null, code: "dataset_version_mismatch" });
    if (!record?.labels || typeof record.labels.supported !== "boolean") failures.push({ id: record?.id ?? null, code: "missing_support_label" });
    if (!Array.isArray(record?.labels?.entities) || !record?.labels?.constraints) failures.push({ id: record?.id ?? null, code: "missing_semantic_labels" });
    if (!record?.labels?.domain || !record?.labels?.action || !record?.labels?.supportStatus || !record?.labels?.expectedFallback) {
      failures.push({ id: record?.id ?? null, code: "missing_required_label" });
    }
    for (const pattern of PII_PATTERNS) {
      if (pattern.expression.test(normalizedInput)) failures.push({ id: record.id, code: `possible_pii:${pattern.name}` });
    }
    for (const label of record?.labels?.failureLabels ?? []) {
      if (failureCounts[label] === undefined) failures.push({ id: record.id, code: `unknown_failure_label:${label}` });
      else failureCounts[label] += 1;
    }
    for (const label of record?.labels?.phenomena ?? []) {
      if (phenomenonCounts[label] !== undefined) phenomenonCounts[label] += 1;
    }
    sourceCounts[record?.source?.kind ?? "missing"] = (sourceCounts[record?.source?.kind ?? "missing"] ?? 0) + 1;
    styleCounts[record?.style ?? "missing"] = (styleCounts[record?.style ?? "missing"] ?? 0) + 1;
  }

  for (const [label, count] of Object.entries(failureCounts)) {
    if (count === 0) failures.push({ id: null, code: `uncovered_failure_label:${label}` });
  }
  for (const [label, count] of Object.entries(phenomenonCounts)) {
    if (count === 0) failures.push({ id: null, code: `uncovered_phenomenon:${label}` });
  }
  if (cases.length < 300) failures.push({ id: null, code: "dataset_below_300" });
  if ((sourceCounts.anonymized_runtime_query ?? 0) < 1) failures.push({ id: null, code: "missing_anonymized_runtime_query" });
  const nonStandard = cases.filter((record) => record.style !== "plain").length;
  if (nonStandard / Math.max(1, cases.length) < 0.5) failures.push({ id: null, code: "insufficient_nonstandard_style_coverage" });

  return {
    schemaVersion: "phase0_eval_report.v1",
    datasetVersion: DATASET_VERSION,
    passed: failures.length === 0,
    total: cases.length,
    uniqueInputs: inputs.size,
    failures,
    metrics: {
      privacyViolations: failures.filter((failure) => failure.code.startsWith("possible_pii:")).length,
      nonStandardStyleRate: nonStandard / Math.max(1, cases.length),
      sourceCounts,
      styleCounts,
      failureCounts,
      phenomenonCounts
    }
  };
}

function markdownReport(report) {
  const lines = [
    "# Phase 0 Baseline Evaluation",
    "",
    `- dataset: \`${report.datasetVersion}\``,
    `- result: ${report.passed ? "PASS" : "FAIL"}`,
    `- total: ${report.total}`,
    `- unique inputs: ${report.uniqueInputs}`,
    `- privacy violations: ${report.metrics.privacyViolations}`,
    `- non-standard style rate: ${(report.metrics.nonStandardStyleRate * 100).toFixed(1)}%`,
    "",
    "## Sources",
    "",
    ...Object.entries(report.metrics.sourceCounts).map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## Failure labels",
    "",
    ...Object.entries(report.metrics.failureCounts).map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## Required phenomena",
    "",
    ...Object.entries(report.metrics.phenomenonCounts).map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## Failures",
    "",
    ...(report.failures.length ? report.failures.map((failure) => `- ${failure.id ?? "dataset"}: ${failure.code}`) : ["- none"]),
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const cases = buildNaturalLanguageAgentCases();
  const serialized = serializeDataset(cases);
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const current = await readFile(DATASET_PATH, "utf8").catch(() => "");
    if (current !== serialized) throw new Error("Phase 0 dataset is missing or not reproducible; run npm run eval:phase0");
  } else {
    await mkdir(dirname(DATASET_PATH), { recursive: true });
    await writeFile(DATASET_PATH, serialized, "utf8");
  }

  const report = evaluatePhase0Cases(cases);
  await mkdir(REPORT_DIR, { recursive: true });
  await Promise.all([
    writeFile(JSON_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(MARKDOWN_REPORT_PATH, markdownReport(report), "utf8")
  ]);
  process.stdout.write(stableJson({
    passed: report.passed,
    total: report.total,
    uniqueInputs: report.uniqueInputs,
    privacyViolations: report.metrics.privacyViolations,
    nonStandardStyleRate: report.metrics.nonStandardStyleRate,
    jsonReport: JSON_REPORT_PATH,
    markdownReport: MARKDOWN_REPORT_PATH
  }));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

