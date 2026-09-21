import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  createReactDecisionProvider,
  REACT_DECISION_PROMPT_VERSION_V5 as REACT_DECISION_PROMPT_VERSION
} from "../../react/react-decision-provider.js";
import {
  numericStatisticalClaimAudit,
  runUnitPlayGuidanceControlExperiment
} from "../unit-play-guidance-control/harness.js";
import {
  BASELINE_GUIDANCE_SHA256,
  CANDIDATE_SKILL_CONTENT_SHA256,
  stableJson
} from "../unit-play-guidance-control/content.js";
import {
  buildCanonicalTokenReservation,
  createCanonicalRunFuse,
  isCanonicalImmediateAbortCode,
  PR1D_ATTEMPT_01_DIAGNOSTIC,
  PR1D_RECOVERY_LIMITS,
  zeroToleranceSafetyViolations
} from "./recovery.js";

export const PR1D_PREFLIGHT_SCHEMA_VERSION = "unit-play-guidance-real-provider-preflight.v2";
export const PR1D_MANIFEST_SCHEMA_VERSION = "unit-play-guidance-real-provider-manifest.v2";
export const PR1D_PREFLIGHT_RUNTIME_VERSION = "unit-play-guidance-real-provider-preflight.v2";

const IDENTITY_FIELDS = Object.freeze(["model", "version", "system_fingerprint"]);
const AUTHORIZATION_HEADER_PATTERN = /"authorizationHeader"\s*:|\bbearer\s+[a-z0-9._~+\/-]+/iu;

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

export function deterministicPairOrder(experimentId, caseId, repetition) {
  if (![1, 2, 3].includes(repetition)) throw new TypeError("repetition must be 1, 2, or 3");
  const digest = createHash("sha256")
    .update(`${experimentId}\0${caseId}\0${repetition}`, "utf8")
    .digest();
  return (digest[0] & 1) === 0 ? ["A", "B"] : ["B", "A"];
}

export function buildCanonicalRunPlan(config, corpus) {
  assertObject(config, "config");
  assertObject(corpus, "corpus");
  const positive = corpus.positive ?? [];
  if (positive.length !== config.execution.eligibleCases) {
    throw new Error(`expected ${config.execution.eligibleCases} eligible cases, received ${positive.length}`);
  }
  const pairs = [];
  const runs = [];
  let pairIndex = 0;
  let runIndex = 0;
  for (const evalCase of positive) {
    for (let repetition = 1; repetition <= config.execution.repetitions; repetition += 1) {
      const order = deterministicPairOrder(config.experimentId, evalCase.caseId, repetition);
      const pairId = `${evalCase.caseId}:rep-${repetition}`;
      pairs.push({ pairIndex: ++pairIndex, pairId, caseId: evalCase.caseId, repetition, order });
      for (const arm of order) {
        runs.push({ runIndex: ++runIndex, pairId, caseId: evalCase.caseId, repetition, arm });
      }
    }
  }
  return {
    pairs,
    runs,
    pairCount: pairs.length,
    agentRunCount: runs.length,
    orderSha256: sha256(runs.map(({ caseId, repetition, arm }) => ({ caseId, repetition, arm })))
  };
}

export function createProviderIdentityTracker() {
  let baseline = null;
  let observations = 0;
  return {
    observe(payload = {}) {
      const observed = Object.fromEntries(IDENTITY_FIELDS
        .filter((field) => payload[field] != null && String(payload[field]).trim() !== "")
        .map((field) => [field, String(payload[field])]));
      observations += 1;
      if (baseline == null) {
        baseline = observed;
        return clone(baseline);
      }
      for (const field of IDENTITY_FIELDS) {
        const had = Object.hasOwn(baseline, field);
        const has = Object.hasOwn(observed, field);
        if (had !== has || (had && observed[field] !== baseline[field])) {
          throw new Error(`provider identity drift at ${field}`);
        }
      }
      return clone(baseline);
    },
    snapshot() {
      return {
        observations,
        baseline: clone(baseline ?? {}),
        immutableIdentityUnavailable: observations > 0
          && !Object.hasOwn(baseline ?? {}, "version")
          && !Object.hasOwn(baseline ?? {}, "system_fingerprint")
      };
    }
  };
}

function validDirectAnswerPayload() {
  return {
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "ok",
      evidenceIds: [],
      reasonCode: "direct_answer",
      narrative: null
    }) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 }
  };
}

async function captureProviderPayload(config, guidanceRenderer) {
  let body = null;
  let localCaptureRequests = 0;
  const provider = createReactDecisionProvider({
    endpoint: config.provider.endpoint,
    model: config.provider.model,
    timeoutMs: config.provider.timeoutMs,
    temperature: config.provider.temperature,
    maxTokens: config.provider.maxOutputTokens,
    includeResponseFormat: true,
    thinkingMode: config.provider.thinkingMode,
    messageLayout: config.provider.messageLayout,
    cacheNamespace: config.provider.cacheNamespace,
    decisionPromptVersion: config.provider.decisionPromptVersion,
    ...(guidanceRenderer ? { guidanceRenderer } : {}),
    fetchImpl: async (_url, options) => {
      localCaptureRequests += 1;
      body = JSON.parse(options.body);
      return { ok: true, async json() { return validDirectAnswerPayload(); } };
    }
  });
  const semanticAdvisory = {
    action: "recommend",
    goal: "recommend_unit_play",
    subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" },
    expectedOutput: ["unit_play_guidance"]
  };
  await provider({
    state: {
      question: "沃里克怎么玩？",
      messages: [],
      seasonContextId: "set17-live",
      taskAnchor: null,
      bridgeContext: null,
      semanticAdvisory,
      evidence: [],
      transcript: []
    },
    toolCatalog: []
  });
  return { body, localCaptureRequests };
}

export async function verifyGuidanceRendererSeam(config) {
  const baseline = await captureProviderPayload(config, null);
  const received = [];
  const candidate = await captureProviderPayload(config, (advisory) => {
    received.push(clone(advisory));
    return "unit-play-guidance-candidate-preflight";
  });
  const baselineRun = JSON.parse(baseline.body.messages[2].content);
  const candidateRun = JSON.parse(candidate.body.messages[2].content);
  const defaultMessagesSha256 = sha256(JSON.stringify(baseline.body.messages));
  const candidateGuidance = candidateRun.semanticGuidance;
  baselineRun.semanticGuidance = candidateGuidance;
  const onlyGuidanceDiffers = stableJson(baselineRun) === stableJson(candidateRun)
    && stableJson(baseline.body.messages.filter((_, index) => index !== 2))
      === stableJson(candidate.body.messages.filter((_, index) => index !== 2));
  return {
    defaultMessagesSha256,
    pinnedDefaultMessagesSha256: config.frozen.defaultProviderMessagesSha256,
    defaultMessagesByteIdentical: defaultMessagesSha256 === config.frozen.defaultProviderMessagesSha256,
    onlyGuidanceDiffers,
    rendererAdvisoryCount: received.length,
    candidateGuidance,
    localCaptureRequests: baseline.localCaptureRequests + candidate.localCaptureRequests,
    actualProviderHttpCalls: 0,
    requestShape: {
      model: baseline.body.model,
      temperature: baseline.body.temperature,
      maxTokens: baseline.body.max_tokens,
      responseFormat: baseline.body.response_format?.type ?? null,
      thinkingMode: baseline.body.thinking?.type ?? null,
      messageCount: baseline.body.messages.length
    }
  };
}

async function walkJavaScriptFiles(directory, root, files = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkJavaScriptFiles(absolute, root, files);
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/u.test(entry.name)) {
      files.push({ absolute, relative: path.relative(root, absolute).replaceAll("\\", "/") });
    }
  }
  return files;
}

export async function auditProductionImports(root) {
  const files = await walkJavaScriptFiles(path.join(root, "src"), root);
  const experimentImports = [];
  const productionRendererReferences = [];
  const providerCallSites = [];
  for (const file of files) {
    const source = await fs.readFile(file.absolute, "utf8");
    const isExperiment = file.relative.startsWith("src/experiments/");
    if (!isExperiment && /unit-play-guidance-real-provider/iu.test(source)) experimentImports.push(file.relative);
    if (!isExperiment && file.relative !== "src/react/react-decision-provider.js" && /guidanceRenderer/u.test(source)) {
      productionRendererReferences.push(file.relative);
    }
    source.split(/\r?\n/u).forEach((line, index) => {
      if (!isExperiment && /createReactDecisionProvider\s*\(/u.test(line) && !/function createReactDecisionProvider/u.test(line)) {
        providerCallSites.push({ file: file.relative, line: index + 1, rendererOptionPresent: /guidanceRenderer/u.test(line) });
      }
    });
  }
  return { experimentImports, productionRendererReferences, providerCallSites };
}

function redactManifest(config, { apiKeyConfigured, implementationCommitSha }) {
  return {
    schemaVersion: PR1D_MANIFEST_SCHEMA_VERSION,
    experimentId: config.experimentId,
    implementationCommitSha,
    mode: config.mode,
    provider: clone(config.provider),
    agent: clone(config.agent),
    credential: { sourceEnv: "OPENAI_API_KEY", configured: Boolean(apiKeyConfigured) },
    cache: { namespace: config.provider.cacheNamespace, clientResponseCache: config.provider.clientResponseCache },
    frozen: clone(config.frozen),
    limits: clone(PR1D_RECOVERY_LIMITS),
    recovery: {
      sourceAttempt: clone(PR1D_ATTEMPT_01_DIAGNOSTIC),
      executionMode: "fresh_full_180",
      priorAttemptSamplesImported: 0
    },
    authorization: { implementation: true, providerCalls: false }
  };
}

function recoveryPreflightChecks() {
  const evidence = [{ evidenceId: "ev-1", value: { samples: 52_886, winRate: 0.52 } }];
  const audit = (answer, entries = evidence, events = []) => numericStatisticalClaimAudit({
    answer,
    evidence: entries,
    groundingAudit: { violations: [] },
    modelConclusion: { validationErrors: [] }
  }, events);
  const identifierAudit = audit("TFT18_Jinx、S18、item_123、evidence-42 与 https://example.test/set/18 都是标识符。");
  const supportedAudit = audit("样本为 52,886 场。");
  const unsupportedAudit = audit("胜率 60%。");
  const mixedAudit = audit("TFT18_Jinx 的胜率 60%。");

  const initialReservation = buildCanonicalTokenReservation({
    body: JSON.stringify({ messages: [{ role: "user", content: "preflight" }], max_tokens: 1_800 })
  });
  const repairReservation = buildCanonicalTokenReservation({
    body: JSON.stringify({ messages: [{ role: "user", content: "repair" }], max_tokens: 700 })
  });
  const nearCapFuse = createCanonicalRunFuse();
  nearCapFuse.beforeRequest({ reservedTokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap });
  nearCapFuse.observePayload({
    usage: { total_tokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap - initialReservation.reservedTokens + 1 }
  }, { reservedTokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap });
  let nearCapDispatches = 0;
  let nearCapBlocked = false;
  try {
    nearCapFuse.beforeRequest(initialReservation);
    nearCapDispatches += 1;
  } catch (error) {
    nearCapBlocked = error?.code === "budget_failure";
  }

  const repairFuse = createCanonicalRunFuse();
  repairFuse.beforeRequest({ reservedTokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap });
  repairFuse.observePayload({
    usage: { total_tokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap - repairReservation.reservedTokens + 1 }
  }, { reservedTokens: PR1D_RECOVERY_LIMITS.totalTokenHardCap });
  let repairDispatches = 0;
  let repairBlocked = false;
  try {
    repairFuse.beforeRequest(repairReservation);
    repairDispatches += 1;
  } catch (error) {
    repairBlocked = error?.code === "budget_failure";
  }

  const safetyViolations = zeroToleranceSafetyViolations({ inventedNumericStatistics: 1 });
  return {
    numericAudit: {
      identifierFalsePositiveAbsent: identifierAudit.authoritativeViolationCount === 0,
      supportedClaimAccepted: supportedAudit.authoritativeViolationCount === 0,
      unsupportedClaimDetected: unsupportedAudit.authoritativeViolationCount > 0,
      identifierPlusClaimOnlyDetectsClaim: mixedAudit.violations.filter((entry) => entry.type === "unsupported_numeric_statistical_claim").length === 1
    },
    immediateAbort: {
      confirmedSafetyViolationRecognized: safetyViolations.length === 1
        && isCanonicalImmediateAbortCode("safety_violation"),
      candidateSkillFailureRecognized: isCanonicalImmediateAbortCode("candidate_skill_failure")
    },
    reservation: {
      initialReservation,
      repairReservation,
      attempt01KnownUsageCovered: Math.min(initialReservation.reservedTokens, repairReservation.reservedTokens)
        >= PR1D_ATTEMPT_01_DIAGNOSTIC.maxObservedRequestTokens,
      nearCapBlockedBeforeDispatch: nearCapBlocked && nearCapDispatches === 0,
      repairIndependentlyBlockedBeforeDispatch: repairBlocked && repairDispatches === 0,
      actualProviderHttpCalls: 0
    },
    limits: clone(PR1D_RECOVERY_LIMITS),
    priorAttemptSamplesImported: 0
  };
}

function secretAudit(value) {
  const serialized = JSON.stringify(value);
  const suspiciousKeys = ["apiKey", "cookie", "password", "secret"]
    .filter((key) => new RegExp(`"${key}"\\s*:`, "iu").test(serialized));
  return {
    authorizationHeaderPersisted: AUTHORIZATION_HEADER_PATTERN.test(serialized),
    suspiciousSecretKeys: suspiciousKeys,
    secretMaterialPersisted: Number(AUTHORIZATION_HEADER_PATTERN.test(serialized) || suspiciousKeys.length > 0)
  };
}

export async function runRealProviderPreflight({
  config,
  corpus,
  fixtures,
  root,
  apiKeyConfigured = false,
  implementationCommitSha = "unavailable"
} = {}) {
  assertObject(config, "config");
  if (config.schemaVersion !== "unit-play-guidance-real-provider-config.v1") throw new TypeError("invalid PR1D config schema");
  if (config.mode !== "dry_run_zero_provider_calls") throw new Error("PR1D Provider calls are not authorized");
  if (REACT_DECISION_PROMPT_VERSION !== config.provider.decisionPromptVersion) throw new Error("decision prompt version drifted");
  const plan = buildCanonicalRunPlan(config, corpus);
  const deterministic = await runUnitPlayGuidanceControlExperiment({ corpus, fixtures, includeCaseDetails: false });
  const seam = await verifyGuidanceRendererSeam(config);
  const productionAudit = await auditProductionImports(root);
  const recovery = recoveryPreflightChecks();
  const manifest = redactManifest(config, { apiKeyConfigured, implementationCommitSha });
  const manifestSecretAudit = secretAudit(manifest);
  const hashes = {
    corpus: deterministic.corpus.hash,
    fixtures: deterministic.fixtures.hash,
    baselineGuidance: BASELINE_GUIDANCE_SHA256,
    candidateContent: CANDIDATE_SKILL_CONTENT_SHA256,
    candidateRenderedContexts: deterministic.content.renderedCandidateContextHashes
  };
  const gates = {
    implementationAuthorized: manifest.authorization.implementation === true,
    providerCallsNotAuthorized: manifest.authorization.providerCalls === false,
    zeroActualProviderHttpCalls: seam.actualProviderHttpCalls === 0,
    plannedAgentRuns: plan.agentRunCount === config.execution.plannedAgentRuns,
    plannedPairs: plan.pairCount === config.execution.plannedPairs,
    routingPositive: deterministic.routing.positiveEligible === 30 && deterministic.routing.positiveTotal === 30,
    routingNegative: deterministic.routing.negativeFalseTakeover === 0,
    routingBoundary: deterministic.routing.boundaryForcedTakeover === 0,
    oneTaskFrameParse: deterministic.routing.secondTaskFrameParses === 0,
    noRoutingOrCompletionModelCalls: deterministic.routing.llmSkillRouterCalls === 0
      && deterministic.routing.addedRoutingOrCompletionModelCalls === 0,
    faultFallback: deterministic.faultInjection.fallbackToPinnedA === 5
      && deterministic.faultInjection.wrongDestination === 0,
    corpusHash: hashes.corpus === config.frozen.corpusNormalizedSha256,
    fixtureHash: hashes.fixtures === config.frozen.fixtureNormalizedSha256,
    baselineGuidanceHash: hashes.baselineGuidance === config.frozen.baselineGuidanceSha256,
    candidateContentHash: hashes.candidateContent === config.frozen.candidateContentSha256,
    candidateRenderedContextHash: hashes.candidateRenderedContexts.length === 1
      && hashes.candidateRenderedContexts[0] === config.frozen.candidateRenderedContextSha256,
    defaultMessagesByteIdentity: seam.defaultMessagesByteIdentical,
    candidateOnlyGuidanceDiffers: seam.onlyGuidanceDiffers && seam.rendererAdvisoryCount === 1,
    providerRequestConfig: seam.requestShape.model === config.provider.model
      && seam.requestShape.temperature === config.provider.temperature
      && seam.requestShape.maxTokens === config.provider.maxOutputTokens
      && seam.requestShape.responseFormat === config.provider.responseFormat
      && seam.requestShape.thinkingMode === config.provider.thinkingMode,
    noProductionExperimentImports: productionAudit.experimentImports.length === 0,
    productionRendererOptionAbsent: productionAudit.productionRendererReferences.length === 0
      && productionAudit.providerCallSites.every((site) => site.rendererOptionPresent === false),
    recoveryNumericAuditor: Object.values(recovery.numericAudit).every(Boolean),
    recoveryImmediateAbort: Object.values(recovery.immediateAbort).every(Boolean),
    recoveryReservation: recovery.reservation.attempt01KnownUsageCovered
      && recovery.reservation.nearCapBlockedBeforeDispatch
      && recovery.reservation.repairIndependentlyBlockedBeforeDispatch
      && recovery.reservation.actualProviderHttpCalls === 0,
    recoveryLimits: recovery.limits.totalTokenHardCap === 10_000_000
      && recovery.limits.providerHttpRequestHardCap === 1_800
      && recovery.limits.pairConcurrency === 1,
    freshRecoveryPopulation: recovery.priorAttemptSamplesImported === 0,
    secretRedaction: manifestSecretAudit.secretMaterialPersisted === 0
  };
  const passed = Object.values(gates).every(Boolean);
  return {
    schemaVersion: PR1D_PREFLIGHT_SCHEMA_VERSION,
    status: passed ? "passed" : "failed",
    runtimeVersion: PR1D_PREFLIGHT_RUNTIME_VERSION,
    manifest,
    plan: {
      pairCount: plan.pairCount,
      plannedAgentRuns: plan.agentRunCount,
      actualProviderHttpCalls: 0,
      orderSha256: plan.orderSha256,
      pairs: plan.pairs
    },
    deterministicChecks: {
      routing: deterministic.routing,
      fallback: {
        total: deterministic.faultInjection.total,
        fallbackToPinnedA: deterministic.faultInjection.fallbackToPinnedA,
        wrongDestination: deterministic.faultInjection.wrongDestination
      }
    },
    hashes,
    seam,
    productionAudit,
    recovery,
    secretAudit: manifestSecretAudit,
    gates
  };
}
