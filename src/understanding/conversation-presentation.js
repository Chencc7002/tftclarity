export const CONVERSATION_PRESENTATION_VERSION = "conversation-presentation.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function compId(value) {
  return value?.compId ?? value?.source?.clusterId ?? value?.id ?? null;
}

function buildId(value) {
  return value?.apiName
    ?? value?.itemApiName
    ?? value?.raw?.unit_builds
    ?? value?.raw?.unit_build
    ?? (Array.isArray(value?.items) ? value.items.join("|") : null)
    ?? value?.id
    ?? null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function applyConversationResultPresentation(result, options = {}) {
  const requestMore = ["request_more", "next_page"].includes(options.dialogueAct);
  if (!requestMore && options.presentation?.avoidSeen !== true) return result;
  const shown = new Set(array(options.lastResult?.shownIds).map(String));
  const requestedCount = Math.max(1, Math.min(
    100,
    Number(options.presentation?.requestedCount ?? options.lastResult?.returnedCount ?? 3)
  ));
  let pageIds = [];
  let totalCount = 0;
  if (String(result?.type ?? "").startsWith("comp_")) {
    const allIds = unique(Object.values(result.rankings ?? {}).flat().map(compId));
    totalCount = result.preferenceSearch
      ? Math.max(0, Number(result.preferenceSearch.conditionMatches ?? allIds.length)
        - Number(result.preferenceSearch.lowSampleMatches ?? 0))
      : Number(result.diagnostics?.acceptedGroups ?? allIds.length);
    result.rankings = Object.fromEntries(Object.entries(result.rankings ?? {}).map(([key, values]) => {
      const page = array(values)
        .filter((value) => !shown.has(String(compId(value))))
        .slice(0, requestedCount);
      pageIds.push(...page.map(compId));
      return [key, page];
    }));
    pageIds = unique(pageIds);
    if (result.preferenceSearch) result.preferenceSearch.returnedCount = pageIds.length;
  } else {
    const target = result.comparison?.entries?.length
      ? result.comparison.entries
      : result.itemRankings?.length
        ? result.itemRankings
        : result.rankedBuilds;
    totalCount = array(target).length;
    const page = array(target)
      .filter((value) => !shown.has(String(buildId(value))))
      .slice(0, requestedCount);
    pageIds = unique(page.map(buildId));
    if (result.comparison?.entries?.length) result.comparison.entries = page;
    else if (result.itemRankings?.length) result.itemRankings = page;
    else result.rankedBuilds = page;
  }
  result.conversationPage = {
    schemaVersion: CONVERSATION_PRESENTATION_VERSION,
    requestedCount,
    returnedCount: pageIds.length,
    shownIds: pageIds,
    totalCount,
    exhausted: unique([...shown, ...pageIds]).length >= totalCount
  };
  result.text = pageIds.length
    ? `已继续当前任务，返回下一批 ${pageIds.length} 个不重复结果。`
    : "当前条件下没有更多未展示的结果。";
  return result;
}
