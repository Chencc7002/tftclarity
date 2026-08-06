import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadLocalEnvironment } from "../src/config/load-env.js";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      result[key] = argv[++index];
    } else result[key] = true;
  }
  return result;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function requiredFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
  return path;
}

loadLocalEnvironment();

const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(
  String(args.manifest ?? "services/youtube-ingestion/acceptance/manifest.json")
);
const captureRoot = resolve(
  String(args["capture-root"] ?? ".cache/youtube-acceptance/live")
);
const outputsRoot = resolve(
  String(args.outputs ?? ".cache/youtube-acceptance/live-retest")
);
const reportPath = resolve(
  String(args.report ?? `${outputsRoot}/acceptance-report.json`)
);
const python = String(
  args.python ?? process.env.TFT_AGENT_PYTHON ?? "python"
);
const cliPath = resolve("services/youtube-ingestion/cli.py");
const evaluatorPath = resolve("services/youtube-ingestion/acceptance_evaluator.py");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(outputsRoot, { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });

const extractionCases = [];
for (const entry of manifest.cases ?? []) {
  const annotationPath = resolve(dirname(manifestPath), entry.annotationFile);
  const annotation = JSON.parse(await readFile(annotationPath, "utf8"));
  const input = annotation.extractionInput;
  if (!input?.mode || !input?.chunkSeconds) {
    throw new Error(
      `${entry.id} annotation requires extractionInput.mode and chunkSeconds`
    );
  }
  const outputPath = resolve(outputsRoot, annotation.output);
  const pythonArgs = [
    cliPath,
    annotation.videoId,
    "--output", outputPath,
    "--season", annotation.season,
    "--patch", annotation.patch,
    "--region", annotation.region ?? "global",
    "--locale", annotation.locale,
    "--chunk-seconds", String(input.chunkSeconds)
  ];
  if (input.mode === "source_envelope") {
    pythonArgs.push(
      "--source-envelope",
      requiredFile(
        resolve(captureRoot, input.sourceEnvelope),
        `${entry.id} source envelope`
      )
    );
  } else if (input.mode === "authenticated_browser_capture") {
    pythonArgs.push(
      "--timedtext-json3",
      requiredFile(
        resolve(captureRoot, input.timedtextJson3),
        `${entry.id} timedtext JSON3`
      ),
      "--source-metadata",
      requiredFile(
        resolve(captureRoot, input.sourceMetadata),
        `${entry.id} source metadata`
      )
    );
  } else {
    throw new Error(`${entry.id} has unsupported capture mode ${input.mode}`);
  }
  pythonArgs.push(args.reextract === true ? "--reextract" : "--force");

  const startedAt = Date.now();
  const execution = await run(python, pythonArgs);
  let envelope = null;
  try {
    envelope = JSON.parse(execution.stdout.trim());
  } catch {
    // The stderr tail below remains bounded and excludes environment values.
  }
  extractionCases.push({
    id: entry.id,
    videoId: annotation.videoId,
    output: outputPath,
    exitCode: execution.code,
    elapsedMs: Date.now() - startedAt,
    status: envelope?.status ?? "process_error",
    documents: envelope?.documents?.length ?? 0,
    segments: envelope?.segments?.length ?? 0,
    quarantinedSegments: envelope?.quarantine?.length ?? 0,
    cacheHits: envelope?.segments?.filter((segment) => segment.cacheHit).length ?? 0,
    modelSegments: envelope?.segments?.filter((segment) => !segment.cacheHit).length ?? 0,
    thinkingMode: envelope?.extraction?.thinkingMode ?? null,
    transportRetryCount: envelope?.segments?.reduce(
      (total, segment) => total + (segment.attempts ?? []).reduce(
        (attemptTotal, attempt) => (
          attemptTotal + Number(attempt.transportRetryCount ?? 0)
        ),
        0
      ),
      0
    ) ?? 0,
    error: envelope
      ? null
      : execution.stderr.trim().slice(-1000) || "invalid CLI output"
  });
}

const evaluation = await run(python, [
  evaluatorPath,
  "--manifest", manifestPath,
  "--outputs", outputsRoot,
  "--report", reportPath
]);
const acceptance = JSON.parse(await readFile(reportPath, "utf8"));
const ok = extractionCases.every((entry) => entry.exitCode === 0)
  && evaluation.code === 0
  && acceptance.passed === true;

process.stdout.write(`${JSON.stringify({
  ok,
  schemaVersion: "youtube_captured_acceptance_run.v1",
  manifest: manifestPath,
  captureRoot,
  outputsRoot,
  report: reportPath,
  reextract: args.reextract === true,
  extractionCases,
  acceptance: {
    passed: acceptance.passed,
    complete: acceptance.complete,
    reviewPendingCaseIds: acceptance.reviewPendingCaseIds,
    provisionalCaseIds: acceptance.provisionalCaseIds,
    reviewErrorsByCase: acceptance.reviewErrorsByCase,
    metrics: acceptance.metrics,
    totals: acceptance.totals,
    thresholdResults: acceptance.thresholdResults
  }
}, null, 2)}\n`);

if (!ok) process.exitCode = 1;
