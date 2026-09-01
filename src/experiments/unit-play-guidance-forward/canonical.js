import { createHash } from "node:crypto";

import { ToolExecutor } from "../../agent/tools/executor.js";
import { createStructuredToolDefinitions } from "../../agent/tools/definitions.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import { ReactLoop } from "../../react/react-loop.js";
import { createReactDecisionProvider } from "../../react/react-decision-provider.js";
import { buildSkillContext, matchSkill, SkillRegistry } from "../../skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_5_7 } from "../../skills/definitions/unit-play-guidance.js";
import { projectUnitPlayModelObservation } from "../unit-play-guidance-browser/candidate.js";
import { sha256, stableJson } from "../unit-play-guidance-control/content.js";
import { createRunContext, taskFrameFromCase } from "../unit-play-guidance-control/harness.js";
import { buildForwardPlan, FORWARD_EXPERIMENT_ID } from "./preflight.js";

export const FORWARD_CANONICAL_SCHEMA_VERSION = "unit-play-guidance-forward-canonical.v2";
export const FORWARD_CANONICAL_RUNTIME_VERSION = "unit-play-guidance-forward-canonical-runtime.v2";
export const FORWARD_CANONICAL_AUTH_ENV = "UNIT_PLAY_GUIDANCE_FORWARD_PROVIDER_AUTHORIZED";
export const FORWARD_CANONICAL_CREDENTIAL_ENV = "OPENAI_API_KEY";
export const FORWARD_CANONICAL_PROVIDER_AUTH_SCHEMA = "unit-play-guidance-forward-provider-authorization.v2";
export const FORWARD_CANONICAL_PAIR_ORDER_SHA256 = "2ad4596d97eacc7cfe77e5460fbe3ed14014988fe7906f5118c2daa4e6719f65";
export const FORWARD_CANONICAL_LIMITS = Object.freeze({
  totalTokenHardCap: 10_000_000,
  providerHttpRequestHardCap: 1_800,
  pairConcurrency: 1
});
export const FORWARD_REVIEW_FACETS = Object.freeze([
  "unit_interpretation",
  "equipment_logic",
  "when_to_play",
  "composition_cards",
  "positioning_cards",
  "concision"
]);

const AVAILABLE_TOOLS = Object.freeze([...UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.allowedTools]);
export const FORWARD_EXPECTED_TOOL_SEQUENCE = Object.freeze([
  "unit_details",
  "unit_builds",
  "item_details_batch",
  "comps_rankings",
  "comps_rankings",
  "composition_tactical_details",
  "comps_rankings",
  "composition_tactical_details"
]);
const clone = (value) => structuredClone(value);

function taggedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tokenReservation(options) {
  let body = {};
  try { body = JSON.parse(options?.body ?? "{}"); } catch { /* provider validates the same body */ }
  const promptBytes = Buffer.byteLength(JSON.stringify(body.messages ?? []));
  return Math.max(1, Math.ceil(promptBytes / 2) + Math.max(0, Number(body.max_tokens ?? 0)));
}

export function createForwardCanonicalFuse() {
  let providerHttpRequests = 0, totalTokens = 0, blockedBeforeDispatch = 0,
    responsesWithoutUsage = 0, reservationUnderflows = 0, exhaustedReason = null;
  const fail = (message, code = "budget_failure") => {
    if (!exhaustedReason) exhaustedReason = code;
    throw taggedError(message, code);
  };
  return {
    beforeRequest(reservedTokens) {
      if (exhaustedReason) fail(`forward canonical fuse is open: ${exhaustedReason}`);
      if (providerHttpRequests + 1 > FORWARD_CANONICAL_LIMITS.providerHttpRequestHardCap) {
        blockedBeforeDispatch += 1;
        fail("forward canonical HTTP-request hard cap reached");
      }
      if (totalTokens + reservedTokens > FORWARD_CANONICAL_LIMITS.totalTokenHardCap) {
        blockedBeforeDispatch += 1;
        fail("forward canonical token hard cap would be exceeded before dispatch");
      }
      providerHttpRequests += 1;
    },
    observePayload(payload, reservedTokens) {
      const observed = Number(payload?.usage?.total_tokens
        ?? (Number(payload?.usage?.prompt_tokens ?? 0) + Number(payload?.usage?.completion_tokens ?? 0)));
      if (!Number.isFinite(observed) || observed <= 0) {
        responsesWithoutUsage += 1;
        fail("Provider response omitted required token usage", "hard_cap_enforcement_failure");
      }
      if (observed > reservedTokens) {
        reservationUnderflows += 1;
        fail("Provider token usage exceeded its pre-dispatch reservation", "hard_cap_enforcement_failure");
      }
      totalTokens += observed;
      if (totalTokens >= FORWARD_CANONICAL_LIMITS.totalTokenHardCap) exhaustedReason = "total_token_hard_cap";
    },
    snapshot: () => ({ limits: FORWARD_CANONICAL_LIMITS, providerHttpRequests, totalTokens,
      blockedBeforeDispatch, responsesWithoutUsage, reservationUnderflows,
      exhausted: exhaustedReason !== null, exhaustedReason })
  };
}

export function createForwardProviderIdentityTracker() {
  let baseline = null, observations = 0;
  return {
    observe(payload) {
      const current = { model: payload?.model ?? null, system_fingerprint: payload?.system_fingerprint ?? null };
      if (!baseline) baseline = current;
      else if (stableJson(current) !== stableJson(baseline)) {
        throw taggedError("Provider identity drifted during the canonical run", "provider_identity_drift");
      }
      observations += 1;
    },
    snapshot: () => ({ baseline: clone(baseline), observations })
  };
}

function exact(actual, expected, label) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw taggedError(`${label} input differs from the frozen query plan`, "frozen_replay_input_mismatch");
  }
}

function responseValue(toolResult, label) {
  if (toolResult?.status !== "completed" || toolResult.toolName !== label) {
    throw taggedError(`invalid frozen ${label} ToolResult`, "frozen_replay_invalid_result");
  }
  return clone(toolResult.value);
}

function cardPlan(card) {
  const result = card.resolvedComps?.value?.results?.find((entry) => (
    entry.compositionRef?.compId === card.candidate?.compositionRef?.compId
  )) ?? card.resolvedComps?.value?.results?.[0];
  return result?.tacticalDetailQueryPlan ?? null;
}

export function createForwardFrozenReplayHandlers(evalCase, observations, telemetry = { accesses: [] }) {
  const fixture = observations?.units?.[evalCase.unitApiName];
  if (!fixture) throw taggedError(`missing frozen observations for ${evalCase.unitApiName}`, "frozen_replay_missing_unit");
  const itemPlan = fixture.unitBuilds?.value?.mechanismQueryPlan;
  const cards = fixture.cards ?? [];
  const byMention = new Map(cards.map((card) => [card.candidate?.compositionRef?.compId, card]));
  const byTactical = new Map(cards.map((card) => {
    const plan = cardPlan(card);
    return [stableJson({ compositionId: plan?.compositionId, clusterId: plan?.clusterId,
      units: plan?.units, seasonContextId: plan?.seasonContextId }), card];
  }));
  const record = (tool, input, toolResult) => {
    const value = responseValue(toolResult, tool);
    telemetry.accesses.push({ tool, input: clone(input), valueSha256: sha256(value) });
    return value;
  };
  return {
    unit_details: async (input) => {
      exact(input, { apiName: evalCase.unitApiName }, "unit_details");
      return record("unit_details", input, fixture.unitDetails);
    },
    unit_builds: async (input) => {
      exact(input, { unit: evalCase.unitApiName }, "unit_builds");
      return record("unit_builds", input, fixture.unitBuilds);
    },
    item_details_batch: async (input) => {
      exact(input, { apiNames: itemPlan.apiNames, seasonContextId: itemPlan.seasonContextId }, "item_details_batch");
      return record("item_details_batch", input, fixture.itemDetailsBatch);
    },
    comps_rankings: async (input) => {
      if (Object.hasOwn(input, "unit")) {
        exact(input, { unit: evalCase.unitApiName }, "comps_rankings candidate query");
        return record("comps_rankings", input, fixture.initialComps);
      }
      const card = byMention.get(input.mention);
      if (!card) throw taggedError("comps_rankings mention is outside the frozen candidates", "frozen_replay_input_mismatch");
      exact(input, { mention: input.mention }, "comps_rankings exact-card query");
      return record("comps_rankings", input, card.resolvedComps);
    },
    composition_tactical_details: async (input) => {
      const card = byTactical.get(stableJson(input));
      if (!card) throw taggedError("tactical query differs from both frozen card plans", "frozen_replay_input_mismatch");
      return record("composition_tactical_details", input, card.tacticalDetails);
    },
    entity_catalog_query: async () => {
      throw taggedError("resolved TaskFrame identity must be reused", "frozen_replay_forbidden_lookup");
    },
    item_details: async () => {
      throw taggedError("unit play evaluation requires the frozen item_details_batch call", "frozen_replay_forbidden_lookup");
    }
  };
}

function projectProviderMessage(message, targetUnitId) {
  if (message.role !== "user") return message;
  let payload;
  try { payload = JSON.parse(message.content); } catch { return message; }
  if (payload?.schemaVersion === "react-transcript-event.v1" && payload.type === "observation") {
    payload.value = projectUnitPlayModelObservation(payload.value, targetUnitId);
  } else if (payload?.state && payload?.toolCatalog) {
    payload.state.observations = (payload.state.observations ?? [])
      .map((entry) => projectUnitPlayModelObservation(entry, targetUnitId));
  }
  return { ...message, content: JSON.stringify(payload) };
}

function actionShapedProjectedFetch(fetchImpl, targetUnitId, telemetry, fuse, identityTracker, transportMode) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    body.messages = body.messages.map((message) => {
      if (message.role !== "assistant") return projectProviderMessage(message, targetUnitId);
      let event;
      try { event = JSON.parse(message.content); } catch { return message; }
      if (event?.schemaVersion === "react-transcript-event.v1" && event.type === "decision"
        && event.value?.schemaVersion === "react-action.v1") {
        return { ...message, content: JSON.stringify(event.value) };
      }
      return message;
    });
    const reservedTokens = tokenReservation({ ...init, body: JSON.stringify(body) });
    fuse.beforeRequest(reservedTokens);
    telemetry.transportRequests += 1;
    telemetry.maxConcurrentTransportRequests = Math.max(telemetry.maxConcurrentTransportRequests,
      ++telemetry.activeTransportRequests);
    try {
      const response = await fetchImpl(url, { ...init, body: JSON.stringify(body) });
      if (typeof response?.clone !== "function") {
        if (transportMode === "real_provider") {
          throw taggedError("real Provider response cannot be audited before consumption", "hard_cap_enforcement_failure");
        }
        return response;
      }
      const payload = await response.clone().json();
      fuse.observePayload(payload, reservedTokens);
      identityTracker.observe(payload);
      return response;
    } finally {
      telemetry.activeTransportRequests -= 1;
    }
  };
}

function renderCandidate(skillContext) {
  return JSON.stringify({
    schemaVersion: "unit-play-browser-candidate.v1",
    contentHash: sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_7)),
    skillContext
  });
}

function providerUsageTotal(logs) {
  return logs.reduce((total, entry) => total + Number(entry.usage?.cachedInputTokens ?? 0)
    + Number(entry.usage?.uncachedInputTokens ?? 0) + Number(entry.usage?.outputTokens ?? 0), 0);
}

export function auditForwardCanonicalRun(run) {
  const toolSequence = (run?.telemetry?.frozenAccesses ?? []).map((entry) => entry.tool);
  const errors = (run?.events ?? []).filter((event) => event.type === "error")
    .map((event) => String(event.data?.code ?? "runtime_error"));
  const checks = {
    nativeCompletion: run?.result?.terminationReason === "completed",
    exactFrozenToolSequence: stableJson(toolSequence) === stableJson(FORWARD_EXPECTED_TOOL_SEQUENCE),
    noRuntimeErrors: errors.length === 0,
    oneTransportAtATime: Number(run?.telemetry?.maxConcurrentTransportRequests ?? 0) <= 1,
    providerUsageComplete: (run?.telemetry?.providerLogs ?? []).every((entry) => entry.usage !== null)
  };
  return { valid: Object.values(checks).every(Boolean), checks, toolSequence, errorCodes: errors };
}

async function runArm({ arm, pair, evalCase, observations, config, authorization, fetchImpl, toolRegistry,
  fuse, identityTracker }) {
  const taskFrame = taskFrameFromCase(evalCase);
  const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_7], toolRegistry });
  const selection = matchSkill(taskFrame, skillRegistry);
  if (selection.status !== "selected") throw taggedError(`${evalCase.caseId} no longer selects the candidate Skill`, "candidate_skill_failure");
  const skillContext = buildSkillContext({ skill: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7, selection, taskFrame,
    runtimeAvailableTools: AVAILABLE_TOOLS });
  const candidateContext = renderCandidate(skillContext);
  if (sha256(candidateContext) !== config.frozen.candidateRenderedContextSha256) {
    throw taggedError("candidate rendered context hash drifted", "candidate_skill_failure");
  }
  const telemetry = { accesses: [], providerLogs: [], transportRequests: 0,
    activeTransportRequests: 0, maxConcurrentTransportRequests: 0 };
  const handlers = createForwardFrozenReplayHandlers(evalCase, observations, telemetry);
  const frozenNow = Date.parse(observations.frozenAt) + 1;
  let id = 0;
  const prefix = `${pair.pairId}-${arm}`;
  const executor = new ToolExecutor({ registry: toolRegistry, createId: () => `${prefix}-tool-${++id}`, now: () => frozenNow });
  const provider = createReactDecisionProvider({
    endpoint: config.provider.endpoint,
    model: config.provider.model,
    apiKey: authorization.transportMode === "real_provider" ? authorization.apiKey : null,
    timeoutMs: config.provider.timeoutMs,
    temperature: config.provider.temperature,
    maxTokens: config.provider.maxOutputTokens,
    includeResponseFormat: true,
    thinkingMode: config.provider.thinkingMode,
    messageLayout: config.provider.messageLayout,
    tacticalPresentationScope: true,
    cacheNamespace: null,
    ...(arm === "B" ? { guidanceRenderer: () => candidateContext } : {}),
    fetchImpl: actionShapedProjectedFetch(fetchImpl, evalCase.unitApiName, telemetry, fuse, identityTracker,
      authorization.transportMode),
    onRequestLog: (entry) => telemetry.providerLogs.push({ status: entry.status, model: entry.model,
      attempts: entry.attempts ?? entry.attempt ?? null, usage: entry.usage ?? null,
      actionType: entry.action?.type ?? null, actionTool: entry.action?.tool ?? null,
      error: entry.error == null ? null : String(entry.error).slice(0, 300) })
  });
  const loop = new ReactLoop({ registry: toolRegistry, toolExecutor: executor, decisionProvider: provider,
    handlers, availableToolNames: AVAILABLE_TOOLS, budget: config.agent, groundingMode: config.agent.groundingMode,
    createId: () => `${prefix}-loop-${++id}`, now: () => frozenNow });
  const events = [];
  const context = createRunContext(pair.pairId, arm, events, { maxRetriesPerTool: config.agent.maxRetriesPerTool });
  context.compositionCardScope = true;
  context.compositionCardsOwnPositioning = true;
  context.officialItemEvidenceV1 = true;
  const result = await loop.run({ input: evalCase.input, messages: clone(evalCase.messages ?? []),
    seasonContextId: observations.seasonContextId, taskAnchor: taskFrame,
    semanticAdvisory: { schemaVersion: "react-semantic-advisory.v1", action: "recommend",
      goal: "recommend_unit_play", subject: { resolvedId: evalCase.unitApiName, canonicalName: evalCase.unitName },
      expectedOutput: ["unit_play_guidance"] } }, context);
  const fatal = events.find((event) => event.type === "error"
    && ["provider_identity_drift", "budget_failure", "hard_cap_enforcement_failure"]
      .includes(String(event.data?.code ?? "")));
  if (fatal) throw taggedError(String(fatal.data?.message ?? fatal.data.code), fatal.data.code);
  const run = {
    schemaVersion: "unit-play-guidance-forward-arm.v2",
    pairId: pair.pairId,
    caseId: pair.caseId,
    repetition: pair.repetition,
    arm,
    input: evalCase.input,
    result,
    events,
    telemetry: {
      toolCalls: context.counters.toolCalls,
      frozenAccesses: telemetry.accesses,
      providerDecisionRequests: telemetry.providerLogs.length,
      transportRequests: telemetry.transportRequests,
      maxConcurrentTransportRequests: telemetry.maxConcurrentTransportRequests,
      actualTotalTokens: providerUsageTotal(telemetry.providerLogs),
      providerLogs: telemetry.providerLogs,
      guidanceSha256: arm === "B" ? config.frozen.candidateRenderedContextSha256 : config.frozen.baselineGuidanceSha256
    }
  };
  return { ...run, audit: auditForwardCanonicalRun(run) };
}

function validateFrozenInputs(config, corpus, observations, preflightResult) {
  if (config?.experimentId !== FORWARD_EXPERIMENT_ID || corpus?.experimentId !== FORWARD_EXPERIMENT_ID
    || observations?.experimentId !== FORWARD_EXPERIMENT_ID) throw taggedError("forward experiment identity drifted", "frozen_input_drift");
  const checks = {
    preflight: preflightResult?.status === "passed",
    corpus: sha256(corpus) === config.frozen.corpusNormalizedSha256,
    observations: sha256(observations) === config.frozen.observationNormalizedSha256,
    candidate: sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_7)) === config.frozen.candidateSkillSha256
  };
  if (!Object.values(checks).every(Boolean)) throw taggedError("canonical frozen input verification failed", "frozen_input_drift");
  const plan = buildForwardPlan(config, corpus);
  if (plan.orderSha256 !== FORWARD_CANONICAL_PAIR_ORDER_SHA256
    || preflightResult.plan?.orderSha256 !== plan.orderSha256) {
    throw taggedError("canonical pair order hash drifted", "frozen_input_drift");
  }
  return plan;
}

export function authorizeForwardCanonicalRun({ config, preflightResult, transportMode = "real_provider",
  cliAuthorized = false, environmentAuthorization, apiKey, endpoint, worktreeClean = false,
  implementationCommitSha, providerAuthorization } = {}) {
  if (transportMode === "fake_test") {
    if (config?.authorization?.realProviderPairedRun !== false) {
      throw taggedError("fake transport is only allowed while real Provider calls remain locked", "authorization_failed");
    }
    return Object.freeze({ transportMode, providerCallsAuthorized: false, actualProviderModelCalls: 0, apiKey: null });
  }
  const failures = [];
  if (transportMode !== "real_provider") failures.push("unsupported transport mode");
  if (config?.authorization?.realProviderPairedRun !== false) failures.push("frozen config Provider lock must remain unchanged");
  if (preflightResult?.status !== "passed") failures.push("zero-call preflight must pass");
  if (cliAuthorized !== true) failures.push("missing --canonical-real-provider");
  if (environmentAuthorization !== "1") failures.push(`${FORWARD_CANONICAL_AUTH_ENV} must equal 1`);
  if (!String(apiKey ?? "").trim()) failures.push(`${FORWARD_CANONICAL_CREDENTIAL_ENV} is not configured`);
  let hostname = null;
  try { hostname = new URL(endpoint).hostname; } catch { failures.push("Provider endpoint is invalid"); }
  if (hostname !== "api.deepseek.com") failures.push("credential binding target must be api.deepseek.com");
  if (worktreeClean !== true) failures.push("call-enabled experiment worktree must be clean");
  if (!/^[0-9a-f]{40}$/u.test(String(implementationCommitSha ?? ""))) failures.push("implementation commit SHA is unavailable");
  if (providerAuthorization?.schemaVersion !== FORWARD_CANONICAL_PROVIDER_AUTH_SCHEMA) {
    failures.push("a separate Provider authorization artifact is required");
  }
  if (providerAuthorization?.experimentId !== FORWARD_EXPERIMENT_ID
    || providerAuthorization?.scope !== "one_formal_paired_run"
    || providerAuthorization?.approved !== true) {
    failures.push("Provider authorization scope is invalid");
  }
  if (providerAuthorization?.approvedCommitSha !== implementationCommitSha) {
    failures.push("Provider authorization is not bound to this implementation commit");
  }
  if (providerAuthorization?.configNormalizedSha256 !== sha256(config)) {
    failures.push("Provider authorization is not bound to the frozen config");
  }
  if (providerAuthorization?.maxAgentRuns !== config?.execution?.plannedAgentRuns
    || providerAuthorization?.maxAgentRuns !== 180) {
    failures.push("Provider authorization run cap must equal the frozen 180-agent-run plan");
  }
  if (providerAuthorization?.provider?.hostname !== hostname
    || providerAuthorization?.provider?.model !== config?.provider?.model) {
    failures.push("Provider authorization target differs from the frozen Provider target");
  }
  if (failures.length) throw taggedError(`forward Provider unlock denied: ${failures.join("; ")}`, "authorization_failed");
  return Object.freeze({ transportMode, providerCallsAuthorized: true, actualProviderModelCalls: null,
    apiKey: String(apiKey), implementationCommitSha: String(implementationCommitSha), hostname,
    authorizationId: String(providerAuthorization.authorizationId ?? "") });
}

export function buildForwardBlindedReviewArtifacts(runs, blindSeed) {
  if (!/^[0-9a-f]{40,64}$/u.test(String(blindSeed ?? ""))) throw new TypeError("blind seed must be a commit or digest");
  const keyEntries = [], packetEntries = [];
  for (const run of runs) {
    const outputId = createHash("sha256").update(`${blindSeed}\0${run.pairId}\0${run.arm}`, "utf8").digest("hex").slice(0, 24);
    keyEntries.push({ outputId, pairId: run.pairId, caseId: run.caseId, repetition: run.repetition, arm: run.arm });
    const evidence = run.result.evidence ?? [];
    const initialComps = evidence.find((entry) => entry.toolName === "comps_rankings"
      && entry.value?.resolution?.status === "unfiltered" && entry.value?.results?.length >= 2);
    const tactical = evidence.filter((entry) => entry.toolName === "composition_tactical_details");
    const compositionCards = (initialComps?.value?.results ?? []).slice(0, 2).map((row) => {
      const rowId = String(row.compositionRef?.compId ?? "").replace(/^cluster:/u, "");
      const details = tactical.find((entry) => [entry.value?.compId, entry.value?.clusterId]
        .some((id) => String(id ?? "").replace(/^cluster:/u, "") === rowId))?.value;
      return { compositionRef: clone(row.compositionRef), members: clone(row.members ?? []),
        traits: clone(row.traits ?? []), stats: clone(row.stats ?? null), source: clone(row.source ?? null),
        formation: clone(details?.formation ?? null) };
    });
    const evidenceSummary = evidence.map((entry) => {
      const projected = projectUnitPlayModelObservation({ type: "tool_result", tool: entry.toolName,
        value: clone(entry.value), evidence: clone(entry) }, observationsTarget(run));
      return { toolName: entry.toolName, source: entry.source, updatedAt: entry.updatedAt,
        value: clone(projected.value ?? projected.evidence?.value ?? null) };
    });
    packetEntries.push({ outputId, caseId: run.caseId, input: run.input, answer: run.result.answer,
      compositionCards, evidenceSummary });
  }
  packetEntries.sort((left, right) => left.outputId.localeCompare(right.outputId));
  keyEntries.sort((left, right) => left.outputId.localeCompare(right.outputId));
  const packet = { schemaVersion: "unit-play-guidance-forward-blinded-packet.v2", experimentId: FORWARD_EXPERIMENT_ID,
    armLabelsPresent: false, pairOrderPresent: false, providerUsagePresent: false,
    keywordScoringAllowed: false, entries: packetEntries };
  const key = { schemaVersion: "unit-play-guidance-forward-blind-key.v2", experimentId: FORWARD_EXPERIMENT_ID,
    entries: keyEntries };
  return { packet, key, packetSha256: sha256(packet), keySha256: sha256(key) };
}

function observationsTarget(run) {
  return run.result.evidence?.find((entry) => entry.toolName === "unit_details")?.value?.apiName ?? null;
}

export function buildForwardIndependentLabelTemplates(packet, reviewerIds = ["reviewer-1", "reviewer-2"]) {
  if (new Set(reviewerIds).size !== 2 || reviewerIds.some((id) => !String(id).trim())) {
    throw new TypeError("exactly two distinct reviewer ids are required");
  }
  const make = (reviewerId) => ({ schemaVersion: "unit-play-guidance-forward-independent-labels.v2",
    experimentId: FORWARD_EXPERIMENT_ID, packetSha256: sha256(packet), reviewerId,
    independentBeforeAdjudication: true,
    labels: packet.entries.flatMap((entry) => FORWARD_REVIEW_FACETS.map((facetId) => ({
      outputId: entry.outputId, caseId: entry.caseId, facetId, rating: null, reasonCodes: [], note: null
    }))) });
  return reviewerIds.map(make);
}

function aggregateForwardRuns(runs) {
  const pairs = new Map();
  for (const run of runs) {
    if (!pairs.has(run.pairId)) pairs.set(run.pairId, []);
    pairs.get(run.pairId).push(run);
  }
  const validPairRuns = [...pairs.values()].filter((pairRuns) => pairRuns.length === 2
    && new Set(pairRuns.map((run) => run.arm)).size === 2 && pairRuns.every((run) => run.audit?.valid));
  const countsByCase = new Map();
  for (const pairRuns of validPairRuns) {
    countsByCase.set(pairRuns[0].caseId, (countsByCase.get(pairRuns[0].caseId) ?? 0) + 1);
  }
  const casesWithAtLeastTwoValidPairs = [...countsByCase.values()].filter((count) => count >= 2).length;
  const analyzability = { validPairedRepetitionsPass: validPairRuns.length >= 81,
    coveredCasesPass: casesWithAtLeastTwoValidPairs >= 27 };
  return { validPairedRepetitions: validPairRuns.length, casesWithAtLeastTwoValidPairs, analyzability,
    validRuns: validPairRuns.flat() };
}

export async function runForwardCanonicalExperiment({ config, corpus, observations, preflightResult,
  authorization, fetchImpl, blindSeed = "0".repeat(40), onCheckpoint = null } = {}) {
  if (!authorization || !["fake_test", "real_provider"].includes(authorization.transportMode)) {
    throw taggedError("canonical experiment requires an authorization proof", "authorization_failed");
  }
  if (authorization.transportMode === "real_provider" && authorization.providerCallsAuthorized !== true) {
    throw taggedError("real Provider transport remains locked", "authorization_failed");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("canonical experiment requires an explicit transport");
  const plan = validateFrozenInputs(config, corpus, observations, preflightResult);
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const fuse = createForwardCanonicalFuse();
  const identityTracker = createForwardProviderIdentityTracker();
  const runs = [];
  for (const pair of plan.pairs) {
    const evalCase = corpus.positive.find((entry) => entry.caseId === pair.caseId);
    for (const arm of pair.order) {
      const run = await runArm({ arm, pair, evalCase, observations, config, authorization, fetchImpl, toolRegistry,
        fuse, identityTracker });
      runs.push(run);
      await onCheckpoint?.({ type: "arm_completed", completedAgentRuns: runs.length,
        pairId: pair.pairId, arm, run: clone(run) });
    }
  }
  const aggregate = aggregateForwardRuns(runs);
  const blinded = buildForwardBlindedReviewArtifacts(aggregate.validRuns, blindSeed);
  const analyzable = Object.values(aggregate.analyzability).every(Boolean);
  const labels = analyzable ? buildForwardIndependentLabelTemplates(blinded.packet) : [];
  const actualProviderModelCalls = authorization.transportMode === "real_provider"
    ? runs.reduce((sum, run) => sum + run.telemetry.transportRequests, 0) : 0;
  return {
    result: {
      schemaVersion: FORWARD_CANONICAL_SCHEMA_VERSION,
      runtimeVersion: FORWARD_CANONICAL_RUNTIME_VERSION,
      experimentId: FORWARD_EXPERIMENT_ID,
      status: analyzable ? "awaiting_independent_review" : "inconclusive",
      claimBoundary: authorization.transportMode === "fake_test"
        ? "scripted fake-transport verification only; zero actual Provider model calls and no efficacy claim"
        : "formal paired outputs awaiting two independent reviewers; no production authorization",
      transportMode: authorization.transportMode,
      plan: { plannedPairs: plan.pairCount, plannedAgentRuns: plan.agentRunCount,
        completedAgentRuns: runs.length, orderSha256: plan.orderSha256, pairConcurrency: 1 },
      actualProviderModelCalls,
      fuse: fuse.snapshot(),
      providerIdentity: identityTracker.snapshot(),
      aggregate: { validPairedRepetitions: aggregate.validPairedRepetitions,
        casesWithAtLeastTwoValidPairs: aggregate.casesWithAtLeastTwoValidPairs,
        analyzability: aggregate.analyzability },
      runs
    },
    blinded,
    labels
  };
}
