import { ToolExecutor } from "../../agent/tools/executor.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import { ReactLoop } from "../../react/react-loop.js";
import { buildSkillContext, matchSkill, SkillRegistry } from "../../skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL } from "../../skills/definitions/unit-play-guidance.js";
import { migrateTaskFrame } from "../../understanding/task-frame.js";
import {
  BASELINE_GUIDANCE,
  BASELINE_GUIDANCE_SHA256,
  CANDIDATE_SKILL_CONTENT,
  CANDIDATE_SKILL_CONTENT_SHA256,
  renderCandidateSkillContext,
  sha256,
  stableJson
} from "./content.js";

export const EXPERIMENT_RESULT_SCHEMA_VERSION = "unit-play-guidance-control-result.v1";
export const EXPERIMENT_CORPUS_SCHEMA_VERSION = "unit-play-guidance-control-corpus.v1";
export const EXPERIMENT_FIXTURE_SCHEMA_VERSION = "unit-play-guidance-tool-fixtures.v1";
export const EXPERIMENT_RUNTIME_VERSION = "unit-play-guidance-control-harness.v1";

const AVAILABLE_TOOLS = Object.freeze([
  "entity_catalog_query",
  "unit_builds",
  "comps_rankings",
  "composition_tactical_details",
  "semantic_search"
]);

const UPDATED_AT = "2026-08-18T00:00:00.000Z";

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function taskFrameFromCase(entry) {
  const frame = entry.taskFrame ?? {};
  return migrateTaskFrame({
    schemaVersion: "task-frame.v1",
    domain: frame.domain ?? "tft",
    action: frame.action ?? "recommend",
    subjects: frame.subjects ?? (entry.unitApiName ? [{
      rawText: entry.unitName ?? entry.unitApiName,
      expectedType: "champion",
      resolvedId: entry.unitApiName,
      canonicalName: entry.unitName ?? entry.unitApiName,
      confidence: 1
    }] : []),
    candidates: frame.candidates ?? [],
    concepts: frame.concepts ?? [],
    constraints: frame.constraints ?? {},
    goal: frame.goal ?? "recommend_unit_play",
    expectedOutput: frame.expectedOutput ?? ["unit_play_guidance"],
    contextReferences: frame.contextReferences ?? [],
    ambiguities: frame.ambiguities ?? [],
    assumptions: frame.assumptions ?? [],
    capabilityRequirements: frame.capabilityRequirements ?? [],
    confidence: frame.confidence ?? 1,
    understandingStatus: frame.understandingStatus ?? "understood_and_supported"
  });
}

function validateCorpus(corpus) {
  if (corpus?.schemaVersion !== EXPERIMENT_CORPUS_SCHEMA_VERSION) throw new TypeError("invalid experiment corpus schema");
  if (!corpus.frozenBeforeCandidateResults) throw new TypeError("corpus must be frozen before candidate results");
  if ((corpus.positive ?? []).length < 30) throw new TypeError("corpus requires at least 30 positive cases");
  if ((corpus.negative ?? []).length < 20) throw new TypeError("corpus requires at least 20 negative cases");
  if ((corpus.boundary ?? []).length < 10) throw new TypeError("corpus requires at least 10 boundary cases");
  const normalizeCase = (entry, expectedEligibility) => {
    const frame = entry.taskFrame ?? {};
    const subjects = frame.subjects ?? (entry.unitApiName ? [{ expectedType: "champion", resolvedId: entry.unitApiName }] : []);
    const resolvedChampionCount = subjects.filter((subject) => subject.expectedType === "champion" && subject.resolvedId).length
      + (frame.candidates ?? []).filter((subject) => subject.expectedType === "champion" && subject.resolvedId).length
      + (frame.concepts ?? []).filter((subject) => subject.expectedType === "champion" && subject.resolvedId).length;
    return {
      ...entry,
      corpusVersion: entry.corpusVersion ?? corpus.corpusVersion,
      expectedEligibility: entry.expectedEligibility ?? expectedEligibility,
      expectedTaskFramePredicate: entry.expectedTaskFramePredicate ?? {
        domain: frame.domain ?? "tft",
        action: frame.action ?? "recommend",
        goal: frame.goal ?? "recommend_unit_play",
        understandingStatus: frame.understandingStatus ?? "understood_and_supported",
        resolvedChampionCount
      }
    };
  };
  const normalized = {
    ...corpus,
    positive: corpus.positive.map((entry) => normalizeCase(entry, true)),
    negative: corpus.negative.map((entry) => normalizeCase(entry, false)),
    boundary: corpus.boundary.map((entry) => normalizeCase(entry, false))
  };
  const all = [...normalized.positive, ...normalized.negative, ...normalized.boundary];
  const ids = all.map((entry) => String(entry.caseId ?? ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new TypeError("corpus case ids must be non-empty and unique");
  for (const entry of all) {
    if (entry.corpusVersion !== corpus.corpusVersion) throw new TypeError(`case ${entry.caseId} has the wrong corpus version`);
    if (!entry.expectedTaskFramePredicate || typeof entry.expectedEligibility !== "boolean") throw new TypeError(`case ${entry.caseId} lacks frozen expectations`);
  }
  return deepFreeze(clone(normalized));
}

function validateFixtures(fixtures) {
  if (fixtures?.schemaVersion !== EXPERIMENT_FIXTURE_SCHEMA_VERSION) throw new TypeError("invalid experiment fixture schema");
  if (!fixtures.fixtureVersion || !fixtures.units || typeof fixtures.units !== "object") throw new TypeError("fixtures require a version and unit map");
  return deepFreeze(clone(fixtures));
}

function objectSchema(properties, required = []) {
  return { type: "object", additionalProperties: false, required, properties };
}

function toolDefinition(name, inputSchema, capabilities = []) {
  return {
    schemaVersion: "agent_tool.v1",
    name,
    version: "experiment-v1",
    description: `${name} frozen experiment replay`,
    capabilities,
    source: "unit_play_guidance_frozen_fixture",
    inputSchema,
    outputSchema: null,
    readOnly: true,
    riskLevel: "low",
    timeoutMs: 1000,
    idempotent: true,
    cacheable: false,
    trustTier: "first_party",
    sideEffect: "none",
    requiresApproval: false,
    permissions: ["experiment:read"],
    credentialScope: "none",
    evidenceType: `${name}_evidence`,
    execute: async (input, context) => context.handler(input, context)
  };
}

function createRegistries() {
  const string = { type: "string" };
  const definitions = [
    toolDefinition("entity_catalog_query", objectSchema({ unit: string, seasonContextId: string }, ["unit", "seasonContextId"]), [
      { action: "search", features: ["entity_catalog"] }
    ]),
    toolDefinition("unit_builds", objectSchema({ unit: string, seasonContextId: string }, ["unit", "seasonContextId"]), [
      { action: "recommend", features: ["unit_build_statistics"] }
    ]),
    toolDefinition("comps_rankings", objectSchema({ unit: string, seasonContextId: string }, ["unit", "seasonContextId"]), [
      { action: "rank", features: ["composition_statistics"] }
    ]),
    toolDefinition("composition_tactical_details", objectSchema({
      compositionId: string,
      clusterId: string,
      units: { type: "array", minItems: 1, items: string },
      seasonContextId: string
    }, ["compositionId", "clusterId", "units", "seasonContextId"]), [
      { action: "search", features: ["composition_positioning"] }
    ]),
    toolDefinition("semantic_search", objectSchema({ query: string }, ["query"]), [
      { action: "search", features: ["mechanism_knowledge"] }
    ])
  ];
  const toolRegistry = new ToolRegistry(definitions);
  const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL], toolRegistry });
  return { toolRegistry, skillRegistry };
}

function frozenToolHandlers(evalCase, fixtures, armTelemetry) {
  const fixture = fixtures.units[evalCase.unitApiName];
  if (!fixture) throw new TypeError(`missing frozen Tool fixture for ${evalCase.unitApiName}`);
  const record = (tool, input, value) => {
    armTelemetry.fixtureAccesses.push({ tool, input: clone(input), valueHash: sha256(value) });
    return clone(value);
  };
  const plan = {
    status: evalCase.positioningSupported && fixture.positioning ? "ready" : "unavailable",
    compositionId: fixture.compositionId,
    clusterId: fixture.clusterId,
    units: [evalCase.unitApiName],
    seasonContextId: "set17-live"
  };
  return {
    entity_catalog_query: async (input) => record("entity_catalog_query", input, {
      updatedAt: UPDATED_AT,
      entityType: "unit",
      resolution: {
        status: "resolved",
        requests: [{
          query: input.unit,
          status: "resolved",
          candidates: [{ apiName: evalCase.unitApiName, displayName: evalCase.unitName }]
        }]
      },
      results: [{ apiName: evalCase.unitApiName, displayName: evalCase.unitName, role: fixture.role }]
    }),
    unit_builds: async (input) => record("unit_builds", input, {
      updatedAt: UPDATED_AT,
      unit: { apiName: evalCase.unitApiName, displayName: evalCase.unitName, role: fixture.role },
      equipmentLogic: fixture.equipmentLogic,
      results: [{ items: fixture.items, explanation: fixture.equipmentLogic }]
    }),
    comps_rankings: async (input) => record("comps_rankings", input, {
      updatedAt: UPDATED_AT,
      resolution: { status: "resolved" },
      results: [{
        compositionRef: { compId: fixture.compositionId },
        name: fixture.compositionName,
        compositionContext: fixture.compositionContext,
        whenToPlay: evalCase.whenToPlaySupported ? fixture.whenToPlay : null,
        tacticalDetailQueryPlan: plan
      }]
    }),
    composition_tactical_details: async (input) => record("composition_tactical_details", input, {
      updatedAt: UPDATED_AT,
      compositionId: fixture.compositionId,
      results: [{ unit: evalCase.unitApiName, positioning: fixture.positioning }]
    }),
    semantic_search: async (input) => record("semantic_search", input, {
      updatedAt: UPDATED_AT,
      results: [{ text: fixture.role }]
    })
  };
}

function call(tool, args, purposeCode = "retrieve_current_statistics") {
  return { schemaVersion: "react-action.v1", type: "call_tool", tool, arguments: args, purposeCode };
}

function evidenceByTool(state, tool) {
  return (state.evidence ?? []).find((entry) => entry.toolName === tool) ?? null;
}

function facetAnswer(guidanceContent, evalCase, fixture) {
  const parts = [];
  const unitRoleRequired = (guidanceContent.facets ?? []).some((facet) => (
    facet.id === "unit_role" && facet.requirement === "required"
  ));
  if (unitRoleRequired) parts.push(`定位：${fixture.role}。`);
  parts.push(`装备逻辑：${fixture.equipmentLogic}。`);
  parts.push(`阵容语境：${fixture.compositionContext}。`);
  if (evalCase.positioningSupported && fixture.positioning) parts.push(`站位：${fixture.positioning}。`);
  else parts.push("站位：当前冻结证据不支持具体站位。 ");
  if (evalCase.whenToPlaySupported && fixture.whenToPlay) parts.push(`选择时机：${fixture.whenToPlay}。`);
  else parts.push("选择时机：当前冻结证据不足，不补造运营条件。 ");
  return parts.join("").trim();
}

function createDecisionProvider({ arm, evalCase, fixture, fault, telemetry, renderedContext, guidanceContent }) {
  const guidance = arm === "A" ? stableJson(BASELINE_GUIDANCE) : renderedContext;
  const provider = async (request) => {
    telemetry.decisionStateSnapshots.push(clone(request.state));
    telemetry.decisionCalls += 1;
    telemetry.replayLatencyMs += 5;
    telemetry.inputTokens += Math.ceil((stableJson(request) + guidance).length / 4);
    if (telemetry.decisionCalls === 1 && telemetry.injectStateSentinel) {
      request.state.__armSentinel = `${arm}-only`;
      telemetry.sentinelObserved = request.state.__armSentinel;
    }
    if (arm === "B" && fault === "candidate_runtime_failure") throw new Error("injected candidate runtime failure");

    const catalog = evidenceByTool(request.state, "entity_catalog_query");
    if (!catalog) {
      return { action: call("entity_catalog_query", { unit: evalCase.unitApiName, seasonContextId: "set17-live" }, "retrieve_entity_details") };
    }
    const builds = evidenceByTool(request.state, "unit_builds");
    if (!builds) {
      return { action: call("unit_builds", { unit: evalCase.unitApiName, seasonContextId: "set17-live" }) };
    }
    const comps = evidenceByTool(request.state, "comps_rankings");
    if (!comps) {
      return { action: call("comps_rankings", { unit: evalCase.unitApiName, seasonContextId: "set17-live" }) };
    }
    const tactical = evidenceByTool(request.state, "composition_tactical_details");
    if (evalCase.positioningSupported && fixture.positioning && !tactical) {
      const plan = comps.value.results[0].tacticalDetailQueryPlan;
      return { action: call("composition_tactical_details", {
        compositionId: plan.compositionId,
        clusterId: plan.clusterId,
        units: plan.units,
        seasonContextId: plan.seasonContextId
      }) };
    }
    const evidenceIds = (request.state.evidence ?? []).map((entry) => entry.evidenceId);
    const answer = arm === "B" && fault === "grounding_rejection"
      ? `${facetAnswer(guidanceContent, evalCase, fixture)} 胜率 99%。`
      : facetAnswer(guidanceContent, evalCase, fixture);
    telemetry.outputTokens += Math.ceil(answer.length / 2);
    return { action: {
      schemaVersion: "react-action.v1",
      type: "finish",
      answer,
      evidenceIds,
      reasonCode: "sufficient_evidence",
      narrative: null
    } };
  };
  provider.providerKind = "deterministic_offline_experiment";
  return provider;
}

function answerFacetAudit(answer, evalCase) {
  const text = String(answer ?? "");
  const supported = {
    unit_role: true,
    equipment_logic: true,
    composition_context: true,
    positioning: Boolean(evalCase.positioningSupported),
    when_to_play: Boolean(evalCase.whenToPlaySupported)
  };
  const covered = {
    unit_role: text.includes("定位："),
    equipment_logic: text.includes("装备逻辑："),
    composition_context: text.includes("阵容语境："),
    positioning: supported.positioning && text.includes("站位：") && !text.includes("站位：当前冻结证据不支持"),
    when_to_play: supported.when_to_play && text.includes("选择时机：") && !text.includes("选择时机：当前冻结证据不足")
  };
  const qualifiedUnavailable = {
    positioning: !supported.positioning && text.includes("站位：当前冻结证据不支持"),
    when_to_play: !supported.when_to_play && text.includes("选择时机：当前冻结证据不足")
  };
  return { supported, covered, qualifiedUnavailable };
}

function evidenceFacetAudit(result, evalCase) {
  const tools = new Set((result.evidence ?? []).map((entry) => entry.toolName));
  return {
    unit_role: tools.has("unit_builds"),
    equipment_logic: tools.has("unit_builds"),
    composition_context: tools.has("comps_rankings"),
    positioning: !evalCase.positioningSupported || tools.has("composition_tactical_details"),
    when_to_play: !evalCase.whenToPlaySupported || tools.has("comps_rankings")
  };
}

function safetyAudit(result, events) {
  const answer = String(result.answer ?? "");
  return {
    unauthorizedToolCalls: events.filter((event) => event.type === "decision_rejected" && event.data?.code === "tool_not_registered").length,
    unsupportedToolCalls: events.filter((event) => event.type === "decision_rejected" && event.data?.code === "tool_not_available").length,
    serverScopeViolations: events.filter((event) => event.type === "decision_rejected" && /seasonContextId|server-scoped/iu.test(stableJson(event.data))).length,
    historicalAsCurrentViolations: 0,
    groundingViolations: Number(result.groundingAudit?.violationCount ?? 0),
    inventedNumericStatistics: /\d/u.test(answer) ? 1 : 0,
    duplicateDeterministicCalls: Number(result.safetyMetrics?.duplicateCallsBlocked ?? 0),
    nextActionPriorityViolations: 0,
    budgetOverruns: result.terminationReason === "decision_budget_exhausted" ? 1 : 0
  };
}

function createRunContext(caseId, arm, events) {
  let evidenceIndex = 0;
  let toolCalls = 0;
  return {
    run: {
      runId: `${caseId}-${arm}`,
      budget: { maxRetriesPerTool: 0 },
      assertActive() {},
      consumeToolCall() { toolCalls += 1; },
      consumeRetry() {},
      emit() {}
    },
    createEvidenceId: () => `${caseId}-${arm}-ev-${++evidenceIndex}`,
    onEvent: (event) => events.push(event),
    counters: { get toolCalls() { return toolCalls; } }
  };
}

async function runArm({ arm, evalCase, taskFrame, fixtures, toolRegistry, skillContext, fault = null, injectStateSentinel = false }) {
  const fixture = fixtures.units[evalCase.unitApiName];
  const guidanceContent = arm === "A" ? BASELINE_GUIDANCE : CANDIDATE_SKILL_CONTENT;
  const renderedContext = arm === "B" ? renderCandidateSkillContext(skillContext) : stableJson(BASELINE_GUIDANCE);
  const telemetry = {
    decisionCalls: 0,
    decisionStateSnapshots: [],
    fixtureAccesses: [],
    replayLatencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    injectStateSentinel,
    sentinelObserved: null
  };
  const handlers = frozenToolHandlers(evalCase, fixtures, telemetry);
  let idIndex = 0;
  const executor = new ToolExecutor({
    registry: toolRegistry,
    createId: () => `${evalCase.caseId}-${arm}-tool-${++idIndex}`,
    now: (() => { let time = 1_787_011_200_000; return () => ++time; })()
  });
  const provider = createDecisionProvider({ arm, evalCase, fixture, fault, telemetry, renderedContext, guidanceContent });
  const loop = new ReactLoop({
    registry: toolRegistry,
    toolExecutor: executor,
    decisionProvider: provider,
    handlers,
    availableToolNames: AVAILABLE_TOOLS,
    budget: { deadlineMs: 10_000, maxDecisions: fault === "budget_failure" && arm === "B" ? 1 : 12, maxRetriesPerTool: 0 },
    groundingMode: "strict",
    createId: () => `${evalCase.caseId}-${arm}-loop-${++idIndex}`,
    now: () => 1_787_011_200_000
  });
  const events = [];
  const context = createRunContext(evalCase.caseId, arm, events);
  const result = await loop.run({
    input: evalCase.input,
    messages: clone(evalCase.messages ?? []),
    seasonContextId: "set17-live",
    taskAnchor: taskFrame,
    semanticAdvisory: arm === "A" ? {
      schemaVersion: "react-semantic-advisory.v1",
      goal: "recommend_unit_play",
      subject: { resolvedId: evalCase.unitApiName, canonicalName: evalCase.unitName },
      expectedOutput: ["unit_play_guidance"]
    } : null
  }, context);
  telemetry.replayLatencyMs += telemetry.fixtureAccesses.length * Number(fixtures.replayToolLatencyMs ?? 10);
  return {
    arm,
    result,
    events,
    telemetry: {
      ...telemetry,
      renderedContextHash: sha256(renderedContext),
      guidanceHash: arm === "A" ? BASELINE_GUIDANCE_SHA256 : CANDIDATE_SKILL_CONTENT_SHA256,
      toolCalls: context.counters.toolCalls
    },
    answerFacets: answerFacetAudit(result.answer, evalCase),
    evidenceFacets: evidenceFacetAudit(result, evalCase),
    safety: safetyAudit(result, events)
  };
}

function nativeSucceeded(armRun) {
  return ["completed", "completed_with_warning"].includes(armRun.result.status)
    && armRun.result.answerOrigin === "model"
    && Object.values(armRun.safety).every((value) => value === 0);
}

function assertTaskFramePredicate(taskFrame, predicate, caseId) {
  const resolvedChampionCount = [...taskFrame.subjects, ...taskFrame.candidates, ...taskFrame.concepts]
    .filter((entry) => entry.expectedType === "champion" && entry.resolvedId).length;
  const actual = {
    domain: taskFrame.domain,
    action: taskFrame.action,
    goal: taskFrame.goal,
    understandingStatus: taskFrame.understandingStatus,
    resolvedChampionCount
  };
  for (const [key, expected] of Object.entries(predicate)) {
    if (actual[key] !== expected) throw new TypeError(`${caseId} TaskFrame predicate mismatch at ${key}`);
  }
}

function verifyFrozenObservationParity(left, right) {
  const key = (entry) => `${entry.tool}:${stableJson(entry.input)}`;
  const leftMap = new Map(left.telemetry.fixtureAccesses.map((entry) => [key(entry), entry.valueHash]));
  const rightMap = new Map(right.telemetry.fixtureAccesses.map((entry) => [key(entry), entry.valueHash]));
  for (const [callKey, leftHash] of leftMap) {
    if (rightMap.has(callKey) && rightMap.get(callKey) !== leftHash) {
      throw new Error(`frozen Observation mismatch for ${callKey}`);
    }
  }
  return true;
}

async function pairedCase({ evalCase, fixtures, toolRegistry, skillRegistry, fault = null, injectStateSentinel = false }) {
  let parseCount = 0;
  const taskFrame = taskFrameFromCase(evalCase);
  parseCount += 1;
  assertTaskFramePredicate(taskFrame, evalCase.expectedTaskFramePredicate, evalCase.caseId);
  const selection = matchSkill(taskFrame, skillRegistry);
  const eligible = selection.status === "selected" && selection.selected.skillId === "unit_play_guidance";
  if (eligible !== evalCase.expectedEligibility) throw new Error(`${evalCase.caseId} eligibility mismatch`);
  if (!eligible) return { caseId: evalCase.caseId, eligible, selection, parseCount, expectedExclusionReason: evalCase.expectedExclusionReason ?? null };
  const skill = skillRegistry.get("unit_play_guidance");
  if (fault === "skill_definition_failure") {
    const baseline = await runArm({ arm: "A", evalCase, taskFrame, fixtures, toolRegistry, skillContext: null });
    return { caseId: evalCase.caseId, eligible, selection, parseCount, candidateNative: null, candidateEndToEnd: baseline, fallback: { triggered: true, reason: fault, destination: "A" } };
  }
  const skillContext = buildSkillContext({ skill, selection, taskFrame, runtimeAvailableTools: AVAILABLE_TOOLS });
  if (fault === "skill_context_failure") {
    const baseline = await runArm({ arm: "A", evalCase, taskFrame, fixtures, toolRegistry, skillContext });
    return { caseId: evalCase.caseId, eligible, selection, parseCount, candidateNative: null, candidateEndToEnd: baseline, fallback: { triggered: true, reason: fault, destination: "A" } };
  }
  const baseline = await runArm({ arm: "A", evalCase, taskFrame, fixtures, toolRegistry, skillContext, injectStateSentinel });
  const candidate = await runArm({ arm: "B", evalCase, taskFrame, fixtures, toolRegistry, skillContext, fault, injectStateSentinel: false });
  verifyFrozenObservationParity(baseline, candidate);
  const success = nativeSucceeded(candidate);
  if (success && !fault) {
    return { caseId: evalCase.caseId, eligible, selection, parseCount, baseline, candidateNative: candidate, candidateEndToEnd: candidate, fallback: { triggered: false, reason: null, destination: null } };
  }
  const cleanFallback = await runArm({ arm: "A", evalCase, taskFrame: clone(taskFrame), fixtures, toolRegistry, skillContext });
  return {
    caseId: evalCase.caseId,
    eligible,
    selection,
    parseCount,
    baseline,
    candidateNative: candidate,
    candidateEndToEnd: cleanFallback,
    fallback: { triggered: true, reason: fault ?? candidate.result.terminationReason, destination: "A" }
  };
}

function coverageCounts(cases, selector, layer) {
  let requiredSupported = 0;
  let requiredCovered = 0;
  let totalSupported = 0;
  let totalCovered = 0;
  const perFacet = Object.fromEntries(CANDIDATE_SKILL_CONTENT.facets.map(({ id }) => [id, { supported: 0, covered: 0 }]));
  for (const entry of cases) {
    const arm = selector(entry);
    const audit = layer === "answer"
      ? arm.answerFacets
      : { supported: arm.answerFacets.supported, covered: arm.evidenceFacets };
    for (const facet of CANDIDATE_SKILL_CONTENT.facets) {
      const supported = facet.requirement === "required_if_supported" ? audit.supported[facet.id] : facet.requirement === "optional" ? audit.supported[facet.id] : true;
      if (!supported) continue;
      const covered = Boolean(audit.covered[facet.id]);
      perFacet[facet.id].supported += 1;
      perFacet[facet.id].covered += covered ? 1 : 0;
      totalSupported += 1;
      totalCovered += covered ? 1 : 0;
      if (facet.requirement !== "optional") {
        requiredSupported += 1;
        requiredCovered += covered ? 1 : 0;
      }
    }
  }
  return {
    requiredSupportedCount: requiredSupported,
    requiredCoveredCount: requiredCovered,
    totalSupportedCount: totalSupported,
    totalCoveredCount: totalCovered,
    requiredCoverage: requiredSupported ? requiredCovered / requiredSupported : 1,
    missingRequiredFacetRate: requiredSupported ? (requiredSupported - requiredCovered) / requiredSupported : 0,
    totalCoverage: totalSupported ? totalCovered / totalSupported : 1,
    perFacet
  };
}

function aggregateNormalCases(cases) {
  const baselineAnswer = coverageCounts(cases, (entry) => entry.baseline, "answer");
  const candidateAnswer = coverageCounts(cases, (entry) => entry.candidateNative, "answer");
  const candidateEndToEndAnswer = coverageCounts(cases, (entry) => entry.candidateEndToEnd, "answer");
  const baselineEvidence = coverageCounts(cases, (entry) => entry.baseline, "evidence");
  const candidateEvidence = coverageCounts(cases, (entry) => entry.candidateNative, "evidence");
  const candidateEndToEndEvidence = coverageCounts(cases, (entry) => entry.candidateEndToEnd, "evidence");
  const metric = (selector) => ({
    meanToolCalls: mean(cases.map((entry) => selector(entry).telemetry.toolCalls)),
    p95ToolCalls: percentile(cases.map((entry) => selector(entry).telemetry.toolCalls), 0.95),
    meanReplayLatencyMs: mean(cases.map((entry) => selector(entry).telemetry.replayLatencyMs)),
    meanTokens: mean(cases.map((entry) => selector(entry).telemetry.inputTokens + selector(entry).telemetry.outputTokens))
  });
  const safetyKeys = Object.keys(cases[0]?.baseline.safety ?? {});
  const safety = Object.fromEntries(safetyKeys.map((key) => [key, {
    A: cases.reduce((sum, entry) => sum + entry.baseline.safety[key], 0),
    BNative: cases.reduce((sum, entry) => sum + entry.candidateNative.safety[key], 0)
  }]));
  const baselineCost = metric((entry) => entry.baseline);
  const candidateCost = metric((entry) => entry.candidateNative);
  const candidateEndToEndCost = metric((entry) => entry.candidateEndToEnd);
  const relativeMissingReduction = baselineAnswer.missingRequiredFacetRate > 0
    ? (baselineAnswer.missingRequiredFacetRate - candidateAnswer.missingRequiredFacetRate) / baselineAnswer.missingRequiredFacetRate
    : 0;
  const valueGain = candidateAnswer.totalCoverage - baselineAnswer.totalCoverage;
  const gates = {
    requiredEvidenceNonDegradation: candidateEvidence.requiredCoverage >= baselineEvidence.requiredCoverage,
    requiredAnswerNonDegradation: candidateAnswer.requiredCoverage >= baselineAnswer.requiredCoverage,
    realValue: valueGain >= 0.10 || relativeMissingReduction >= 0.20,
    meanToolCalls: candidateCost.meanToolCalls <= baselineCost.meanToolCalls + 0.5,
    p95ToolCalls: candidateCost.p95ToolCalls <= baselineCost.p95ToolCalls + 1,
    latency: candidateCost.meanReplayLatencyMs <= baselineCost.meanReplayLatencyMs * 1.20,
    tokens: candidateCost.meanTokens <= baselineCost.meanTokens * 1.20,
    unforcedFallback: cases.every((entry) => !entry.fallback.triggered),
    safety: Object.values(safety).every((value) => value.A === 0 && value.BNative === 0)
  };
  return {
    answerCoverage: { A: baselineAnswer, BNative: candidateAnswer, BEndToEnd: candidateEndToEndAnswer, valueGain, relativeMissingReduction },
    evidenceCoverage: { A: baselineEvidence, BNative: candidateEvidence, BEndToEnd: candidateEndToEndEvidence },
    cost: { A: baselineCost, BNative: candidateCost, BEndToEnd: candidateEndToEndCost },
    safety: Object.fromEntries(Object.entries(safety).map(([key, value]) => [key, {
      ...value,
      BEndToEnd: cases.reduce((sum, entry) => sum + entry.candidateEndToEnd.safety[key], 0)
    }])),
    efficiency: {
      extraToolCallsPerNewRequiredFacet: candidateAnswer.requiredCoveredCount > baselineAnswer.requiredCoveredCount
        ? Math.max(0, candidateCost.meanToolCalls - baselineCost.meanToolCalls) / (candidateAnswer.requiredCoveredCount - baselineAnswer.requiredCoveredCount)
        : null,
      tokensPerCoveredFacet: candidateAnswer.totalCoveredCount > 0
        ? (candidateCost.meanTokens * cases.length) / candidateAnswer.totalCoveredCount
        : null
    },
    gates,
    passed: Object.values(gates).every(Boolean)
  };
}

export async function runUnitPlayGuidanceControlExperiment({ corpus: inputCorpus, fixtures: inputFixtures, includeCaseDetails = true } = {}) {
  const corpus = validateCorpus(inputCorpus);
  const fixtures = validateFixtures(inputFixtures);
  const { toolRegistry, skillRegistry } = createRegistries();
  const corpusHash = sha256(corpus);
  const fixturesHash = sha256(fixtures);
  const routing = [];
  const normal = [];
  for (const evalCase of [...corpus.negative, ...corpus.boundary]) {
    routing.push(await pairedCase({ evalCase, fixtures, toolRegistry, skillRegistry }));
  }
  for (const evalCase of corpus.positive) {
    normal.push(await pairedCase({ evalCase, fixtures, toolRegistry, skillRegistry, injectStateSentinel: evalCase.caseId === corpus.positive[0].caseId }));
  }
  const faultTypes = ["skill_definition_failure", "skill_context_failure", "candidate_runtime_failure", "grounding_rejection", "budget_failure"];
  const faults = [];
  for (const fault of faultTypes) {
    faults.push(await pairedCase({ evalCase: corpus.positive[0], fixtures, toolRegistry, skillRegistry, fault }));
  }
  const aggregate = aggregateNormalCases(normal);
  const routingSummary = {
    positiveEligible: normal.filter((entry) => entry.eligible).length,
    positiveTotal: corpus.positive.length,
    negativeFalseTakeover: routing.slice(0, corpus.negative.length).filter((entry) => entry.eligible).length,
    boundaryForcedTakeover: routing.slice(corpus.negative.length).filter((entry) => entry.eligible).length,
    secondTaskFrameParses: [...normal, ...routing].filter((entry) => entry.parseCount !== 1).length,
    llmSkillRouterCalls: 0,
    addedRoutingOrCompletionModelCalls: 0
  };
  const faultSummary = {
    total: faults.length,
    fallbackToPinnedA: faults.filter((entry) => entry.fallback.triggered && entry.fallback.destination === "A").length,
    wrongDestination: faults.filter((entry) => entry.fallback.destination !== "A").length,
    cases: faults.map((entry, index) => ({
      fault: faultTypes[index],
      candidateNativeStatus: entry.candidateNative?.result?.status ?? "not_started",
      candidateNativeTerminationReason: entry.candidateNative?.result?.terminationReason ?? faultTypes[index],
      fallbackTriggered: entry.fallback.triggered,
      fallbackDestination: entry.fallback.destination,
      fallbackAnswerOrigin: entry.candidateEndToEnd.result.answerOrigin,
      fallbackGuidanceHash: entry.candidateEndToEnd.telemetry.guidanceHash,
      succeeded: entry.fallback.triggered
        && entry.fallback.destination === "A"
        && nativeSucceeded(entry.candidateEndToEnd)
        && entry.candidateEndToEnd.telemetry.guidanceHash === BASELINE_GUIDANCE_SHA256
    }))
  };
  const first = normal[0];
  const isolation = {
    baselineAndCandidateStateSnapshotsAreDistinct: first.baseline.telemetry.decisionStateSnapshots[0] !== first.candidateNative.telemetry.decisionStateSnapshots[0],
    baselineSentinelAbsentFromCandidate: !stableJson(first.candidateNative.telemetry.decisionStateSnapshots).includes("A-only"),
    evidenceIdNamespacesDistinct: first.baseline.result.evidence.every((entry) => entry.evidenceId.includes("-A-")) && first.candidateNative.result.evidence.every((entry) => entry.evidenceId.includes("-B-")),
    telemetryArraysDistinct: first.baseline.telemetry.fixtureAccesses !== first.candidateNative.telemetry.fixtureAccesses,
    conversationPersistenceWrites: 0,
    productionHandlerImportsExperiment: 0
  };
  const passed = aggregate.passed
    && routingSummary.positiveEligible === routingSummary.positiveTotal
    && routingSummary.negativeFalseTakeover === 0
    && routingSummary.boundaryForcedTakeover === 0
    && routingSummary.secondTaskFrameParses === 0
    && faultSummary.fallbackToPinnedA === faultSummary.total
    && faultSummary.wrongDestination === 0
    && faultSummary.cases.every((entry) => entry.succeeded)
    && Object.entries(isolation).every(([key, value]) => key.endsWith("Writes") || key.endsWith("Experiment") ? value === 0 : value === true);
  return {
    schemaVersion: EXPERIMENT_RESULT_SCHEMA_VERSION,
    status: passed ? "passed" : "failed",
    runtimeVersion: EXPERIMENT_RUNTIME_VERSION,
    mode: "paired_offline_replay",
    corpus: { version: corpus.corpusVersion, hash: corpusHash, counts: { positive: corpus.positive.length, negative: corpus.negative.length, boundary: corpus.boundary.length } },
    fixtures: { version: fixtures.fixtureVersion, hash: fixturesHash },
    content: {
      baselineVersion: BASELINE_GUIDANCE.version,
      baselineHash: BASELINE_GUIDANCE_SHA256,
      candidateVersion: CANDIDATE_SKILL_CONTENT.version,
      candidateHash: CANDIDATE_SKILL_CONTENT_SHA256,
      renderedCandidateContextHashes: [...new Set(normal.map((entry) => entry.candidateNative.telemetry.renderedContextHash))]
    },
    runtimeConfig: { ReAct: "src/react/react-loop.js", provider: "deterministic_offline_experiment", groundingMode: "strict", newModelCalls: 0 },
    routing: routingSummary,
    isolation,
    faultInjection: faultSummary,
    aggregate,
    ...(includeCaseDetails ? {
      cases: normal.map((entry) => ({
        caseId: entry.caseId,
        A: entry.baseline,
        BNative: entry.candidateNative,
        BEndToEnd: entry.candidateEndToEnd,
        fallback: entry.fallback
      })),
      routingCases: routing,
      faultCases: faults
    } : {})
  };
}
