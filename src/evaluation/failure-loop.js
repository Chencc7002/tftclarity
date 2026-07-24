import { createHash, randomUUID } from "node:crypto";

export const FAILURE_LOOP_SCHEMA_VERSION = "failure-loop.v1";
export const FAILURE_CANDIDATE_SCHEMA_VERSION = "failure-candidate.v1";
export const EVALUATION_CANDIDATE_SET_SCHEMA_VERSION = "evaluation-candidate-set.v1";
export const FAILURE_CANDIDATE_PRIVACY_POLICY = "failure-candidate-privacy.v1";

export const FAILURE_CATEGORIES = Object.freeze([
  "domain_error",
  "action_error",
  "entity_error",
  "concept_error",
  "context_error",
  "unsupported_capability",
  "planning_error",
  "tool_error",
  "evidence_error",
  "conclusion_error",
  "unnecessary_clarification",
  "prompt_injection"
]);

export const FAILURE_CANDIDATE_STATUSES = Object.freeze([
  "candidate",
  "human_verified",
  "ignored",
  "rejected",
  "revoked"
]);

const INJECTION_PATTERNS = Object.freeze([
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/iu,
  /忽略(?:之前|上面|先前)(?:的)?(?:指令|指示|规则)/u,
  /system\s+prompt|developer\s+message|系统提示词|开发者消息/iu,
  /(?:tool|function)\s*(?:call|调用)|工具调用/iu,
  /<\/?(?:system|developer|assistant|tool)>/iu,
  /(?:reveal|print|show)\s+(?:the\s+)?(?:secret|prompt|policy)/iu,
  /泄露(?:提示词|系统规则|密钥)/u
]);

const REDACTION_PATTERNS = Object.freeze([
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, replacement: "[redacted-email]" },
  { pattern: /https?:\/\/[^\s]+/giu, replacement: "[redacted-url]" },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[redacted-ip]" },
  { pattern: /(?<!\d)(?:\+?\d[\d\s-]{7,}\d)(?!\d)/g, replacement: "[redacted-phone]" },
  { pattern: /(?:sk|pk|ghp|Bearer)_[A-Za-z0-9._-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}/giu, replacement: "[redacted-secret]" },
  { pattern: /(?:[A-Za-z]:\\|\/)(?:[^\s\\/]+[\\/])+[^\s]+/g, replacement: "[redacted-path]" },
  { pattern: /\b\d{12,}\b/g, replacement: "[redacted-id]" }
]);

const VERSION_KEYS = Object.freeze([
  "seasonContextId",
  "patch",
  "providerVersion",
  "catalogVersion",
  "parserVersion",
  "promptVersion",
  "toolRegistryVersion"
]);

const FORBIDDEN_RAW_KEYS = new Set([
  "rawInput",
  "conversation",
  "messages",
  "systemPrompt",
  "developerPrompt",
  "prompt",
  "toolArguments",
  "toolOutput",
  "secrets",
  "token",
  "authorization"
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
}

function boundedString(value, limit = 200) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

function sanitizeText(value, limit = 600) {
  let text = boundedString(value, limit);
  const injectionDetected = INJECTION_PATTERNS.some((pattern) => pattern.test(text));
  let redactionCount = 0;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    text = text.replace(pattern, () => {
      redactionCount += 1;
      return replacement;
    });
  }
  if (injectionDetected) {
    for (const pattern of INJECTION_PATTERNS) text = text.replace(pattern, "[redacted-instruction]");
  }
  return {
    text: text.slice(0, limit),
    injectionDetected,
    redactionCount
  };
}

function normalizeVersionScope(value = {}) {
  const source = value.versionScope && typeof value.versionScope === "object"
    ? { ...value, ...value.versionScope }
    : value;
  const scope = {};
  for (const key of VERSION_KEYS) {
    const normalized = boundedString(source?.[key], 120);
    scope[key] = normalized || (key === "seasonContextId" ? "default" : key === "patch" ? "current" : null);
  }
  return scope;
}

function normalizeScope(value = {}) {
  const source = value.scope && typeof value.scope === "object" ? { ...value, ...value.scope } : value;
  const userId = boundedString(source.userId ?? source.userKey ?? source.userKeyHash, 160);
  const sessionId = boundedString(source.sessionId ?? source.sessionKey ?? source.sessionKeyHash, 160);
  return {
    userKeyHash: userId ? `u_${hash(userId).slice(0, 24)}` : null,
    sessionKeyHash: sessionId ? `s_${hash(sessionId).slice(0, 24)}` : null,
    knowledgeScope: "failure_candidates_only"
  };
}

function scopeKey(scope) {
  return stable(scope);
}

function versionKey(scope) {
  return stable(scope);
}

function sanitizeTypes(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => boundedString(value, 40)).filter(Boolean))].sort();
}

function taskFrameSummary(frame = {}) {
  const entities = [
    ...(Array.isArray(frame.subjects) ? frame.subjects : []),
    ...(Array.isArray(frame.candidates) ? frame.candidates : []),
    ...(Array.isArray(frame.concepts) ? frame.concepts : [])
  ];
  return {
    schemaVersion: boundedString(frame.schemaVersion, 40) || null,
    domain: boundedString(frame.domain, 40) || null,
    action: boundedString(frame.action, 40) || null,
    understandingStatus: boundedString(frame.understandingStatus, 60) || null,
    subjectTypes: sanitizeTypes((frame.subjects ?? []).map((entry) => entry?.expectedType)),
    candidateTypes: sanitizeTypes((frame.candidates ?? []).map((entry) => entry?.expectedType)),
    conceptTypes: sanitizeTypes((frame.concepts ?? []).map((entry) => entry?.expectedType)),
    entityIds: [...new Set(entities.map((entry) => boundedString(entry?.resolvedId, 120)).filter(Boolean))].sort(),
    constraintKeys: Object.keys(frame.constraints ?? {}).map((key) => boundedString(key, 40)).filter(Boolean).sort(),
    goal: boundedString(frame.goal, 80) || null,
    confidence: Number.isFinite(Number(frame.confidence)) ? Number(frame.confidence) : null
  };
}

function traceSummary(event = {}) {
  const trace = event.trace && typeof event.trace === "object" ? event.trace : event;
  return {
    route: boundedString(trace.route, 60) || null,
    failureLayer: boundedString(trace.failureLayer ?? trace.layer, 60) || null,
    errorCode: boundedString(trace.errorCode ?? trace.error?.code ?? trace.code, 80) || null,
    outcome: boundedString(trace.outcome ?? trace.status, 60) || null,
    fallback: Boolean(trace.fallback ?? trace.usedFallback)
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}

export function classifyFailure(event = {}) {
  const frame = event.taskFrame ?? event.frame ?? {};
  const trace = traceSummary(event);
  const status = String(frame.understandingStatus ?? event.understandingStatus ?? "");
  const action = String(frame.action ?? event.action ?? "");
  const layer = `${trace.failureLayer ?? ""} ${trace.errorCode ?? ""}`.toLowerCase();

  if (INJECTION_PATTERNS.some((pattern) => pattern.test(String(event.input ?? event.request?.input ?? "")))) {
    return "prompt_injection";
  }
  if (status === "out_of_domain" || layer.includes("domain")) return "domain_error";
  if (status === "understood_but_unsupported" || action === "find_video" || layer.includes("unsupported")) {
    return "unsupported_capability";
  }
  if (status === "understood_but_missing_context" || layer.includes("context") || layer.includes("clarif")) {
    return event.unnecessaryClarification ? "unnecessary_clarification" : "context_error";
  }
  if (status === "ambiguous" || layer.includes("entity")) return "entity_error";
  if (layer.includes("concept")) return "concept_error";
  if (layer.includes("plan")) return "planning_error";
  if (layer.includes("tool") || trace.errorCode?.startsWith("tool_")) return "tool_error";
  if (layer.includes("evidence")) return "evidence_error";
  if (layer.includes("conclusion")) return "conclusion_error";
  if (layer.includes("action") || action === "unknown") return "action_error";
  return firstNonEmpty(event.failureCategory, event.failureLabel) ?? "tool_error";
}

export function sanitizeFailureRecord(event = {}, options = {}) {
  const requestInput = event.input ?? event.request?.input ?? event.userInput ?? "";
  const input = sanitizeText(requestInput, options.maxInputLength ?? 600);
  const frame = taskFrameSummary(event.taskFrame ?? event.frame ?? {});
  const trace = traceSummary(event);
  const versionScope = normalizeVersionScope(event.versionScope ?? event);
  const failureCategory = classifyFailure(event);
  const privacyPartition = boundedString(options.privacyPartition ?? event.privacyPartition, 80) || "default";
  const scope = normalizeScope({ ...event, ...options });
  const rawUserId = boundedString(event.userId ?? event.visitorId ?? options.userId, 160);
  const rawSessionId = boundedString(event.sessionId ?? event.conversationId ?? options.sessionId, 160);
  if (rawUserId) input.text = input.text.split(rawUserId).join("[redacted-user]");
  if (rawSessionId) input.text = input.text.split(rawSessionId).join("[redacted-session]");
  const telemetry = event.telemetry ?? event.usage ?? {};
  const toolNames = [...new Set((event.toolNames ?? event.tools ?? event.trace?.toolNames ?? [])
    .map((name) => boundedString(name, 100)).filter(Boolean))].sort();
  const runId = boundedString(event.runId ?? event.run_id ?? event.queryEvent?.runId, 160) || null;
  const failureLayer = boundedString(event.failureLayer ?? trace.failureLayer, 60) || null;
  const failureType = boundedString(
    event.failureType ?? trace.errorCode ?? ({
      domain_error: "domain_mismatch",
      action_error: "action_mismatch",
      entity_error: "unresolved_alias",
      concept_error: "unresolved_concept",
      context_error: "missing_context",
      unsupported_capability: "unsupported_capability",
      planning_error: "invalid_plan",
      tool_error: "tool_failure",
      evidence_error: "missing_evidence",
      conclusion_error: "invalid_conclusion",
      unnecessary_clarification: "unnecessary_clarification",
      prompt_injection: "prompt_injection"
    })[failureCategory],
    80
  ) || "unknown_failure";
  const sanitized = {
    schemaVersion: FAILURE_CANDIDATE_SCHEMA_VERSION,
    inputRedacted: input.text,
    inputHash: hash(String(requestInput ?? "").normalize("NFKC")),
    taskFrame: frame,
    trace,
    failureCategory,
    failureLayer,
    failureType,
    runId,
    action: frame.action,
    confidence: frame.confidence,
    toolNames,
    inputTokens: nonNegativeMetric(telemetry.inputTokens ?? telemetry.input_tokens ?? telemetry.uncachedInputTokens),
    cachedInputTokens: nonNegativeMetric(telemetry.cachedInputTokens ?? telemetry.cached_input_tokens),
    outputTokens: nonNegativeMetric(telemetry.outputTokens ?? telemetry.output_tokens),
    scope,
    scopeKey: scopeKey(scope),
    seasonContextId: versionScope.seasonContextId,
    versionScope,
    versionKey: versionKey(versionScope),
    privacyPartition,
    injectionDetected: input.injectionDetected,
    privacy: {
      policy: FAILURE_CANDIDATE_PRIVACY_POLICY,
      rawInputStored: false,
      conversationStored: false,
      visitorIdentityStored: false,
      toolPayloadStored: false,
      redactionCount: input.redactionCount
    },
    source: boundedString(options.source ?? event.source, 40) || "live_request",
    capturedAt: options.capturedAt ?? event.capturedAt ?? new Date().toISOString(),
    createdAt: options.createdAt ?? event.createdAt ?? event.capturedAt ?? new Date().toISOString()
  };
  return sanitized;
}

function nonNegativeMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function assertNoForbiddenRawFields(value, path = "record") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RAW_KEYS.has(key)) throw new Error(`Failure candidate contains forbidden raw field: ${path}.${key}`);
    assertNoForbiddenRawFields(nested, `${path}.${key}`);
  }
}

export function createFailureCandidate(event = {}, options = {}) {
  const sanitized = sanitizeFailureRecord(event, options);
  const fingerprint = hash({
    inputHash: sanitized.inputHash,
    taskFrame: sanitized.taskFrame,
    trace: sanitized.trace,
    failureCategory: sanitized.failureCategory,
    versionKey: sanitized.versionKey,
    privacyPartition: sanitized.privacyPartition,
    scopeKey: sanitized.scopeKey
  });
  const clusterId = `cl_${hash({
    taskFrame: sanitized.taskFrame,
    trace: sanitized.trace,
    failureCategory: sanitized.failureCategory,
    failureType: sanitized.failureType,
    versionKey: sanitized.versionKey
  }).slice(0, 20)}`;
  const candidate = {
    ...sanitized,
    candidateId: options.candidateId ?? `fc_${fingerprint.slice(0, 24)}`,
    fingerprint,
    clusterId,
    status: "candidate",
    review: null,
    revoked: false,
    exportedAt: null,
    governance: {
      autoApply: false,
      productionEffect: "none",
      allowedExport: "human_verified_evaluation_only",
      appliesTo: []
    }
  };
  assertNoForbiddenRawFields(candidate);
  return candidate;
}

function scopeMatches(candidate, requested = {}) {
  const scope = normalizeVersionScope(requested);
  const requestedScope = normalizeScope(requested);
  const hasUserScope = requested.userId || requested.userKey || requested.userKeyHash || requested.scope?.userId || requested.scope?.userKey || requested.scope?.userKeyHash;
  const hasSessionScope = requested.sessionId || requested.sessionKey || requested.sessionKeyHash || requested.scope?.sessionId || requested.scope?.sessionKey || requested.scope?.sessionKeyHash;
  return candidate.versionKey === versionKey(scope)
    && (!requested.privacyPartition || candidate.privacyPartition === requested.privacyPartition)
    && (!hasUserScope || candidate.scope.userKeyHash === requestedScope.userKeyHash)
    && (!hasSessionScope || candidate.scope.sessionKeyHash === requestedScope.sessionKeyHash);
}

function publicCandidate(candidate) {
  return clone(candidate);
}

function transitionAllowed(from, to) {
  return (from === "candidate" && ["human_verified", "rejected", "revoked"].includes(to))
    || (from === "candidate" && ["ignored"].includes(to))
    || (from === "human_verified" && ["revoked"].includes(to))
    || (from === "rejected" && ["revoked"].includes(to))
    || (from === "ignored" && ["revoked"].includes(to));
}

export class FailureCandidateStore {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? randomUUID;
    this.candidates = new Map();
    this.byFingerprint = new Map();
    this.audit = [];
  }

  ingest(event = {}, options = {}) {
    const candidate = createFailureCandidate(event, options);
    const existingId = this.byFingerprint.get(candidate.fingerprint);
    if (existingId) {
      const existing = this.candidates.get(existingId);
      return { candidate: publicCandidate(existing), duplicate: true };
    }
    this.candidates.set(candidate.candidateId, candidate);
    this.byFingerprint.set(candidate.fingerprint, candidate.candidateId);
    this.audit.push({
      auditId: this.createId(),
      action: "ingest",
      candidateId: candidate.candidateId,
      status: candidate.status,
      versionKey: candidate.versionKey,
      privacyPartition: candidate.privacyPartition,
      createdAt: new Date(this.now()).toISOString()
    });
    return { candidate: publicCandidate(candidate), duplicate: false };
  }

  ingestQueryEvent(queryEvent = {}, options = {}) {
    return this.ingest({
      ...queryEvent,
      queryEvent,
      input: queryEvent.input ?? queryEvent.request?.input,
      taskFrame: queryEvent.taskFrame ?? queryEvent.frame,
      trace: queryEvent.trace ?? queryEvent.routeTrace,
      telemetry: queryEvent.telemetry ?? queryEvent.usage,
      userId: queryEvent.userId ?? queryEvent.visitorId ?? options.userId,
      sessionId: queryEvent.sessionId ?? queryEvent.conversationId ?? options.sessionId,
      versionScope: queryEvent.versionScope ?? options.versionScope,
      seasonContextId: queryEvent.seasonContextId ?? options.seasonContextId
    }, options);
  }

  get(candidateId, options = {}) {
    const candidate = this.candidates.get(String(candidateId ?? ""));
    if (!candidate || !scopeMatches(candidate, options)) return null;
    return publicCandidate(candidate);
  }

  list(options = {}) {
    return [...this.candidates.values()]
      .filter((candidate) => scopeMatches(candidate, options))
      .filter((candidate) => !options.status || candidate.status === options.status)
      .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
      .map(publicCandidate);
  }

  review(candidateId, decision, options = {}) {
    const candidate = this.candidates.get(String(candidateId ?? ""));
    if (!candidate || !scopeMatches(candidate, options)) return null;
    const nextStatus = decision === "verify" ? "human_verified"
      : decision === "reject" ? "rejected"
        : decision === "ignore" ? "ignored"
          : null;
    if (!nextStatus || !transitionAllowed(candidate.status, nextStatus)) {
      throw new Error(`Invalid failure candidate review transition: ${candidate.status} -> ${nextStatus ?? decision}`);
    }
    const reviewer = boundedString(options.reviewer ?? options.actor, 100);
    if (!reviewer) throw new Error("Human review requires reviewer");
    const before = candidate.status;
    candidate.status = nextStatus;
    candidate.review = {
      decision,
      reviewer,
      note: sanitizeText(options.note ?? "", 300).text || null,
      reviewedAt: new Date(this.now()).toISOString()
    };
    this.audit.push({
      auditId: this.createId(),
      action: decision,
      candidateId: candidate.candidateId,
      before,
      after: nextStatus,
      versionKey: candidate.versionKey,
      privacyPartition: candidate.privacyPartition,
      createdAt: new Date(this.now()).toISOString()
    });
    return publicCandidate(candidate);
  }

  revoke(candidateId, options = {}) {
    const candidate = this.candidates.get(String(candidateId ?? ""));
    if (!candidate || !scopeMatches(candidate, options)) return null;
    if (!transitionAllowed(candidate.status, "revoked")) {
      throw new Error(`Failure candidate cannot be revoked from ${candidate.status}`);
    }
    const actor = boundedString(options.actor ?? options.reviewer, 100);
    if (!actor) throw new Error("Revocation requires actor");
    const before = candidate.status;
    candidate.status = "revoked";
    candidate.revoked = true;
    candidate.review = {
      ...(candidate.review ?? {}),
      decision: "revoke",
      reviewer: actor,
      note: sanitizeText(options.reason ?? "", 300).text || null,
      reviewedAt: new Date(this.now()).toISOString()
    };
    this.audit.push({
      auditId: this.createId(),
      action: "revoke",
      candidateId: candidate.candidateId,
      before,
      after: "revoked",
      versionKey: candidate.versionKey,
      privacyPartition: candidate.privacyPartition,
      createdAt: new Date(this.now()).toISOString()
    });
    return publicCandidate(candidate);
  }

  ignore(candidateId, options = {}) {
    return this.review(candidateId, "ignore", options);
  }

  delete(candidateId, options = {}) {
    const id = String(candidateId ?? "");
    const candidate = this.candidates.get(id);
    if (!candidate || !scopeMatches(candidate, options)) return null;
    const actor = boundedString(options.actor, 100);
    if (!actor) throw new Error("Candidate deletion requires actor");
    this.candidates.delete(id);
    this.byFingerprint.delete(candidate.fingerprint);
    this.audit.push({
      auditId: this.createId(),
      action: "delete",
      candidateId: id,
      versionKey: candidate.versionKey,
      privacyPartition: candidate.privacyPartition,
      reason: sanitizeText(options.reason ?? "", 300).text || null,
      createdAt: new Date(this.now()).toISOString()
    });
    return { candidateId: id, deleted: true };
  }

  exportEvaluationCandidates(options = {}) {
    const candidates = this.list({ ...options, status: "human_verified" })
      .filter((candidate) => options.includeInjectionCases === true || !candidate.injectionDetected);
    const records = candidates.map((candidate) => ({
      id: candidate.candidateId,
      input: candidate.inputRedacted,
      source: {
        kind: "failure_candidate",
        candidateId: candidate.candidateId,
        privacyPolicy: FAILURE_CANDIDATE_PRIVACY_POLICY
      },
      datasetVersion: options.datasetVersion ?? "phase8a-failure-candidates.v1",
      versionScope: clone(candidate.versionScope),
      labels: {
        domain: candidate.taskFrame.domain,
        action: candidate.taskFrame.action,
        understandingStatus: candidate.taskFrame.understandingStatus,
        failureCategory: candidate.failureCategory,
        expectedFallback: candidate.failureCategory === "unsupported_capability" ? "controlled_unsupported" : "review_required",
        supportStatus: candidate.failureCategory === "unsupported_capability" ? "unsupported" : "failure_candidate"
      },
      confidence: candidate.confidence,
      action: candidate.action,
      failureLayer: candidate.failureLayer,
      failureType: candidate.failureType
    }));
    for (const candidate of candidates) {
      const stored = this.candidates.get(candidate.candidateId);
      stored.exportedAt = new Date(this.now()).toISOString();
    }
    return {
      schemaVersion: EVALUATION_CANDIDATE_SET_SCHEMA_VERSION,
      datasetVersion: options.datasetVersion ?? "phase8a-failure-candidates.v1",
      versionScope: normalizeVersionScope(options),
      privacyPolicy: FAILURE_CANDIDATE_PRIVACY_POLICY,
      governance: { autoApply: false, productionEffect: "none", destination: "evaluation_only" },
      candidates: records
    };
  }

  exportEvaluationJSONL(options = {}) {
    return this.exportEvaluationCandidates(options).candidates.map((record) => JSON.stringify(record)).join("\n");
  }

  listAudit(options = {}) {
    return this.audit.filter((entry) => (
      (!options.privacyPartition || entry.privacyPartition === options.privacyPartition)
      && (!options.versionKey || entry.versionKey === options.versionKey)
    )).map(clone);
  }
}

export function exportEvaluationCandidates(store, options = {}) {
  if (!store || typeof store.exportEvaluationCandidates !== "function") {
    throw new TypeError("exportEvaluationCandidates requires a FailureCandidateStore");
  }
  return store.exportEvaluationCandidates(options);
}
