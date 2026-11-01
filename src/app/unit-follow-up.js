import { createHash } from "node:crypto";

const EQUIPMENT_TYPES = new Set(["unit_builds", "unit_builds_batch", "unit_builds_batch_results", "unit_best_3_items", "unit_build_rankings", "unit_item_rankings", "unit_emblem_rankings", "unit_build_completion", "unit_item_comparison"]);
const COMPOSITION_TYPES = new Set(["comps_rankings", "comps_analysis", "comp_rankings", "comp_analysis", "composition_rankings"]);
const SESSION_EVIDENCE_TTL_MS = 7 * 86400_000;
const MAX_SESSION_EVIDENCE_ENTRIES = 8;
const MAX_SESSION_EVIDENCE_BYTES = 64_000;
const EXPLANATION_FOLLOW_UP = /(?:通俗(?:地|的)?(?:解释|讲|说)|简单(?:地|的)?(?:解释|讲|说)|解释一下|讲明白|说人话|什么意思|没看懂|看不懂|再(?:解释|讲|说|概括|总结)(?:一下)?|重新(?:解释|讲|说)(?:一下)?|in plain (?:language|terms)|explain (?:that|it|again)|what does (?:that|it) mean)/iu;
const CURRENT_DATA_REQUEST = /(?:当前|现在|目前|最新|实时|今天|今日|本周|最近|这版本|胜率|前四率|登顶率|平均名次|选择率|出场率|样本数|场次|排名|排行|最优|最好|最高|最强|推荐|current|latest|today|recent|win\s*rate|top\s*4|pick\s*rate|ranking|best)/iu;
const list = (value) => Array.isArray(value) ? value : [];
const unitId = (value) => typeof value === "string" ? value : value?.apiName ?? value?.characterId;

function deliveredEntries(result) {
  const ids = new Set([...(result.evidenceIds ?? []), ...(result.cardEvidenceIds ?? [])]);
  return list(result.evidence).filter(entry => entry.temporalStatus !== "historical"
    && entry.metadata?.temporalStatus !== "historical"
    && (result.compositionCardScope !== true || ids.has(entry.evidenceId)));
}

function usable(result) {
  return result && result.ok !== false && !result.clarification?.blocking
    && (!result.status || ["completed", "completed_with_warning", "ok", "success", "available"].includes(result.status))
    && !["insufficient_evidence", "ask_user"].includes(result.terminationReason);
}

// This is presentation progress only. Historical responses never enter the
// Evidence Ledger and cannot support current statistical claims.
export function unitResultCoverage(result, apiName) {
  const covered = { equipment: false, composition: false, video: false };
  if (!usable(result)) return covered;
  const entries = Array.isArray(result.evidence)
    ? deliveredEntries(result)
    : [{ toolName: result.type, value: result }];
  for (const entry of entries) {
    const value = entry.value;
    if (!usable(value)) continue;
    const type = entry.toolName ?? value.type;
    if (EQUIPMENT_TYPES.has(type)) {
      const options = [value, ...list(value.results), ...list(value.units)];
      covered.equipment ||= options.some((option) =>
        usable(option) && [unitId(option.unit), option.apiName, option.query?.unit].includes(apiName)
        && (list(option.cards).length > 0 || list(option.builds).length > 0 || list(option.buildOptions).length > 0 || list(option.itemRankings).length > 0
          || list(option.comparison?.entries).some((row) => Number(row.stats?.games ?? row.games) > 0)));
    }
    if (COMPOSITION_TYPES.has(type) && !["ambiguous", "not_found"].includes(value.resolution?.status)
      && !["ambiguous", "not_found"].includes(value.analysis?.resolution?.status)) {
      const comps = [...list(value.results), ...Object.values(value.rankings ?? {}).flatMap(list), ...list(value.references)];
      covered.composition ||= comps.some((comp) => [...list(comp.units), ...list(comp.members)].some((unit) => unitId(unit) === apiName));
    }
    if (type === "strategy_video_search") {
      covered.video ||= [unitId(value.unit), value.query?.unit].includes(apiName)
        && list(value.results ?? value.videos).length > 0;
    }
  }
  return covered;
}

export function singleEquipmentResultSubject(result) {
  if (!usable(result)) return null;
  const subjects = new Map();
  for (const entry of deliveredEntries(result)) {
    if (entry.temporalStatus === "historical" || entry.toolName !== "unit_builds" || !usable(entry.value)) continue;
    const value = entry.value;
    const apiName = unitId(value.unit) ?? value.query?.unit;
    const name = value.unit?.name ?? value.unit?.zhName ?? value.query?.unitName;
    if (apiName && name && unitResultCoverage({ evidence: [entry] }, apiName).equipment) {
      subjects.set(apiName, { entityType: "unit", apiName, name });
    }
  }
  return subjects.size === 1 ? [...subjects.values()][0] : null;
}

export async function loadFollowUpHistory(request, runtime, scope) {
  const records = await loadFollowUpRecords(request, runtime, scope);
  return records.map((record) => record.response);
}

async function loadFollowUpRecords(request, runtime, scope, now = Date.now()) {
  if (request.startNewTask || !runtime.cacheStore?.getQueryEvent) return [];
  const records = await Promise.all((request.historyQueryIds ?? []).map(async (id) => {
    try { return await runtime.cacheStore.getQueryEvent(id); } catch { return null; }
  }));
  return records.filter((record) => record
    && record.visitorScope === scope
    && record.conversationId === request.conversationId
    && record.seasonContextId === request.seasonContextId
    && Number.isFinite(Date.parse(record.createdAt))
    && now - Date.parse(record.createdAt) >= 0
    && now - Date.parse(record.createdAt) < SESSION_EVIDENCE_TTL_MS);
}

export function isSessionEvidenceExplanationFollowUp(input) {
  const text = String(input ?? "").trim();
  return text.length > 0
    && text.length <= 240
    && EXPLANATION_FOLLOW_UP.test(text)
    && !CURRENT_DATA_REQUEST.test(text);
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function sessionEvidenceSnapshotHash(entry) {
  return createHash("sha256").update(JSON.stringify(canonicalJsonValue({
    evidenceId: entry?.evidenceId,
    toolCallId: entry?.toolCallId,
    toolName: entry?.toolName,
    type: entry?.type,
    source: entry?.source,
    updatedAt: entry?.updatedAt ?? null,
    value: entry?.value,
    metadata: entry?.metadata,
    fingerprint: entry?.fingerprint,
    validatedAt: entry?.validatedAt
  }))).digest("hex");
}

export function attachSessionEvidenceSnapshotHashes(response) {
  for (const entry of list(response?.evidence)) {
    entry.sessionSnapshotHash = sessionEvidenceSnapshotHash(entry);
  }
  return response;
}

function hasValidStoredEvidenceSnapshot(entry) {
  return typeof entry?.fingerprint === "string"
    && /^[a-f0-9]{64}$/u.test(entry.fingerprint)
    && typeof entry?.sessionSnapshotHash === "string"
    && entry.sessionSnapshotHash === sessionEvidenceSnapshotHash(entry);
}

// A query event is a server-owned, scoped receipt. For an explanation-only
// follow-up, carry forward only evidence that the prior answer actually cited.
// The historical marker is intentional: this snapshot can explain the earlier
// answer, but it can never become current/live evidence.
export async function loadSessionEvidenceCarryover(request, runtime, scope, options = {}) {
  if (!isSessionEvidenceExplanationFollowUp(request.input)) return [];
  const records = await loadFollowUpRecords(request, runtime, scope, options.now ?? Date.now());
  const record = records
    .filter((candidate) => usable(candidate.response))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (!record) return [];

  const response = record.response;
  const citedIds = new Set(list(response.evidenceIds));
  if (!citedIds.size) return [];
  let totalBytes = 0;
  const promoted = [];
  for (const entry of list(response.evidence)) {
    if (promoted.length >= MAX_SESSION_EVIDENCE_ENTRIES) break;
    if (!citedIds.has(entry?.evidenceId)
      || entry?.temporalStatus === "historical"
      || entry?.metadata?.temporalStatus === "historical"
      || !hasValidStoredEvidenceSnapshot(entry)) continue;
    const valueBytes = Buffer.byteLength(JSON.stringify(entry.value ?? null), "utf8");
    if (valueBytes <= 0 || totalBytes + valueBytes > MAX_SESSION_EVIDENCE_BYTES) continue;
    totalBytes += valueBytes;
    promoted.push({
      evidenceId: `session:${record.queryId}:${entry.evidenceId}`,
      toolCallId: `session:${record.queryId}:${entry.toolCallId}`,
      toolName: entry.toolName,
      type: entry.type,
      source: entry.source,
      updatedAt: entry.updatedAt ?? null,
      temporalStatus: "historical",
      value: structuredClone(entry.value),
      metadata: {
        ...(structuredClone(entry.metadata ?? {})),
        temporalStatus: "historical",
        sourceSurface: "session_query_event",
        sessionCarryover: true,
        originQueryId: record.queryId,
        originEvidenceId: entry.evidenceId,
        originCreatedAt: record.createdAt,
        originFingerprint: entry.fingerprint,
        sessionSnapshotHash: entry.sessionSnapshotHash
      }
    });
  }
  return promoted;
}
