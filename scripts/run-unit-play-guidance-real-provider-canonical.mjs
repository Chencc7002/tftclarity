import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  authorizeCanonicalRealProviderRun,
  PR1D_CANONICAL_AUTH_ENV,
  PR1D_CANONICAL_CREDENTIAL_ENV,
  PR1D_CANONICAL_LIMITS,
  PR1D_RECOVERY_AUTH_ENV,
  runCanonicalRealProviderExperiment
} from "../src/experiments/unit-play-guidance-real-provider/canonical.js";
import { renderCanonicalAttemptReport } from "../src/experiments/unit-play-guidance-real-provider/finalization.js";
import { runRealProviderPreflight } from "../src/experiments/unit-play-guidance-real-provider/preflight.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-real-provider", "config.v1.json");
const CORPUS_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "corpus.v1.json");
const FIXTURE_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "tool-observations.v1.json");

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function argumentValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function defaultAttemptId() {
  return new Date().toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14);
}

function validateAttemptId(value) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(value)) throw new TypeError("invalid --attempt-id");
  return value;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function ensureNewAttemptDirectory(attemptDirectory) {
  try {
    await fs.stat(attemptDirectory);
    throw new Error(`canonical attempt directory already exists: ${attemptDirectory}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(attemptDirectory, { recursive: true });
}

const cliAuthorized = process.argv.slice(2).includes("--canonical-real-provider");
const recoveryCliAuthorized = process.argv.slice(2).includes("--recovery-attempt-02");
if (!cliAuthorized) {
  throw new Error("PR1D real-provider calls remain locked: pass --canonical-real-provider");
}
if (!recoveryCliAuthorized) {
  throw new Error("PR1D attempt-02 calls remain locked: pass --recovery-attempt-02 after preflight review");
}

const [config, corpus, fixtures] = await Promise.all([
  readJson(CONFIG_PATH),
  readJson(CORPUS_PATH),
  readJson(FIXTURE_PATH)
]);
const implementationCommitSha = git(["rev-parse", "HEAD"]);
const worktreeClean = git(["status", "--porcelain"]) === "";
const apiKey = process.env[PR1D_CANONICAL_CREDENTIAL_ENV] ?? "";
const preflight = await runRealProviderPreflight({
  config,
  corpus,
  fixtures,
  root: ROOT,
  apiKeyConfigured: Boolean(apiKey.trim()),
  implementationCommitSha
});
const authorization = authorizeCanonicalRealProviderRun({
  cliAuthorized,
  environmentAuthorization: process.env[PR1D_CANONICAL_AUTH_ENV],
  recoveryCliAuthorized,
  recoveryEnvironmentAuthorization: process.env[PR1D_RECOVERY_AUTH_ENV],
  apiKey,
  endpoint: config.provider.endpoint,
  worktreeClean,
  preflightStatus: preflight.status,
  pairOrderSha256: preflight.plan.orderSha256,
  implementationCommitSha
});

const attemptId = validateAttemptId(argumentValue("attempt-id", defaultAttemptId()));
const attemptDirectory = path.join(ROOT, ".artifacts", "pr1d-real-provider", attemptId);
await ensureNewAttemptDirectory(attemptDirectory);
const checkpointPath = path.join(attemptDirectory, "checkpoint.jsonl");
const authorizationManifest = {
  schemaVersion: "unit-play-guidance-real-provider-authorization-manifest.v1",
  attemptId,
  mode: authorization.mode,
  implementationCommitSha,
  credentialSource: authorization.credentialSource,
  credentialConfigured: authorization.credentialConfigured,
  credentialBindingConfirmedFor: authorization.credentialBindingConfirmedFor,
  provider: config.provider,
  agent: config.agent,
  frozen: config.frozen,
  limits: PR1D_CANONICAL_LIMITS,
  recovery: {
    sourceAttemptId: "canonical-eb6ba94-01",
    sourceAttemptAcceptance: "failed",
    sourceAttemptSecondaryAnalysis: "inconclusive",
    executionMode: "fresh_full_180",
    priorAttemptSamplesImported: 0,
    capChangeReason: "empirical recovery after attempt-01 capacity exhaustion"
  },
  pairOrderSha256: authorization.pairOrderSha256
};
await fs.writeFile(
  path.join(attemptDirectory, "authorization-manifest.v1.json"),
  `${JSON.stringify(authorizationManifest, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" }
);

let result;
let blinded;
try {
  ({ result, blinded } = await runCanonicalRealProviderExperiment({
    config,
    corpus,
    fixtures,
    authorization,
    apiKey,
    onCheckpoint: async (checkpoint) => {
      const redactedCheckpoint = JSON.stringify(checkpoint).replaceAll(apiKey, "[REDACTED]");
      await fs.appendFile(checkpointPath, `${redactedCheckpoint}\n`, "utf8");
    }
  }));
} catch (error) {
  const fatal = {
    schemaVersion: "unit-play-guidance-real-provider-fatal.v1",
    status: "aborted",
    code: String(error?.code ?? error?.name ?? "runtime_failure"),
    message: String(error?.message ?? error).replaceAll(apiKey, "[REDACTED]").slice(0, 500)
  };
  await fs.writeFile(path.join(attemptDirectory, "fatal-error.v1.json"), `${JSON.stringify(fatal, null, 2)}\n`, "utf8");
  throw error;
}

await Promise.all([
  fs.writeFile(path.join(attemptDirectory, "canonical-result.v1.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(attemptDirectory, "facet-label-packet.blinded.v1.json"), `${JSON.stringify(blinded.packet, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(attemptDirectory, "facet-label-key.v1.json"), `${JSON.stringify(blinded.key, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(attemptDirectory, "canonical-report.md"), renderCanonicalAttemptReport(result), "utf8")
]);

console.log(JSON.stringify({
  status: result.status,
  attemptId,
  attemptDirectory,
  implementationCommitSha,
  plannedAgentRuns: result.plan.plannedAgentRuns,
  completedAgentRuns: result.plan.completedAgentRuns,
  providerHttpRequests: result.fuse.providerHttpRequests,
  actualTotalTokens: result.fuse.totalTokens,
  candidateSkillFailures: result.aggregate.reliability.candidateSkillFailures,
  abort: result.abort
}));

if (!["awaiting_facet_adjudication"].includes(result.status)) process.exitCode = 1;
