import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { officialItemBatchEvidenceFailure } from "../../agent/official-item-evidence.js";
import { createStructuredToolDefinitions } from "../../agent/tools/definitions.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import { projectUnitPlayModelObservation } from "../unit-play-guidance-browser/candidate.js";
import { stableJson, sha256 } from "../unit-play-guidance-control/content.js";
import { taskFrameFromCase } from "../unit-play-guidance-control/harness.js";
import { createReactDecisionProvider, REACT_SCOPED_TACTICAL_PROMPT_VERSION } from "../../react/react-decision-provider.js";
import { buildSkillContext, matchSkill, SkillRegistry } from "../../skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL, UNIT_PLAY_GUIDANCE_SKILL_V1_5_7 } from "../../skills/definitions/unit-play-guidance.js";

export const FORWARD_PREFLIGHT_SCHEMA_VERSION = "unit-play-guidance-forward-preflight.v2";
export const FORWARD_EXPERIMENT_ID = "unit-play-guidance-forward.2026-09-01.v2";
const PINNED_CANDIDATE_HASH = "a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8";

const clone = (value) => structuredClone(value);
const unique = (values) => new Set(values).size === values.length;

export function deterministicForwardPairOrder(experimentId, caseId, repetition) {
  if (![1, 2, 3].includes(repetition)) throw new TypeError("repetition must be 1, 2, or 3");
  const digest = createHash("sha256").update(`${experimentId}\0${caseId}\0${repetition}`, "utf8").digest();
  return (digest[0] & 1) === 0 ? ["A", "B"] : ["B", "A"];
}

export function buildForwardPlan(config, corpus) {
  if (corpus.positive?.length !== config.execution.eligibleCases) throw new Error("eligible case count drifted");
  const pairs = [], runs = [];
  for (const entry of corpus.positive) {
    for (let repetition = 1; repetition <= config.execution.repetitions; repetition += 1) {
      const order = deterministicForwardPairOrder(config.experimentId, entry.caseId, repetition);
      const pairId = `${entry.caseId}:rep-${repetition}`;
      pairs.push({ pairId, caseId: entry.caseId, repetition, order });
      for (const arm of order) runs.push({ pairId, caseId: entry.caseId, repetition, arm });
    }
  }
  return { pairs, runs, pairCount: pairs.length, agentRunCount: runs.length,
    orderSha256: sha256(runs.map(({ caseId, repetition, arm }) => ({ caseId, repetition, arm }))) };
}

function validateCorpus(corpus) {
  if (corpus?.schemaVersion !== "unit-play-guidance-forward-corpus.v2"
    || corpus.experimentId !== FORWARD_EXPERIMENT_ID || corpus.frozenBeforeFormalPairedResults !== true) {
    throw new TypeError("invalid forward corpus identity");
  }
  if (corpus.diagnosticDisclosure?.priorNonFormalHttpDiagnosticsObserved !== true
    || corpus.diagnosticDisclosure?.formalPairResultsObservedBeforeFreeze !== false
    || !/not a pristine pre-candidate corpus/iu.test(corpus.diagnosticDisclosure?.claimBoundary ?? "")) {
    throw new Error("prior diagnostic disclosure is incomplete");
  }
  if (corpus.positive?.length !== 30 || corpus.negative?.length !== 20 || corpus.boundary?.length !== 10) {
    throw new Error("forward corpus must contain exactly 30/20/10 cases");
  }
  const all = [...corpus.positive, ...corpus.negative, ...corpus.boundary];
  if (!unique(all.map((entry) => entry.caseId)) || all.some((entry) => entry.corpusVersion !== corpus.corpusVersion)) {
    throw new Error("forward corpus case identity drifted");
  }
  if (new Set(corpus.positive.map((entry) => entry.unitApiName)).size !== 10
    || corpus.positive.filter((entry) => entry.language === "en").length !== 10
    || corpus.positive.some((entry) => entry.expectedCompositionCards !== 2
      || entry.positioningPresentation !== "cards_only")) {
    throw new Error("forward positive population does not cover ten units and two cards");
  }
  return corpus;
}

function evidenceEntry(toolResult) {
  return {
    toolName: toolResult.toolName,
    source: toolResult.metadata?.source,
    updatedAt: toolResult.metadata?.updatedAt,
    metadata: toolResult.metadata,
    temporalStatus: "current",
    value: toolResult.value
  };
}

function validateObservations(observations, corpus) {
  if (observations?.schemaVersion !== "unit-play-guidance-forward-tool-observations.v2"
    || observations.experimentId !== FORWARD_EXPERIMENT_ID || observations.seasonContextId !== "set18-live") {
    throw new TypeError("invalid forward observation identity");
  }
  if (observations.provenance?.providerModelCalls !== 0
    || observations.provenance?.registeredToolExecutorOnly !== true
    || observations.provenance?.canonicalReplayMustUseOnlyTheseFrozenValues !== true) {
    throw new Error("observation capture provenance is invalid");
  }
  if (observations.candidateSkill?.version !== "1.5.7"
    || observations.candidateSkill.contentSha256 !== PINNED_CANDIDATE_HASH) {
    throw new Error("frozen candidate identity drifted");
  }
  const ids = Object.keys(observations.units ?? {});
  if (ids.length !== 10 || !unique(ids)
    || corpus.positive.some((entry) => !ids.includes(entry.unitApiName))) throw new Error("corpus/observation unit mismatch");
  const costs = new Map([1, 2, 3, 4, 5].map((cost) => [cost, 0]));
  const unitChecks = [];
  for (const apiName of ids) {
    const entry = observations.units[apiName];
    costs.set(entry.unit.cost, (costs.get(entry.unit.cost) ?? 0) + 1);
    const plan = entry.unitBuilds?.value?.mechanismQueryPlan;
    const batch = entry.itemDetailsBatch;
    const compRows = entry.initialComps?.value?.results?.slice(0, 2) ?? [];
    const compIds = compRows.map((row) => row.compositionRef?.compId);
    const frozenNow = Date.parse(observations.frozenAt) + 1;
    const batchFailure = officialItemBatchEvidenceFailure(evidenceEntry(batch), {
      now: frozenNow,
      seasonContextId: observations.seasonContextId
    });
    const cardChecks = (entry.cards ?? []).map((card, index) => {
      const resolved = card.resolvedComps?.value?.results?.find((row) => row.compositionRef?.compId === compIds[index])
        ?? card.resolvedComps?.value?.results?.[0];
      const tacticalPlan = resolved?.tacticalDetailQueryPlan;
      const tactical = card.tacticalDetails?.value;
      return Boolean(tacticalPlan?.status === "ready"
        && tactical?.compId === tacticalPlan.compositionId
        && tactical?.clusterId === tacticalPlan.clusterId
        && tactical?.seasonContextId === tacticalPlan.seasonContextId
        && tactical?.formation?.status === "available"
        && tactical.formation.units?.length >= 5
        && tactical.formation.units.some((unit) => unit.apiName === apiName));
    });
    const exactItemPlan = plan?.status === "available" && plan.apiNames?.length === 3
      && stableJson(plan.apiNames) === stableJson(batch?.value?.selection?.apiNames);
    unitChecks.push({ apiName, exactItemPlan, officialBatchValid: batchFailure === null,
      twoDistinctCandidates: compIds.length === 2 && unique(compIds), cardsValid: cardChecks.length === 2 && cardChecks.every(Boolean) });
  }
  return { unitChecks, costDistribution: Object.fromEntries(costs),
    allValid: unitChecks.every((entry) => entry.exactItemPlan && entry.officialBatchValid
      && entry.twoDistinctCandidates && entry.cardsValid) && [...costs.values()].every((count) => count === 2) };
}

function routingAudit(corpus) {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_7], toolRegistry });
  const evaluate = (entries) => entries.map((entry) => ({ caseId: entry.caseId,
    status: matchSkill(taskFrameFromCase(entry), skillRegistry).status }));
  const positive = evaluate(corpus.positive), negative = evaluate(corpus.negative), boundary = evaluate(corpus.boundary);
  return {
    positiveSelected: positive.filter((entry) => entry.status === "selected").length,
    negativeFalseTakeover: negative.filter((entry) => entry.status === "selected").length,
    boundaryForcedTakeover: boundary.filter((entry) => entry.status === "selected").length,
    skillRoutingModelCalls: 0,
    secondTaskFrameParses: 0
  };
}

function validDirectAnswerPayload() {
  return { choices: [{ message: { content: JSON.stringify({ schemaVersion: "react-action.v1", type: "finish",
    answer: "ok", evidenceIds: [], reasonCode: "direct_answer", narrative: null }) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

async function captureProviderPayload(config, guidanceRenderer) {
  let body, calls = 0;
  const provider = createReactDecisionProvider({ endpoint: config.provider.endpoint, model: config.provider.model,
    timeoutMs: config.provider.timeoutMs, temperature: config.provider.temperature,
    maxTokens: config.provider.maxOutputTokens, includeResponseFormat: true,
    thinkingMode: config.provider.thinkingMode, messageLayout: config.provider.messageLayout,
    cacheNamespace: null, tacticalPresentationScope: true,
    ...(guidanceRenderer ? { guidanceRenderer } : {}),
    fetchImpl: async (_url, options) => { calls += 1; body = JSON.parse(options.body);
      return { ok: true, async json() { return validDirectAnswerPayload(); } }; } });
  const semanticAdvisory = { action: "recommend", goal: "recommend_unit_play",
    subject: { resolvedId: "DA_18_Varus", canonicalName: "韦鲁斯" }, expectedOutput: ["unit_play_guidance"] };
  await provider({ state: { question: "韦鲁斯怎么玩？", messages: [], seasonContextId: "set18-live",
    taskAnchor: null, bridgeContext: null, semanticAdvisory, evidence: [], transcript: [] }, toolCatalog: [] });
  return { body, calls };
}

export async function guidanceSeamAudit(config, corpus) {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_7], toolRegistry });
  const frame = taskFrameFromCase(corpus.positive[0]);
  const selection = matchSkill(frame, skillRegistry);
  const skillContext = buildSkillContext({ skill: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7, selection, taskFrame: frame,
    runtimeAvailableTools: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.allowedTools });
  const candidateHash = sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_7));
  const rendered = JSON.stringify({ schemaVersion: "unit-play-browser-candidate.v1",
    contentHash: candidateHash, skillContext });
  const baseline = await captureProviderPayload(config, null);
  const candidate = await captureProviderPayload(config, () => rendered);
  const baselineRun = JSON.parse(baseline.body.messages[2].content);
  const candidateRun = JSON.parse(candidate.body.messages[2].content);
  const baselineGuidance = baselineRun.semanticGuidance;
  const candidateGuidance = candidateRun.semanticGuidance;
  baselineRun.semanticGuidance = candidateGuidance;
  return {
    localCaptureRequests: baseline.calls + candidate.calls,
    actualProviderModelCalls: 0,
    promptVersion: candidateRun.promptVersion,
    defaultMessagesSha256: sha256(JSON.stringify(baseline.body.messages)),
    baselineGuidanceSha256: sha256(baselineGuidance),
    candidateRenderedContextSha256: sha256(candidateGuidance),
    candidateSkillSha256: candidateHash,
    onlyGuidanceDiffers: stableJson(baselineRun) === stableJson(candidateRun)
      && stableJson(baseline.body.messages.filter((_, index) => index !== 2))
        === stableJson(candidate.body.messages.filter((_, index) => index !== 2))
  };
}

function projectionAudit(observations) {
  const first = Object.values(observations.units)[0];
  const original = { type: "tool_result", tool: "unit_builds", value: clone(first.unitBuilds.value),
    evidence: { evidenceId: "fixture-evidence", toolName: "unit_builds", value: clone(first.unitBuilds.value) } };
  const before = stableJson(original);
  const left = projectUnitPlayModelObservation(original, first.unit.apiName);
  const right = projectUnitPlayModelObservation(original, first.unit.apiName);
  return { originalUnchanged: stableJson(original) === before, deterministic: stableJson(left) === stableJson(right),
    projectedSha256: sha256(left), projectedBytes: Buffer.byteLength(stableJson(left)),
    originalBytes: Buffer.byteLength(before) };
}

async function productionImportAudit(root) {
  if (!root) return { experimentImports: ["root_not_supplied"] };
  const findings = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (relative === "src/experiments") continue;
        await walk(absolute);
      } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/u.test(entry.name)) {
        const source = await readFile(absolute, "utf8");
        if (/unit-play-guidance-forward/iu.test(source)) findings.push(relative);
      }
    }
  }
  await walk(path.join(root, "src"));
  return { experimentImports: findings };
}

export async function runForwardPreflight({ config, corpus, observations, root } = {}) {
  if (config?.schemaVersion !== "unit-play-guidance-forward-config.v2"
    || config.experimentId !== FORWARD_EXPERIMENT_ID || config.mode !== "zero_provider_call_preflight") {
    throw new TypeError("invalid or unauthorized forward config");
  }
  if (UNIT_PLAY_GUIDANCE_SKILL.version !== "1.3.0") throw new Error("production default Skill changed");
  if (config.provider.decisionPromptVersion !== REACT_SCOPED_TACTICAL_PROMPT_VERSION) throw new Error("prompt version drifted");
  validateCorpus(corpus);
  const observationsAudit = validateObservations(observations, corpus);
  const routing = routingAudit(corpus);
  const plan = buildForwardPlan(config, corpus);
  const seam = await guidanceSeamAudit(config, corpus);
  const projection = projectionAudit(observations);
  const productionAudit = await productionImportAudit(root);
  const hashes = { corpus: sha256(corpus), observations: sha256(observations),
    candidateSkill: sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_7)),
    baselineGuidance: seam.baselineGuidanceSha256, candidateRenderedContext: seam.candidateRenderedContextSha256,
    defaultMessages: seam.defaultMessagesSha256 };
  const gates = {
    disclosedForwardDesign: corpus.diagnosticDisclosure.formalPairResultsObservedBeforeFreeze === false,
    exactPopulation: corpus.positive.length === 30 && corpus.negative.length === 20 && corpus.boundary.length === 10,
    currentFrozenObservations: observationsAudit.allValid,
    routingIsolation: routing.positiveSelected === 30 && routing.negativeFalseTakeover === 0
      && routing.boundaryForcedTakeover === 0 && routing.skillRoutingModelCalls === 0 && routing.secondTaskFrameParses === 0,
    plan180: plan.pairCount === 90 && plan.agentRunCount === 180,
    zeroProviderCalls: seam.actualProviderModelCalls === 0 && observations.provenance.providerModelCalls === 0,
    providerCallsLocked: config.authorization?.realProviderPairedRun === false
      && config.authorization?.productionControl === false,
    frozenReplayClock: config.commonRuntimeBothArms?.toolMode === "frozen_observation_replay_only"
      && config.commonRuntimeBothArms?.replayClock === "observation_frozen_at_plus_1ms"
      && config.commonRuntimeBothArms?.liveToolRetrieval === false,
    onlyGuidanceDiffers: seam.onlyGuidanceDiffers,
    commonProjectionDeterministic: projection.originalUnchanged && projection.deterministic
      && projection.projectedBytes < projection.originalBytes,
    productionDefaultUnchanged: UNIT_PLAY_GUIDANCE_SKILL.version === "1.3.0",
    noProductionExperimentImports: productionAudit.experimentImports.length === 0,
    corpusHash: hashes.corpus === config.frozen.corpusNormalizedSha256,
    observationHash: hashes.observations === config.frozen.observationNormalizedSha256,
    candidateSkillHash: hashes.candidateSkill === config.frozen.candidateSkillSha256,
    baselineGuidanceHash: hashes.baselineGuidance === config.frozen.baselineGuidanceSha256,
    candidateRenderedHash: hashes.candidateRenderedContext === config.frozen.candidateRenderedContextSha256,
    defaultMessagesHash: hashes.defaultMessages === config.frozen.defaultProviderMessagesSha256
  };
  return { schemaVersion: FORWARD_PREFLIGHT_SCHEMA_VERSION,
    status: Object.values(gates).every(Boolean) ? "passed" : "failed",
    experimentId: config.experimentId,
    claimBoundary: "zero-call forward-evaluation readiness only; no formal paired result or production authorization",
    hashes, plan: { pairCount: plan.pairCount, plannedAgentRuns: plan.agentRunCount,
      orderSha256: plan.orderSha256, actualProviderModelCalls: 0 }, routing, observationsAudit,
    seam, projection, productionAudit, gates };
}
