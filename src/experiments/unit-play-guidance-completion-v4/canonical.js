import { createHash } from "node:crypto";

import { ToolRegistry } from "../../agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../../agent/tools/definitions.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_5_9 } from "../../skills/definitions/unit-play-guidance.js";
import { sha256 } from "../unit-play-guidance-control/content.js";
import { FORWARD_EXPECTED_TOOL_SEQUENCE, FORWARD_REVIEW_FACETS,
  buildForwardBlindedReviewArtifacts, createForwardProviderIdentityTracker,
  runForwardCanonicalArm } from "../unit-play-guidance-forward/canonical.js";
import { buildCompletionV4Plan, COMPLETION_V4_EXPERIMENT_ID } from "./preflight.js";

export const COMPLETION_V4_AUTH_SCHEMA = "unit-play-guidance-completion-provider-authorization.v4";
export const COMPLETION_V4_AUTH_ENV = "UNIT_PLAY_GUIDANCE_COMPLETION_PROVIDER_AUTHORIZED";
export const COMPLETION_V4_LIMITS = Object.freeze({ providerHttpRequestHardCap: 1_000,
  totalTokenHardCap: null, concurrency: 1 });

function taggedError(message, code) { const error = new Error(message); error.code = code; return error; }
const clone = (value) => structuredClone(value);

export function createCompletionV4Fuse() {
  let providerHttpRequests = 0, totalTokens = 0, responsesWithoutUsage = 0, exhaustedReason = null;
  const fail = (message, code) => { if (!exhaustedReason) exhaustedReason = code; throw taggedError(message, code); };
  return {
    beforeRequest() {
      if (exhaustedReason) fail(`completion v4 fuse is open: ${exhaustedReason}`, "budget_failure");
      if (providerHttpRequests + 1 > COMPLETION_V4_LIMITS.providerHttpRequestHardCap) {
        fail("completion v4 HTTP-request hard cap reached", "budget_failure");
      }
      providerHttpRequests += 1;
    },
    observePayload(payload) {
      const observed = Number(payload?.usage?.total_tokens
        ?? (Number(payload?.usage?.prompt_tokens ?? 0) + Number(payload?.usage?.completion_tokens ?? 0)));
      if (!Number.isFinite(observed) || observed <= 0) {
        responsesWithoutUsage += 1;
        fail("Provider response omitted required token usage", "hard_cap_enforcement_failure");
      }
      totalTokens += observed;
    },
    snapshot: () => ({ limits: COMPLETION_V4_LIMITS, providerHttpRequests, totalTokens,
      responsesWithoutUsage, exhausted: exhaustedReason !== null, exhaustedReason })
  };
}

export function authorizeCompletionV4Run({ config, preflightResult, transportMode = "real_provider",
  cliAuthorized = false, environmentAuthorization, apiKey, worktreeClean = false,
  implementationCommitSha, providerAuthorization } = {}) {
  if (transportMode === "fake_test") return Object.freeze({ transportMode, providerCallsAuthorized: false, apiKey: null });
  const failures = [];
  if (config?.authorization?.realProviderRun !== false) failures.push("checked-in Provider lock must remain false");
  if (preflightResult?.status !== "passed") failures.push("zero-call preflight must pass");
  if (!cliAuthorized) failures.push("missing --candidate-reliability-real-provider");
  if (environmentAuthorization !== "1") failures.push(`${COMPLETION_V4_AUTH_ENV} must equal 1`);
  if (!String(apiKey ?? "").trim()) failures.push("OPENAI_API_KEY is not configured");
  if (!worktreeClean) failures.push("experiment worktree must be clean");
  if (!/^[0-9a-f]{40}$/u.test(String(implementationCommitSha ?? ""))) failures.push("commit SHA is unavailable");
  let hostname = null; try { hostname = new URL(config?.provider?.endpoint).hostname; } catch { failures.push("invalid endpoint"); }
  if (hostname !== "api.deepseek.com") failures.push("Provider hostname must be api.deepseek.com");
  if (providerAuthorization?.schemaVersion !== COMPLETION_V4_AUTH_SCHEMA
    || providerAuthorization?.experimentId !== COMPLETION_V4_EXPERIMENT_ID
    || providerAuthorization?.scope !== "one_adaptive_candidate_reliability_run"
    || providerAuthorization?.approved !== true) failures.push("candidate reliability authorization is invalid");
  if (providerAuthorization?.approvedCommitSha !== implementationCommitSha
    || providerAuthorization?.configNormalizedSha256 !== sha256(config)) failures.push("authorization binding mismatch");
  if (providerAuthorization?.maxAgentRuns !== 90
    || providerAuthorization?.limits?.providerHttpRequestHardCap !== 1_000
    || providerAuthorization?.limits?.totalTokenHardCap !== null) failures.push("authorization limits mismatch");
  if (failures.length) throw taggedError(`completion v4 unlock denied: ${failures.join("; ")}`, "authorization_failed");
  return Object.freeze({ transportMode, providerCallsAuthorized: true, apiKey: String(apiKey),
    implementationCommitSha, hostname, authorizationId: providerAuthorization.authorizationId });
}

function labelTemplates(packet) {
  return ["reviewer-1", "reviewer-2"].map((reviewerId) => ({
    schemaVersion: "unit-play-guidance-completion-independent-labels.v4",
    experimentId: COMPLETION_V4_EXPERIMENT_ID, reviewerId, packetSha256: sha256(packet),
    independentBeforeAdjudication: true,
    labels: packet.entries.flatMap((entry) => FORWARD_REVIEW_FACETS.map((facetId) => ({
      outputId: entry.outputId, caseId: entry.caseId, facetId, rating: null, reasonCodes: [], note: null
    })))
  }));
}

function summarizeCompletionRuns(runs, plan) {
  const validRuns = runs.filter((run) => run.audit.valid);
  const counts = new Map();
  for (const run of validRuns) counts.set(run.caseId, (counts.get(run.caseId) ?? 0) + 1);
  const casesWithAtLeastTwoNativeCompletions = [...counts.values()].filter((count) => count >= 2).length;
  const remainingByCase = new Map();
  for (const planned of plan.runs.slice(runs.length)) {
    remainingByCase.set(planned.caseId, (remainingByCase.get(planned.caseId) ?? 0) + 1);
  }
  const allCaseIds = new Set([...plan.runs.map((run) => run.caseId), ...counts.keys()]);
  const maxCasesWithAtLeastTwoNativeCompletions = [...allCaseIds].filter((caseId) => (
    (counts.get(caseId) ?? 0) + (remainingByCase.get(caseId) ?? 0) >= 2
  )).length;
  const remainingRuns = plan.runs.length - runs.length;
  const maxNativeModelCompletions = validRuns.length + remainingRuns;
  const reliability = { nativeCompletionsPass: validRuns.length >= 81,
    coveredCasesPass: casesWithAtLeastTwoNativeCompletions >= 27 };
  return { attempted: runs.length, nativeModelCompletions: validRuns.length,
    nativeModelCompletionRate: runs.length ? validRuns.length / runs.length : 0,
    exactFrozenToolSequences: runs.filter((run) => run.audit.checks.exactFrozenToolSequence).length,
    casesWithAtLeastTwoNativeCompletions, maxNativeModelCompletions,
    maxCasesWithAtLeastTwoNativeCompletions, reliability };
}

export async function runCompletionV4Experiment({ config, corpus, observations, preflightResult,
  authorization, fetchImpl, onCheckpoint = null } = {}) {
  if (!authorization || !["fake_test", "real_provider"].includes(authorization.transportMode)) {
    throw taggedError("completion v4 requires authorization proof", "authorization_failed");
  }
  if (authorization.transportMode === "real_provider" && !authorization.providerCallsAuthorized) {
    throw taggedError("real Provider transport remains locked", "authorization_failed");
  }
  if (preflightResult?.status !== "passed") throw taggedError("completion v4 preflight failed", "frozen_input_drift");
  if (sha256(corpus) !== config.frozen.sourceCorpusNormalizedSha256
    || sha256(observations) !== config.frozen.sourceObservationNormalizedSha256
    || sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_9)) !== config.frozen.candidateSkillSha256) {
    throw taggedError("completion v4 frozen input drift", "frozen_input_drift");
  }
  const plan = buildCompletionV4Plan(config, corpus);
  if (plan.orderSha256 !== config.execution.orderSha256) throw taggedError("completion v4 order drift", "frozen_input_drift");
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const fuse = createCompletionV4Fuse();
  const identityTracker = createForwardProviderIdentityTracker();
  const runs = [];
  let stopReason = null;
  for (const planned of plan.runs) {
    const evalCase = corpus.positive.find((entry) => entry.caseId === planned.caseId);
    const run = await runForwardCanonicalArm({ arm: "B", pair: { pairId: planned.runId,
      caseId: planned.caseId, repetition: planned.repetition }, evalCase, observations, config,
      authorization, fetchImpl, toolRegistry, fuse, identityTracker,
      candidateSkill: UNIT_PLAY_GUIDANCE_SKILL_V1_5_9 });
    runs.push(run);
    await onCheckpoint?.({ type: "arm_completed", completedAgentRuns: runs.length, run: clone(run) });
    const progress = summarizeCompletionRuns(runs, plan);
    if (progress.maxNativeModelCompletions < 81) {
      stopReason = "native_model_completion_gate_unreachable";
      break;
    }
    if (progress.maxCasesWithAtLeastTwoNativeCompletions < 27) {
      stopReason = "case_coverage_gate_unreachable";
      break;
    }
  }
  const validRuns = runs.filter((run) => run.audit.valid);
  const aggregate = summarizeCompletionRuns(runs, plan);
  const passed = Object.values(aggregate.reliability).every(Boolean);
  const rawReview = buildForwardBlindedReviewArtifacts(validRuns,
    createHash("sha256").update(`${implementationSeed(authorization)}\0completion-v4`).digest("hex"));
  const packet = { ...rawReview.packet, schemaVersion: "unit-play-guidance-completion-review-packet.v4",
    experimentId: COMPLETION_V4_EXPERIMENT_ID, adaptiveCandidateOnly: true };
  const key = { ...rawReview.key, schemaVersion: "unit-play-guidance-completion-review-key.v4",
    experimentId: COMPLETION_V4_EXPERIMENT_ID };
  return { result: { schemaVersion: "unit-play-guidance-completion-result.v4",
    experimentId: COMPLETION_V4_EXPERIMENT_ID, status: passed ? "awaiting_independent_review" : "inconclusive",
    claimBoundary: "Adaptive candidate-only reliability; no paired efficacy or production claim.",
    stopReason,
    plan: { plannedAgentRuns: 90, completedAgentRuns: runs.length, orderSha256: plan.orderSha256, concurrency: 1 },
    actualProviderModelCalls: authorization.transportMode === "real_provider" ? fuse.snapshot().providerHttpRequests : 0,
    fuse: fuse.snapshot(), providerIdentity: identityTracker.snapshot(), aggregate, runs },
    review: { packet, key, labels: passed ? labelTemplates(packet) : [] } };
}

function implementationSeed(authorization) {
  return /^[0-9a-f]{40,64}$/u.test(String(authorization?.implementationCommitSha ?? ""))
    ? authorization.implementationCommitSha : "0".repeat(40);
}
