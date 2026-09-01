import { ToolRegistry } from "../../agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../../agent/tools/definitions.js";
import { buildSkillContext, matchSkill, SkillRegistry } from "../../skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL, UNIT_PLAY_GUIDANCE_SKILL_V1_5_8 } from "../../skills/definitions/unit-play-guidance.js";
import { sha256 } from "../unit-play-guidance-control/content.js";
import { taskFrameFromCase } from "../unit-play-guidance-control/harness.js";

export const COMPLETION_V3_EXPERIMENT_ID = "unit-play-guidance-completion.2026-09-01.v3";
export const COMPLETION_V3_SCHEMA = "unit-play-guidance-completion-preflight.v3";

export function buildCompletionV3Plan(config, corpus) {
  const runs = corpus.positive.flatMap((entry) => Array.from({ length: config.execution.repetitions }, (_, index) => ({
    runId: `${entry.caseId}:candidate:rep-${index + 1}`,
    caseId: entry.caseId,
    repetition: index + 1,
    arm: "B"
  })));
  return { runs, agentRunCount: runs.length,
    orderSha256: sha256(runs.map(({ caseId, repetition, arm }) => ({ caseId, repetition, arm }))) };
}

function renderedCandidateHash(evalCase, toolRegistry) {
  const taskFrame = taskFrameFromCase(evalCase);
  const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_8], toolRegistry });
  const selection = matchSkill(taskFrame, skillRegistry);
  if (selection.status !== "selected") return { selection, hash: null };
  const skillContext = buildSkillContext({ skill: UNIT_PLAY_GUIDANCE_SKILL_V1_5_8, selection, taskFrame,
    runtimeAvailableTools: UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.allowedTools });
  return { selection, hash: sha256(JSON.stringify({ schemaVersion: "unit-play-browser-candidate.v1",
    contentHash: sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8)), skillContext })) };
}

export function runCompletionV3Preflight({ config, corpus, observations, sourcePreflight }) {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const plan = buildCompletionV3Plan(config, corpus);
  const rendered = corpus.positive.map((entry) => renderedCandidateHash(entry, toolRegistry));
  const gates = {
    configIdentity: config?.schemaVersion === "unit-play-guidance-completion-config.v3"
      && config.experimentId === COMPLETION_V3_EXPERIMENT_ID,
    adaptiveDisclosure: config?.adaptiveDisclosure?.priorAttemptsObserved === true
      && config.adaptiveDisclosure.pairedEfficacyClaimAllowed === false,
    sourcePreflight: sourcePreflight?.status === "passed" && sourcePreflight.plan?.actualProviderModelCalls === 0,
    sourceCorpus: corpus?.experimentId === "unit-play-guidance-forward.2026-09-01.v2"
      && sha256(corpus) === config.frozen.sourceCorpusNormalizedSha256,
    sourceObservations: observations?.experimentId === "unit-play-guidance-forward.2026-09-01.v2"
      && sha256(observations) === config.frozen.sourceObservationNormalizedSha256,
    candidateSkill: UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.version === "1.5.8"
      && sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8)) === config.frozen.candidateSkillSha256,
    candidateSelection: rendered.length === 30 && rendered.every((entry) => entry.selection.status === "selected"),
    candidateRendering: rendered.every((entry) => entry.hash === config.frozen.candidateRenderedContextSha256),
    plan: plan.agentRunCount === 90 && plan.orderSha256 === config.execution.orderSha256,
    providerLocked: config.authorization.realProviderRun === false,
    productionLocked: config.authorization.productionControl === false
      && UNIT_PLAY_GUIDANCE_SKILL.version === "1.3.0"
  };
  return { schemaVersion: COMPLETION_V3_SCHEMA, experimentId: COMPLETION_V3_EXPERIMENT_ID,
    status: Object.values(gates).every(Boolean) ? "passed" : "failed", gates,
    plan: { plannedAgentRuns: plan.agentRunCount, actualProviderModelCalls: 0,
      orderSha256: plan.orderSha256, concurrency: 1 },
    hashes: { sourceCorpus: sha256(corpus), sourceObservations: sha256(observations),
      candidateSkill: sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8)),
      candidateRenderedContext: rendered[0]?.hash ?? null },
    claimBoundary: "Adaptive candidate reliability readiness only; no paired efficacy or production claim." };
}
