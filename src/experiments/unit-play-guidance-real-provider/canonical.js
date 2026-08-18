import { createHash } from "node:crypto";

import { ToolExecutor } from "../../agent/tools/executor.js";
import { ReactLoop } from "../../react/react-loop.js";
import { createReactDecisionProvider } from "../../react/react-decision-provider.js";
import { buildSkillContext, matchSkill } from "../../skills/index.js";
import {
  answerFacetAudit,
  assertTaskFramePredicate,
  createRegistries,
  createRunContext,
  evidenceFacetAudit,
  frozenToolHandlers,
  nativeSucceeded,
  safetyAudit,
  taskFrameFromCase,
  UNIT_PLAY_GUIDANCE_EXPERIMENT_AVAILABLE_TOOLS,
  validateCorpus,
  validateFixtures,
  verifyFrozenObservationParity
} from "../unit-play-guidance-control/harness.js";
import {
  BASELINE_GUIDANCE_SHA256,
  CANDIDATE_SKILL_CONTENT_SHA256,
  renderCandidateSkillContext,
  sha256
} from "../unit-play-guidance-control/content.js";
import { buildCanonicalRunPlan, createProviderIdentityTracker } from "./preflight.js";

export const PR1D_CANONICAL_SCHEMA_VERSION = "unit-play-guidance-real-provider-canonical.v1";
export const PR1D_CANONICAL_RUNTIME_VERSION = "unit-play-guidance-real-provider-canonical.v1";
export const PR1D_CANONICAL_MODE = "canonical_real_provider";
export const PR1D_CANONICAL_AUTH_ENV = "PR1D_REAL_PROVIDER_AUTHORIZED";
export const PR1D_CANONICAL_CREDENTIAL_ENV = "OPENAI_API_KEY";
export const PR1D_CANONICAL_PAIR_ORDER_SHA256 = "94dbd2bd32461e996b36ed28265b0a5baba76af7694ce02dd52fba441fdc826a";
export const PR1D_CANONICAL_LIMITS = Object.freeze({
  totalTokenHardCap: 4_000_000,
  providerHttpRequestHardCap: 1_500,
  pairConcurrency: 1
});

function clone(value) {
  return structuredClone(value);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function normalizedProviderUsage(payload = {}) {
  const usage = payload?.usage ?? {};
  const cacheHit = Number(usage.prompt_cache_hit_tokens ?? 0);
  const cacheMiss = Number(usage.prompt_cache_miss_tokens ?? 0);
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? (cacheHit + cacheMiss));
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? (input + output));
  if (![input, output, total].every(Number.isFinite)) return null;
  return {
    cachedInputTokens: Math.max(0, Number(
      usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.cached_input_tokens
      ?? usage.prompt_cache_hit_tokens
      ?? 0
    )),
    uncachedInputTokens: Math.max(0, usage.prompt_cache_miss_tokens == null ? input - cacheHit : cacheMiss),
    outputTokens: Math.max(0, output),
    totalTokens: Math.max(0, total)
  };
}

function taggedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function authorizeCanonicalRealProviderRun({
  cliAuthorized,
  environmentAuthorization,
  apiKey,
  endpoint,
  worktreeClean,
  preflightStatus,
  pairOrderSha256,
  implementationCommitSha
} = {}) {
  const failures = [];
  if (cliAuthorized !== true) failures.push("missing --canonical-real-provider");
  if (environmentAuthorization !== "1") failures.push(`${PR1D_CANONICAL_AUTH_ENV} must equal 1`);
  if (!String(apiKey ?? "").trim()) failures.push(`${PR1D_CANONICAL_CREDENTIAL_ENV} is not configured`);
  let credentialBindingConfirmedFor = null;
  try {
    credentialBindingConfirmedFor = new URL(endpoint).hostname;
  } catch {
    failures.push("Provider endpoint is invalid");
  }
  if (credentialBindingConfirmedFor !== "api.deepseek.com") {
    failures.push("credential binding target must be api.deepseek.com");
  }
  if (worktreeClean !== true) failures.push("call-enabled experiment worktree must be clean");
  if (preflightStatus !== "passed") failures.push("zero-call preflight must pass at the call-enabled commit");
  if (pairOrderSha256 !== PR1D_CANONICAL_PAIR_ORDER_SHA256) failures.push("canonical pair order hash drifted");
  if (!/^[0-9a-f]{40}$/u.test(String(implementationCommitSha ?? ""))) {
    failures.push("call-enabled experiment commit SHA is unavailable");
  }
  if (failures.length) throw taggedError(`PR1D real-provider unlock denied: ${failures.join("; ")}`, "authorization_failed");
  return Object.freeze({
    mode: PR1D_CANONICAL_MODE,
    providerCallsAuthorized: true,
    credentialSource: PR1D_CANONICAL_CREDENTIAL_ENV,
    credentialConfigured: true,
    credentialBindingConfirmedFor,
    implementationCommitSha: String(implementationCommitSha),
    pairOrderSha256
  });
}

export function createCanonicalRunFuse(limits = PR1D_CANONICAL_LIMITS) {
  const frozenLimits = Object.freeze({
    totalTokenHardCap: Number(limits.totalTokenHardCap),
    providerHttpRequestHardCap: Number(limits.providerHttpRequestHardCap),
    pairConcurrency: Number(limits.pairConcurrency)
  });
  if (frozenLimits.totalTokenHardCap !== 4_000_000
    || frozenLimits.providerHttpRequestHardCap !== 1_500
    || frozenLimits.pairConcurrency !== 1) {
    throw taggedError("canonical global limits must remain frozen", "authorization_failed");
  }
  let providerHttpRequests = 0;
  let totalTokens = 0;
  let responsesWithUsage = 0;
  let responsesWithoutUsage = 0;
  let exhaustedReason = null;
  return {
    beforeRequest() {
      if (exhaustedReason) throw taggedError(`canonical fuse is open: ${exhaustedReason}`, "budget_failure");
      if (providerHttpRequests >= frozenLimits.providerHttpRequestHardCap) {
        exhaustedReason = "provider_http_request_hard_cap";
        throw taggedError("canonical Provider HTTP-request hard cap reached", "budget_failure");
      }
      if (totalTokens >= frozenLimits.totalTokenHardCap) {
        exhaustedReason = "total_token_hard_cap";
        throw taggedError("canonical actual total-token hard cap reached", "budget_failure");
      }
      providerHttpRequests += 1;
      if (providerHttpRequests >= frozenLimits.providerHttpRequestHardCap) {
        exhaustedReason = "provider_http_request_hard_cap";
      }
    },
    observePayload(payload) {
      const usage = normalizedProviderUsage(payload);
      if (!usage) responsesWithoutUsage += 1;
      else {
        responsesWithUsage += 1;
        totalTokens += usage.totalTokens;
        if (totalTokens >= frozenLimits.totalTokenHardCap) exhaustedReason = "total_token_hard_cap";
      }
      return usage;
    },
    snapshot() {
      return {
        limits: clone(frozenLimits),
        providerHttpRequests,
        totalTokens,
        responsesWithUsage,
        responsesWithoutUsage,
        exhausted: Boolean(exhaustedReason),
        exhaustedReason
      };
    }
  };
}

function sanitizedProviderLog(entry = {}) {
  const usage = entry.usage ?? null;
  return {
    status: String(entry.status ?? "unknown"),
    requestKind: String(entry.requestKind ?? "react_decision"),
    model: String(entry.model ?? ""),
    durationMs: Math.max(0, Number(entry.durationMs ?? 0)),
    attempts: entry.attempts == null ? null : Number(entry.attempts),
    usage: usage ? {
      cachedInputTokens: Math.max(0, Number(usage.cachedInputTokens ?? 0)),
      uncachedInputTokens: Math.max(0, Number(usage.uncachedInputTokens ?? 0)),
      outputTokens: Math.max(0, Number(usage.outputTokens ?? 0))
    } : null,
    error: entry.error == null ? null : String(entry.error).slice(0, 500),
    actionType: entry.action?.type ?? null,
    actionTool: entry.action?.type === "call_tool" ? entry.action.tool : null
  };
}

function telemetryTokenTotal(providerLogs) {
  return providerLogs.reduce((total, entry) => total + Number(entry.usage?.cachedInputTokens ?? 0)
    + Number(entry.usage?.uncachedInputTokens ?? 0)
    + Number(entry.usage?.outputTokens ?? 0), 0);
}

function createGuardedFetch({ fetchImpl, fuse, identityTracker }) {
  return async (url, options) => {
    fuse.beforeRequest();
    const response = await fetchImpl(url, options);
    if (response?.ok && typeof response.clone === "function") {
      try {
        const payload = await response.clone().json();
        fuse.observePayload(payload);
        identityTracker.observe(payload);
      } catch (error) {
        if (/provider identity drift/iu.test(String(error?.message ?? error))) {
          const drift = taggedError(String(error.message), "provider_identity_drift");
          throw drift;
        }
      }
    }
    return response;
  };
}

async function runCanonicalArm({
  arm,
  pair,
  evalCase,
  taskFrame,
  skillContext,
  fixtures,
  toolRegistry,
  config,
  apiKey,
  guardedFetch,
  fuse
}) {
  const fixture = fixtures.units[evalCase.unitApiName];
  const renderedContext = renderCandidateSkillContext(skillContext);
  const telemetry = {
    decisionCalls: 0,
    providerLogs: [],
    fixtureAccesses: []
  };
  const handlers = frozenToolHandlers(evalCase, fixtures, telemetry);
  let idIndex = 0;
  const runPrefix = `${pair.pairId}-${arm}`;
  const executor = new ToolExecutor({
    registry: toolRegistry,
    createId: () => `${runPrefix}-tool-${++idIndex}`,
    now: Date.now
  });
  let candidateRendererFailed = false;
  const candidateRenderer = () => {
    try {
      return renderedContext;
    } catch (error) {
      candidateRendererFailed = true;
      throw taggedError(`candidate guidance renderer failed: ${error?.message ?? error}`, "candidate_skill_failure");
    }
  };
  let rawProvider;
  try {
    rawProvider = createReactDecisionProvider({
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey,
      timeoutMs: config.provider.timeoutMs,
      temperature: config.provider.temperature,
      maxTokens: config.provider.maxOutputTokens,
      includeResponseFormat: true,
      thinkingMode: config.provider.thinkingMode,
      messageLayout: config.provider.messageLayout,
      cacheNamespace: config.provider.cacheNamespace,
      ...(arm === "B" ? { guidanceRenderer: candidateRenderer } : {}),
      fetchImpl: guardedFetch,
      onRequestLog(entry) { telemetry.providerLogs.push(sanitizedProviderLog(entry)); }
    });
  } catch (error) {
    if (arm === "B") throw taggedError(`candidate-only runtime construction failed: ${error?.message ?? error}`, "candidate_skill_failure");
    throw error;
  }
  const provider = async (...args) => {
    telemetry.decisionCalls += 1;
    return rawProvider(...args);
  };
  const loop = new ReactLoop({
    registry: toolRegistry,
    toolExecutor: executor,
    decisionProvider: provider,
    handlers,
    availableToolNames: UNIT_PLAY_GUIDANCE_EXPERIMENT_AVAILABLE_TOOLS,
    budget: config.agent,
    groundingMode: config.agent.groundingMode,
    createId: () => `${runPrefix}-loop-${++idIndex}`,
    now: Date.now
  });
  const events = [];
  const context = createRunContext(runPrefix, arm, events, {
    maxRetriesPerTool: config.agent.maxRetriesPerTool
  });
  const fuseBefore = fuse.snapshot();
  const startedAt = performance.now();
  const semanticAdvisory = {
    schemaVersion: "react-semantic-advisory.v1",
    action: "recommend",
    goal: "recommend_unit_play",
    subject: { resolvedId: evalCase.unitApiName, canonicalName: evalCase.unitName },
    expectedOutput: ["unit_play_guidance"]
  };
  const result = await loop.run({
    input: evalCase.input,
    messages: clone(evalCase.messages ?? []),
    seasonContextId: "set17-live",
    taskAnchor: clone(taskFrame),
    semanticAdvisory
  }, context);
  const fuseAfter = fuse.snapshot();
  const errorCodes = events.filter((event) => event.type === "error").map((event) => String(event.data?.code ?? ""));
  if (candidateRendererFailed || (arm === "B" && errorCodes.includes("candidate_skill_failure"))) {
    throw taggedError("candidate guidance renderer failed during the canonical run", "candidate_skill_failure");
  }
  if (errorCodes.includes("provider_identity_drift")) {
    throw taggedError("provider identity drifted during the canonical run", "provider_identity_drift");
  }
  return {
    schemaVersion: "unit-play-guidance-real-provider-arm.v1",
    runIndex: pair.runIndex,
    pairId: pair.pairId,
    caseId: evalCase.caseId,
    repetition: pair.repetition,
    arm,
    result,
    events,
    telemetry: {
      decisionCalls: telemetry.decisionCalls,
      providerHttpRequests: fuseAfter.providerHttpRequests - fuseBefore.providerHttpRequests,
      providerLogs: telemetry.providerLogs,
      actualTotalTokens: telemetryTokenTotal(telemetry.providerLogs),
      e2eLatencyMs: Math.max(0, performance.now() - startedAt),
      fixtureAccesses: telemetry.fixtureAccesses,
      toolCalls: context.counters.toolCalls,
      repairAttempts: telemetry.providerLogs.filter((entry) => entry.status === "retry").length,
      providerTerminalErrors: telemetry.providerLogs.filter((entry) => entry.status === "error").length,
      renderedContextHash: arm === "B" ? sha256(renderedContext) : null,
      guidanceHash: arm === "A" ? BASELINE_GUIDANCE_SHA256 : CANDIDATE_SKILL_CONTENT_SHA256
    },
    answerFacets: answerFacetAudit(result.answer, evalCase),
    evidenceFacets: evidenceFacetAudit(result, evalCase),
    safety: safetyAudit(result, events),
    normalProviderCompletion: nativeSucceeded({ result, safety: safetyAudit(result, events) })
  };
}

function aggregateRuns(runs) {
  const byArm = Object.fromEntries(["A", "B"].map((arm) => {
    const armRuns = runs.filter((run) => run.arm === arm);
    const completed = armRuns.filter((run) => run.normalProviderCompletion).length;
    return [arm, {
      planned: 90,
      attempted: armRuns.length,
      normalProviderCompletions: completed,
      normalProviderCompletionRate: armRuns.length ? completed / armRuns.length : 0,
      meanToolCalls: mean(armRuns.map((run) => run.telemetry.toolCalls)),
      p95ToolCalls: percentile(armRuns.map((run) => run.telemetry.toolCalls), 0.95),
      meanDecisionCalls: mean(armRuns.map((run) => run.telemetry.decisionCalls)),
      p95DecisionCalls: percentile(armRuns.map((run) => run.telemetry.decisionCalls), 0.95),
      meanActualTotalTokens: mean(armRuns.map((run) => run.telemetry.actualTotalTokens)),
      meanE2eLatencyMs: mean(armRuns.map((run) => run.telemetry.e2eLatencyMs)),
      repairAttempts: armRuns.reduce((total, run) => total + run.telemetry.repairAttempts, 0),
      providerTerminalErrors: armRuns.reduce((total, run) => total + run.telemetry.providerTerminalErrors, 0)
    }];
  }));
  const pairGroups = new Map();
  for (const run of runs) {
    if (!pairGroups.has(run.pairId)) pairGroups.set(run.pairId, []);
    pairGroups.get(run.pairId).push(run);
  }
  const validPairs = [...pairGroups.values()].filter((pairRuns) => (
    pairRuns.length === 2 && pairRuns.every((run) => run.normalProviderCompletion)
  ));
  const validPairsByCase = new Map();
  for (const pairRuns of validPairs) {
    const caseId = pairRuns[0].caseId;
    validPairsByCase.set(caseId, (validPairsByCase.get(caseId) ?? 0) + 1);
  }
  return {
    arms: byArm,
    validPairedRepetitions: validPairs.length,
    casesWithAtLeastTwoValidPairs: [...validPairsByCase.values()].filter((count) => count >= 2).length,
    analyzability: {
      validPairedRepetitionsPass: validPairs.length >= 81,
      coveredCasesPass: [...validPairsByCase.values()].filter((count) => count >= 2).length >= 27
    },
    reliability: {
      candidateSkillFailures: 0,
      completionParityPass: byArm.B.normalProviderCompletionRate >= byArm.A.normalProviderCompletionRate - 0.05
    }
  };
}

export function buildBlindedFacetArtifacts(runs, implementationCommitSha) {
  const key = [];
  const packet = runs.map((run) => {
    const blindId = createHash("sha256")
      .update(`${implementationCommitSha}\0${run.pairId}\0${run.arm}`, "utf8")
      .digest("hex")
      .slice(0, 20);
    key.push({ blindId, pairId: run.pairId, caseId: run.caseId, repetition: run.repetition, arm: run.arm });
    return {
      blindId,
      caseId: run.caseId,
      repetition: run.repetition,
      answer: run.result.answer,
      evidence: run.result.evidence,
      supportedFacets: run.answerFacets.supported,
      machineCoverageAdvisoryOnly: run.answerFacets.covered
    };
  }).sort((left, right) => left.blindId.localeCompare(right.blindId));
  return {
    packet: {
      schemaVersion: "unit-play-guidance-blinded-facet-packet.v1",
      armLabelsPresent: false,
      keywordScoringAllowed: false,
      entries: packet
    },
    key: {
      schemaVersion: "unit-play-guidance-blinded-facet-key.v1",
      entries: key.sort((left, right) => left.blindId.localeCompare(right.blindId))
    }
  };
}

export async function runCanonicalRealProviderExperiment({
  config: inputConfig,
  corpus: inputCorpus,
  fixtures: inputFixtures,
  authorization,
  apiKey,
  fetchImpl = globalThis.fetch,
  onCheckpoint = null
} = {}) {
  if (authorization?.providerCallsAuthorized !== true || authorization?.mode !== PR1D_CANONICAL_MODE) {
    throw taggedError("canonical experiment requires an approved unlock proof", "authorization_failed");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("canonical experiment requires fetch");
  const config = clone(inputConfig);
  const corpus = validateCorpus(inputCorpus);
  const fixtures = validateFixtures(inputFixtures);
  const frozenHashChecks = {
    corpus: sha256(corpus) === config.frozen.corpusNormalizedSha256,
    fixtures: sha256(fixtures) === config.frozen.fixtureNormalizedSha256,
    baselineGuidance: BASELINE_GUIDANCE_SHA256 === config.frozen.baselineGuidanceSha256,
    candidateContent: CANDIDATE_SKILL_CONTENT_SHA256 === config.frozen.candidateContentSha256
  };
  if (!Object.values(frozenHashChecks).every(Boolean)) {
    throw taggedError("canonical frozen input hash verification failed", "authorization_failed");
  }
  const plan = buildCanonicalRunPlan(config, corpus);
  if (plan.orderSha256 !== authorization.pairOrderSha256) throw taggedError("canonical pair order drifted", "authorization_failed");
  const { toolRegistry, skillRegistry } = createRegistries();
  const identityTracker = createProviderIdentityTracker();
  const fuse = createCanonicalRunFuse();
  const guardedFetch = createGuardedFetch({ fetchImpl, fuse, identityTracker });
  const runs = [];
  let abort = null;

  for (const pair of plan.pairs) {
    const evalCase = corpus.positive.find((entry) => entry.caseId === pair.caseId);
    const taskFrame = taskFrameFromCase(evalCase);
    assertTaskFramePredicate(taskFrame, evalCase.expectedTaskFramePredicate, evalCase.caseId);
    const selection = matchSkill(taskFrame, skillRegistry);
    if (selection.status !== "selected" || selection.selected.skillId !== "unit_play_guidance") {
      throw taggedError(`${evalCase.caseId} candidate Skill selection failed`, "candidate_skill_failure");
    }
    let skillContext;
    try {
      skillContext = buildSkillContext({
        skill: skillRegistry.get("unit_play_guidance"),
        selection,
        taskFrame,
        runtimeAvailableTools: UNIT_PLAY_GUIDANCE_EXPERIMENT_AVAILABLE_TOOLS
      });
      if (sha256(renderCandidateSkillContext(skillContext)) !== config.frozen.candidateRenderedContextSha256) {
        throw new Error("candidate rendered context hash drifted");
      }
    } catch (error) {
      throw taggedError(`${evalCase.caseId} candidate Skill context failed: ${error?.message ?? error}`, "candidate_skill_failure");
    }
    for (let armOffset = 0; armOffset < pair.order.length; armOffset += 1) {
      const arm = pair.order[armOffset];
      try {
        const run = await runCanonicalArm({
          arm,
          pair: { ...pair, runIndex: runs.length + 1 },
          evalCase,
          taskFrame,
          skillContext,
          fixtures,
          toolRegistry,
          config,
          apiKey,
          guardedFetch,
          fuse
        });
        runs.push(run);
        await onCheckpoint?.({ type: "arm_completed", run: clone(run), fuse: fuse.snapshot() });
      } catch (error) {
        const code = String(error?.code ?? "runtime_failure");
        abort = { code, message: String(error?.message ?? error).slice(0, 500), pairId: pair.pairId, arm };
        await onCheckpoint?.({ type: "attempt_aborted", abort: clone(abort), fuse: fuse.snapshot() });
        if (["candidate_skill_failure", "provider_identity_drift", "budget_failure"].includes(code)) break;
        throw error;
      }
      if (fuse.snapshot().exhausted) {
        abort = {
          code: "budget_failure",
          message: `canonical global fuse opened: ${fuse.snapshot().exhaustedReason}`,
          pairId: pair.pairId,
          arm
        };
        break;
      }
    }
    if (abort) break;
    const pairRuns = runs.filter((run) => run.pairId === pair.pairId);
    if (pairRuns.length === 2) verifyFrozenObservationParity(pairRuns[0], pairRuns[1]);
  }

  const aggregate = aggregateRuns(runs);
  if (abort?.code === "candidate_skill_failure") aggregate.reliability.candidateSkillFailures = 1;
  const identity = identityTracker.snapshot();
  const fuseSnapshot = fuse.snapshot();
  const completedPlan = runs.length === config.execution.plannedAgentRuns;
  const status = abort?.code === "candidate_skill_failure"
    ? "failed"
    : !completedPlan || abort || fuseSnapshot.responsesWithoutUsage > 0
      ? "inconclusive"
      : "awaiting_facet_adjudication";
  const blinded = buildBlindedFacetArtifacts(runs, authorization.implementationCommitSha);
  const result = {
    schemaVersion: PR1D_CANONICAL_SCHEMA_VERSION,
    runtimeVersion: PR1D_CANONICAL_RUNTIME_VERSION,
    status,
    authorization: {
      mode: authorization.mode,
      providerCallsAuthorized: true,
      implementationCommitSha: authorization.implementationCommitSha
    },
    manifest: {
      experimentId: config.experimentId,
      mode: PR1D_CANONICAL_MODE,
      implementationCommitSha: authorization.implementationCommitSha,
      provider: clone(config.provider),
      agent: clone(config.agent),
      credentialSource: authorization.credentialSource,
      credentialConfigured: true,
      credentialBindingConfirmedFor: authorization.credentialBindingConfirmedFor,
      authorization: { implementation: true, providerCalls: true },
      limits: clone(PR1D_CANONICAL_LIMITS),
      frozen: clone(config.frozen)
    },
    plan: {
      pairCount: plan.pairCount,
      plannedAgentRuns: plan.agentRunCount,
      completedAgentRuns: runs.length,
      orderSha256: plan.orderSha256
    },
    fuse: fuseSnapshot,
    providerIdentity: identity,
    abort,
    aggregate,
    hashes: {
      corpus: sha256(corpus),
      fixtures: sha256(fixtures),
      baselineGuidance: BASELINE_GUIDANCE_SHA256,
      candidateContent: CANDIDATE_SKILL_CONTENT_SHA256,
      candidateRenderedContext: config.frozen.candidateRenderedContextSha256
    },
    runs
  };
  const serialized = JSON.stringify(result);
  if (/"apiKey"\s*:|"authorization"\s*:\s*"Bearer|\bbearer\s+[a-z0-9._~+\/-]+/iu.test(serialized)) {
    throw taggedError("secret material reached canonical result", "secret_persistence_failure");
  }
  return { result, blinded };
}
