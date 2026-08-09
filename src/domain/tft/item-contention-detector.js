function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function optionItems(option = {}) {
  return unique((option.items ?? []).map((item) => (
    typeof item === "string" ? item : item?.apiName
  )));
}

function itemDisplayName(option, apiName) {
  const item = (option?.items ?? []).find((candidate) => (
    typeof candidate === "object" && String(candidate?.apiName ?? "") === apiName
  ));
  return item?.displayName ?? item?.name ?? apiName;
}

function participantSupport(result = {}, apiName) {
  const options = (result.buildOptions ?? []).filter((option) => optionItems(option).includes(apiName));
  if (!options.length) return null;
  return {
    unitRef: {
      apiName: result.apiName ?? result.unit?.apiName ?? null,
      name: result.name ?? result.unit?.displayName ?? result.apiName ?? null
    },
    buildOptionIds: unique(options.map((option) => option.optionId)),
    optionRanks: unique(options.map((option) => option.rank)).map(Number),
    optionRoles: unique(options.map((option) => option.role)),
    supportingBuildCount: options.length,
    maxSamples: Math.max(0, ...options.map((option) => Number(option.metrics?.samples ?? 0))),
    evidencePaths: unique(options.map((option) => option.evidencePath))
  };
}

function unitRef(result = {}) {
  const apiName = result.apiName ?? result.unit?.apiName ?? null;
  return {
    apiName,
    name: result.name ?? result.unit?.displayName ?? apiName
  };
}

function failureReason(result = {}) {
  const detail = [result.warning, result.shortageReason].filter(Boolean).join(" ");
  if (/(?:timed?\s*out|timeout|超时)/iu.test(detail)) return "timeout";
  if (/(?:invalid|malformed|parse|schema|无效)/iu.test(detail)) return "invalid_response";
  if (/(?:not[ _-]?found|insufficient_distinct_builds|未找到)/iu.test(detail)) return "not_found";
  return "other";
}

export function detectItemContention(results = [], options = {}) {
  const limitValue = Number(options.limit ?? 4);
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(4, Math.floor(limitValue)))
    : 4;
  const eligibleResults = (results ?? []).filter((result) => (
    result?.apiName ?? result?.unit?.apiName
  ));
  const availableResults = eligibleResults.filter((result) => (
    result?.available === true
    && (result.apiName ?? result.unit?.apiName)
    && Array.isArray(result.buildOptions)
    && result.buildOptions.length > 0
  ));
  const itemNames = new Map();
  const apiNames = new Set();
  for (const result of availableResults) {
    for (const option of result.buildOptions) {
      for (const apiName of optionItems(option)) {
        apiNames.add(apiName);
        if (!itemNames.has(apiName)) itemNames.set(apiName, itemDisplayName(option, apiName));
      }
    }
  }
  const contestedItems = [...apiNames].map((apiName) => {
    const participants = availableResults
      .map((result) => participantSupport(result, apiName))
      .filter(Boolean);
    return {
      itemRef: { apiName, name: itemNames.get(apiName) ?? apiName },
      participants,
      participantCount: participants.length,
      supportingBuildCount: participants.reduce((sum, entry) => sum + entry.supportingBuildCount, 0),
      maxSampleSupport: participants.reduce((sum, entry) => sum + entry.maxSamples, 0)
    };
  }).filter((item) => item.participantCount >= 2)
    .sort((left, right) => (
      right.participantCount - left.participantCount
      || right.supportingBuildCount - left.supportingBuildCount
      || right.maxSampleSupport - left.maxSampleSupport
      || left.itemRef.apiName.localeCompare(right.itemRef.apiName)
    ));
  const selected = contestedItems.slice(0, limit);
  const status = availableResults.length < 2
    ? "insufficient_build_data"
    : selected.length
      ? "available"
      : "no_contention";
  const failedResults = eligibleResults.filter((result) => !availableResults.includes(result));
  const coverageStatus = failedResults.length ? "partial" : "complete";
  return {
    schemaVersion: "item-contention-plan.v1",
    type: "item_contention_plan",
    status,
    contentionStatus: status,
    coverageStatus,
    compositionId: options.compositionId ?? null,
    selectionBasis: "cross_unit_build_option_intersection",
    eligibleUnitCount: eligibleResults.length,
    eligibleUnits: eligibleResults.map((result) => ({
      ...unitRef(result),
      buildOptionCount: Array.isArray(result.buildOptions) ? result.buildOptions.length : 0
    })),
    successfulUnitCount: availableResults.length,
    successfulUnits: availableResults.map((result) => ({
      ...unitRef(result),
      buildOptionCount: result.buildOptions.length
    })),
    failedUnitCount: failedResults.length,
    failedUnits: failedResults.map((result) => ({
      unit: unitRef(result),
      reason: failureReason(result),
      detail: result.warning ?? result.shortageReason ?? null
    })),
    contestedItems: selected,
    apiNames: selected.map((item) => item.itemRef.apiName),
    priorityConclusion: "not_evaluated",
    warnings: [
      ...(status === "available" ? [] : [status]),
      ...(coverageStatus === "partial" ? ["partial_coverage"] : [])
    ]
  };
}
