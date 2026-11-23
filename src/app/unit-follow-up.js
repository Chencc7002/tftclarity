import { createHash } from "node:crypto";

const EQUIPMENT_TYPES = new Set(["unit_builds", "unit_builds_batch", "unit_builds_batch_results", "unit_best_3_items", "unit_build_rankings", "unit_item_rankings", "unit_emblem_rankings", "unit_build_completion", "unit_item_comparison"]);
const COMPOSITION_TYPES = new Set(["comps_rankings", "comps_analysis", "comp_rankings", "comp_analysis", "composition_rankings"]);
const SESSION_EVIDENCE_TTL_MS = 7 * 86400_000;
const MAX_SESSION_EVIDENCE_ENTRIES = 8;
const MAX_SESSION_EVIDENCE_BYTES = 64_000;
const METRIC_FIELDS = { 均名: ["avg"], 平均名次: ["avg"], 前四率: ["top4"], 登顶率: ["win"], 吃鸡率: ["win"] };
const EQUIPMENT_ASSESSMENT = /^(?:那|所以)?(?:为什么|为啥|怎么)(?:会|说|觉得)?(?<item>[\p{Script=Han}]{0,14}?)(?:表现)?(?:比较|这么|那么|很|偏|不太)?(?:弱|差|强|好)[呢啊吗？?。]*$/u;
const CORE_BUILD_FOLLOW_UP = /^(?:那|那么|所以|它|他|她)(?:它|他|她)?(?:的)?(?:有(?:什么|哪些)|要出什么|推荐的)?(?:核心装备|核心装|核心三件套)(?:是什么|有哪些|怎么出)?[呢啊？?。]*$/u;
// Match a judgement about a quoted result. An additional entity, filter or
// refresh request must go through normal query planning.
const METRIC_JUDGEMENT = /^(?:(?:刚才|上面)的?)?\s*(?:(?<label>均名|平均名次|前四率|登顶率|吃鸡率)\s*)?(?<number>\d{1,3}(?:\.\d{1,2})?)(?<percent>[%％]?)\s*[,，]?\s*(?:其实|感觉|看起来)?(?:是不是|算不算|算是|已经|也)?(?:有点|太|很|挺|比较|偏|还|不)?(?:差|弱|低|高|强|不错|好)(?:了|的)?(?:吧|吗|啊|么)?[？?！!。]*$/u;
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

async function originalCitations(record, request, runtime, scope, now) {
  const citedIds = new Set(list(record.response.evidenceIds));
  const carried = list(record.response.evidence).filter(entry => citedIds.has(entry.evidenceId)
    && entry.metadata?.sessionCarryover && entry.temporalStatus === "historical" && hasValidStoredEvidenceSnapshot(entry));
  if (carried.length !== 1 || citedIds.size !== 1) return { record, citedIds };
  const origin = carried[0].metadata;
  const [original] = await loadFollowUpRecords({ ...request, historyQueryIds: [origin.originQueryId] }, runtime, scope, now);
  if (!usable(original?.response) || !list(original.response.evidenceIds).includes(origin.originEvidenceId)) return null;
  return { record: original, citedIds: new Set([origin.originEvidenceId]) };
}

export async function loadEquipmentQueryContinuation(request, runtime, scope, now) {
  if (runtime.sessionMetricReviewMode === "off") return null;
  const text = request.input.trim();
  const star = /^(?:那|那么)?(?:如果)?(?:换成?|改成?|看)?([一二三123])星(?:的)?[呢啊？?。]*$/u.exec(text);
  if (!star && !CORE_BUILD_FOLLOW_UP.test(text)) return null;
  const [record] = await loadFollowUpRecords({ ...request, historyQueryIds: request.historyQueryIds.slice(-1) }, runtime, scope, now);
  if (!usable(record?.response)) return null;
  const origin = await originalCitations(record, request, runtime, scope, now);
  if (!origin) return null;
  const trusted = list(origin.record.response.evidence).filter(entry => origin.citedIds.has(entry.evidenceId)
    && entry.temporalStatus !== "historical" && entry.metadata?.temporalStatus !== "historical" && hasValidStoredEvidenceSnapshot(entry));
  const subject = singleEquipmentResultSubject({ evidence: trusted });
  if (!subject) return null;
  const rankings = trusted.filter(entry => entry.toolName === "unit_builds" && entry.value?.query?.unit === subject.apiName);
  if (rankings.length !== 1) return null;
  const query = rankings[0].value.query;
  if (query.intent !== "unit_item_rankings" || query.comp || query.traitNames?.length || query.ownedItems?.length
    || query.excludedItems?.length || query.lockedItems?.length) return null;
  const filters = {};
  for (const [key, source, arg] of [["star_level","starLevel","starLevel"], ["days","days","days"],
    ["rank_filter","rankFilter","rank"], ["min_samples","minSamples","minSamples"]]) {
    if (query[source] != null && query.assumptions?.some(a => a.key === key && a.origin === "current_input")) filters[arg] = query[source];
  }
  if (!star) return { ...subject, kind: "core_build_subject", filters: { ...filters, itemCount: 3, itemPolicy: "ordinary_only" } };
  if (!query.performanceItem || !rankings[0].value.itemRankings?.some(row => row.apiName === query.performanceItem)) return null;
  const level = Number(star[1]) || "一二三".indexOf(star[1]) + 1;
  return { ...subject, kind: "equipment_star_change", filters: { ...filters, performanceItem: query.performanceItem,
    itemPolicy: query.itemPolicy, itemCategories: query.itemCategories ?? [], starLevel: [level] } };
}

// A query event is a server-owned, scoped receipt. For an explanation-only
// follow-up, carry forward only evidence that the prior answer actually cited.
// The historical marker is intentional: this snapshot can explain the earlier
// answer, but it can never become current/live evidence.
export async function loadSessionEvidenceCarryover(request, runtime, scope, options = {}) {
  const metric = !options.refresh && runtime.sessionMetricReviewMode !== "off"
    && METRIC_JUDGEMENT.exec(String(request.input ?? "").trim())?.groups;
  const assessment = !options.refresh && runtime.sessionMetricReviewMode !== "off"
    && EQUIPMENT_ASSESSMENT.exec(String(request.input ?? "").trim())?.groups;
  const review = metric || assessment;
  if (!review && !isSessionEvidenceExplanationFollowUp(request.input)) return [];
  const historyRequest = review ? { ...request, historyQueryIds: (request.historyQueryIds ?? []).slice(-1) } : request;
  const records = await loadFollowUpRecords(historyRequest, runtime, scope, options.now ?? Date.now());
  let record = records
    .filter((candidate) => usable(candidate.response))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (!record) return [];

  const displayedAnswer = String(record.response.answer ?? "");
  const quotedMetric = metric && metric.number + (metric.percent ? "%" : "");
  if (metric) {
    const displayedNumbers = displayedAnswer.replaceAll("％", "%").match(/\d+(?:\.\d+)?%?/gu) ?? [];
    if (!displayedNumbers.some(token => token.endsWith("%") === Boolean(metric.percent)
      && Number(token.replace("%", "")) === Number(metric.number))) return [];
  }
  let citedIds = new Set(list(record.response.evidenceIds));
  if (review) {
    const origin = await originalCitations(record, request, runtime, scope, options.now);
    if (!origin) return [];
    ({ record, citedIds } = origin);
  }
  const response = record.response;
  if (!citedIds.size) return [];
  let totalBytes = 0;
  const promoted = [];
  for (const entry of list(response.evidence)) {
    if (promoted.length >= MAX_SESSION_EVIDENCE_ENTRIES) break;
    if (!citedIds.has(entry?.evidenceId)
      || entry?.temporalStatus === "historical"
      || entry?.metadata?.temporalStatus === "historical"
      || !hasValidStoredEvidenceSnapshot(entry)) continue;
    let reviewField;
    if (review) {
      if (entry.toolName !== "unit_builds") continue;
      const target = entry.value?.query?.performanceItem;
      const row = target && list(entry.value.itemRankings).find(row => row.apiName === target);
      if (!row?.stats) continue;
      if (metric) {
        const keys = METRIC_FIELDS[metric.label] ?? (metric.percent ? ["top4", "win"] : ["avg"]);
        const matches = keys.filter(key => row.stats[key] === Number(metric.number) && !(key === "avg" && metric.percent));
        if (matches.length !== 1) continue;
        [reviewField] = matches;
      } else if (assessment.item && !["它", "这件", "这件装备", row.name].includes(assessment.item)) continue;
      else reviewField = "avg";
    }
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
        ...(metric ? { quotedMetric } : {}),
        ...(assessment ? { equipmentAssessment: true } : {}),
        ...(reviewField ? { reviewField } : {}),
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
