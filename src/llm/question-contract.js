import { createHash } from "node:crypto";
import { validateIntentEnvelope } from "../retrieval/contracts.js";

export const QUESTION_CONTRACT_SCHEMA_VERSION = "question-contract.v1";
export const QUESTION_CONTRACT_FINGERPRINT_VERSION = "question-contract-fingerprint.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value, length = 64) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex").slice(0, length);
}

function scopeFingerprint(value) {
  return digest(String(value ?? "default"), 24);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function sanitizedQuestion(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\b(?:https?|wss?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|authorization)\s*[:=]\s*\S+)/giu, "[redacted-secret]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/gu, "[redacted-path]")
    .trim()
    .slice(0, 500);
}

function targetValues(result, envelope) {
  const targets = { comps: [], units: [], items: [], traits: [] };
  for (const entity of envelope.entities ?? []) {
    const key = entity.type === "unit" ? "units" : entity.type === "item" ? "items" : entity.type === "trait" ? "traits" : null;
    if (key && entity.apiName) targets[key].push(String(entity.apiName));
  }
  const targetComp = result?.analysis?.target;
  if (targetComp?.compId || targetComp?.name) targets.comps.push(String(targetComp.compId ?? targetComp.name));
  const comp = result?.query?.comp?.value;
  if (comp?.id || comp?.name) targets.comps.push(String(comp.id ?? comp.name));
  const performanceItem = result?.query?.performanceItem;
  if (performanceItem) targets.items.push(String(performanceItem));
  for (const key of Object.keys(targets)) targets[key] = [...new Set(targets[key])].sort();
  return targets;
}

function normalizedConstraints(query, envelope) {
  const constraintSources = query?.constraintSources ?? {};
  const assumptions = Object.fromEntries(array(query?.assumptions).map((entry) => [entry.key, {
    value: stableValue(entry.value),
    source: entry.source ?? null,
    origin: entry.origin ?? entry.source ?? null,
    origins: array(entry.origins ?? [entry.origin ?? entry.source]).map(String)
  }]));
  return stableValue(compact({
    ...envelope.constraints,
    performanceItem: query?.performanceItem ?? undefined,
    primaryMetric: query?.primaryMetric ?? undefined,
    requestedMetrics: envelope.requestedMetrics,
    assumptions,
    constraintSources
  }));
}

export function validateQuestionContract(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push("Question Contract must be an object");
  if (value?.schemaVersion !== QUESTION_CONTRACT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${QUESTION_CONTRACT_SCHEMA_VERSION}`);
  if (!/^[a-f0-9]{64}$/u.test(String(value?.contractId ?? ""))) errors.push("contractId must be a sha256 fingerprint");
  for (const key of ["originalQuestion", "intent", "questionType", "onMissingEvidence"]) {
    if (typeof value?.[key] !== "string" || !value[key]) errors.push(`${key} is required`);
  }
  if (!value?.targets || typeof value.targets !== "object") errors.push("targets are required");
  for (const key of ["comps", "units", "items", "traits"]) {
    if (!Array.isArray(value?.targets?.[key])) errors.push(`targets.${key} must be an array`);
  }
  if (!Array.isArray(value?.requiredAnswerDimensions) || value.requiredAnswerDimensions.length === 0) errors.push("requiredAnswerDimensions must not be empty");
  if (!value?.requiredEvidence || typeof value.requiredEvidence !== "object") errors.push("requiredEvidence is required");
  for (const dimension of value?.requiredAnswerDimensions ?? []) {
    if (!Array.isArray(value.requiredEvidence?.[dimension]) || value.requiredEvidence[dimension].length === 0) {
      errors.push(`requiredEvidence missing for ${dimension}`);
    }
  }
  if (!Array.isArray(value?.forbiddenClaims)) errors.push("forbiddenClaims must be an array");
  if (typeof value?.needsClarification !== "boolean") errors.push("needsClarification must be boolean");
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function createQuestionContract({
  originalQuestion, intentEnvelope, query, result = {}, spec,
  seasonContextId = query?.seasonContextId ?? "set17-live",
  principalId = "anonymous", conversationId = "default", minimumConfidence = 0.66
} = {}) {
  const envelopeValidation = validateIntentEnvelope(intentEnvelope);
  if (!envelopeValidation.valid) throw new TypeError(`Invalid IntentEnvelope for Question Contract: ${envelopeValidation.errors.join("; ")}`);
  if (!query || typeof query !== "object" || query.validation?.valid === false || result?.validation?.valid === false) {
    throw new TypeError("Question Contract requires a validated Query");
  }
  if (!spec || spec.match?.intent !== intentEnvelope.intent) throw new TypeError("Question Contract requires the exact ConclusionSpec");
  const scope = {
    seasonContextId: String(seasonContextId),
    principal: scopeFingerprint(principalId),
    conversation: scopeFingerprint(conversationId)
  };
  const base = {
    schemaVersion: QUESTION_CONTRACT_SCHEMA_VERSION,
    fingerprintVersion: QUESTION_CONTRACT_FINGERPRINT_VERSION,
    originalQuestion: sanitizedQuestion(originalQuestion ?? intentEnvelope.input ?? query.rawInput ?? ""),
    intent: intentEnvelope.intent,
    questionType: spec.match.questionType,
    resultType: String(result?.type ?? query.intent),
    targets: targetValues(result, intentEnvelope),
    constraints: normalizedConstraints(query, intentEnvelope),
    requiredAnswerDimensions: [...spec.requiredAnswerDimensions],
    requiredEvidence: stableValue(spec.requiredEvidence),
    forbiddenClaims: [...new Set(spec.forbiddenClaims ?? [])],
    onMissingEvidence: "insufficient_evidence",
    needsClarification: Boolean(intentEnvelope.needsClarification || intentEnvelope.confidence < minimumConfidence),
    scope,
    spec: { id: spec.id, version: spec.version }
  };
  const contract = { ...base, contractId: digest(base) };
  const validation = validateQuestionContract(contract);
  if (!validation.valid) throw new TypeError(`Invalid Question Contract: ${validation.errors.join("; ")}`);
  return Object.freeze(contract);
}

export function questionContractFingerprint(value) {
  const { contractId, ...base } = value ?? {};
  return digest(base);
}
