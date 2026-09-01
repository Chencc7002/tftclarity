const list = (value) => Array.isArray(value) ? value : [];
const time = (value) => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
const sameUnits = (left, right) => left.length === right.length
  && new Set(left).size === left.length && new Set(right).size === right.length
  && left.every((id) => typeof id === "string" && id && right.includes(id));

function currentEntry(entry, toolName, now, ttlMs) {
  if (entry?.toolName !== toolName || !entry.validatedAt || entry.source !== "metatft"
    || entry.metadata?.source !== "metatft") return false;
  const markers = [entry.temporalStatus, entry.metadata?.temporalStatus, entry.metadata?.freshnessStatus, entry.metadata?.freshness?.status];
  if (markers.some((value) => ["historical", "stale", "expired"].includes(value))
    || entry.metadata?.stale || entry.metadata?.cache?.stale || entry.value?.cache?.stale) return false;
  const stamps = [entry.updatedAt, entry.metadata.updatedAt, entry.value?.source?.updatedAt];
  if (stamps.some((stamp) => !Number.isFinite(time(stamp)) || time(stamp) > now || now - time(stamp) > ttlMs)) return false;
  const expiry = entry.value?.cache?.expiresAt ?? entry.metadata?.cache?.expiresAt;
  return expiry == null || (Number.isFinite(time(expiry)) && time(expiry) > now);
}

function matchesPlan(entry, plan, now) {
  if (!currentEntry(entry, "composition_tactical_details", now, 5 * 60 * 1000)) return false;
  const value = entry.value;
  const formation = value?.formation;
  const source = formation?.source;
  if (value?.type !== "composition_tactical_details" || value.seasonContextId !== plan.seasonContextId
    || value.compId !== plan.compositionId || value.clusterId !== plan.clusterId
    || value.compositionRef?.compId !== plan.compositionId || value.compositionRef?.clusterId !== plan.clusterId
    || source?.compId !== plan.compositionId || source?.clusterId !== plan.clusterId
    || source?.endpoint !== "/tft-comps-api/comp_details"
    || !Number.isFinite(time(source.updatedAt)) || time(source.updatedAt) > now || now - time(source.updatedAt) > 5 * 60 * 1000
    || !["available", "partial", "unavailable"].includes(formation.status)) return false;
  const units = list(formation.units);
  const missing = list(formation.missingUnitApiNames);
  if (!sameUnits([...units.map((unit) => unit.apiName), ...missing], plan.units)) return false;
  if (formation.status === "available" && missing.length) return false;
  if (formation.status === "unavailable" && units.length) return false;
  const cells = new Set();
  return units.every((unit) => {
    const cell = unit.cell;
    const position = unit.boardPosition;
    if (!Number.isInteger(cell) || cell < 1 || cell > 28 || cells.has(cell)
      || position?.rowFromFront !== 4 - Math.floor((cell - 1) / 7)
      || position?.columnFromLeft !== ((cell - 1) % 7) + 1) return false;
    cells.add(cell);
    return true;
  });
}

// Presentation-only association of existing current Ledger snapshots. No fetch,
// ranking, Evidence promotion or model-provided binding is performed here.
export function bindCompositionCardDetails(result, rankingEntry, payload, now = Date.now()) {
  const citedIds = new Set(list(payload.evidenceIds));
  const rankingCurrent = citedIds.has(rankingEntry.evidenceId)
    && ["resolved", "unfiltered"].includes(rankingEntry.value?.resolution?.status)
    && currentEntry(rankingEntry, "comps_rankings", now, 30 * 60 * 1000);
  const candidates = list(payload.evidence).filter((entry) => citedIds.has(entry?.evidenceId));
  const attach = (comp) => {
    // Legacy Quick Task / trend rows keep their existing lazy detail path.
    if (!Object.hasOwn(comp, "tacticalDetailQueryPlan")) return comp;
    const plan = comp.tacticalDetailQueryPlan;
    const expectedUnits = list(comp.units).map((unit) => unit.apiName);
    const planValid = rankingCurrent && plan?.schemaVersion === "composition-tactical-detail-query.v1"
      && plan.status === "ready" && plan.seasonContextId === result.query?.seasonContextId
      && plan.compositionId === comp.source?.clusterId && plan.clusterId === comp.source?.dataClusterId
      && sameUnits(list(plan.units), expectedUnits);
    // Prefer the latest matching observation, never a different card's result.
    const matched = planValid ? candidates.findLast((entry) => matchesPlan(entry, plan, now)) : null;
    return { ...comp, tacticalDetail: {
      status: matched ? "ready" : "unavailable",
      evidenceId: matched?.evidenceId ?? null,
      rankingEvidenceId: rankingEntry.evidenceId,
      compositionId: plan?.compositionId ?? null,
      clusterId: plan?.clusterId ?? null,
      seasonContextId: result.query?.seasonContextId ?? null,
      reasonCode: matched ? "matched_current_evidence" : "matching_positioning_unavailable",
      data: matched ? structuredClone(matched.value) : null
    } };
  };
  return { ...result,
    rankings: Object.fromEntries(Object.entries(result.rankings ?? {}).map(([metric, comps]) => [metric, list(comps).map(attach)])),
    references: list(result.references).map(attach)
  };
}

export function hasBoundTacticalEvidence(group, evidenceId) {
  if (typeof evidenceId !== "string" || !evidenceId) return false;
  return Object.values(group.result?.rankings ?? {}).flat().some((comp) => comp.tacticalDetail?.evidenceId === evidenceId);
}
