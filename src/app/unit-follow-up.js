const EQUIPMENT_TYPES = new Set(["unit_builds", "unit_builds_batch", "unit_builds_batch_results", "unit_best_3_items", "unit_build_rankings", "unit_item_rankings", "unit_emblem_rankings", "unit_build_completion", "unit_item_comparison"]);
const COMPOSITION_TYPES = new Set(["comps_rankings", "comps_analysis", "comp_rankings", "comp_analysis", "composition_rankings"]);
const list = (value) => Array.isArray(value) ? value : [];
const unitId = (value) => typeof value === "string" ? value : value?.apiName ?? value?.characterId;

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
    ? result.evidence.filter((entry) => entry.temporalStatus !== "historical")
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
  for (const entry of list(result.evidence)) {
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
  if (request.startNewTask || !runtime.cacheStore?.getQueryEvent) return [];
  const records = await Promise.all((request.historyQueryIds ?? []).map(async (id) => {
    try { return await runtime.cacheStore.getQueryEvent(id); } catch { return null; }
  }));
  return records.filter((record) => record
    && record.visitorScope === scope
    && record.conversationId === request.conversationId
    && record.seasonContextId === request.seasonContextId
    && Date.now() - Date.parse(record.createdAt) < 7 * 86400_000)
    .map((record) => record.response);
}
