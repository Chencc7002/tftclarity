import { mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_ROOT = join(REPO_ROOT, "test");

// These suites start HTTP servers, exercise end-to-end request deadlines, or
// intentionally wait for cancellation/timeout paths. Running them in one
// serial lane prevents unrelated worker contention from consuming the
// production Agent deadline while preserving the production timeout itself.
const DEADLINE_SENSITIVE_INTEGRATION_FILES = new Set([
  "anonymous-access.test.js",
  "comp-http.test.js",
  "comp-preference-search.test.js",
  "conclusion-http.test.js",
  "conversation-bridge.test.js",
  "conversation-state-v2-integration.test.js",
  "current-stats-rag.test.js",
  "legal-http.test.js",
  "llm-pipeline-e2e.test.js",
  "next-stage-regressions.test.js",
  "react-chat-r1-integration.test.js",
  "recommendation-progress-stream.test.js",
  "small-window-server.test.js",
  "system-interaction-http.test.js",
  "tool-using-agent-web-e2e.test.js",
  "youtube-hybrid-http.test.js"
]);

function allTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? allTestFiles(path) : [path];
    })
    .filter((path) => path.endsWith(".test.js"))
    .sort();
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const lane = argumentValue("lane");
if (!new Set(["main", "integration"]).has(lane)) {
  throw new Error("Expected --lane=main or --lane=integration");
}

const reportPath = argumentValue("report");
const files = allTestFiles(TEST_ROOT).filter((path) => {
  const isIntegration = DEADLINE_SENSITIVE_INTEGRATION_FILES.has(basename(path));
  return lane === "integration" ? isIntegration : !isIntegration;
});

if (files.length === 0) throw new Error(`No tests selected for ${lane} lane`);

const nodeArguments = ["--test"];
if (lane === "integration") nodeArguments.push("--test-concurrency=1");
if (reportPath) {
  const reportDestination = resolve(REPO_ROOT, reportPath);
  mkdirSync(dirname(reportDestination), { recursive: true });
  nodeArguments.push("--test-reporter=junit");
  nodeArguments.push(`--test-reporter-destination=${reportDestination}`);
}
nodeArguments.push(...files.map((path) => relative(REPO_ROOT, path)));

console.log(`[ci-test-lane] lane=${lane} files=${files.length} concurrency=${lane === "integration" ? 1 : "default"}`);
const result = spawnSync(process.execPath, nodeArguments, {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
