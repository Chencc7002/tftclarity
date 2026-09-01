import { bindCompositionCardDetails } from "./composition-card-details.js";

const COMPOSITION_RESULT_TYPES = new Set([
  "comp_trends", "comp_rankings", "composition_rankings"
]);

// Presentation only: keep each tool's scope, ordering and source intact. Never
// combine statistics across queries or promote historical Bridge evidence.
export function collectCompositionResultGroups(payload, normalizeRankings) {
  const scoped = payload.compositionCardScope === true;
  const citedIds = new Set([...(payload.evidenceIds ?? []), ...(scoped ? payload.cardEvidenceIds ?? [] : [])]);
  const cardPayload = scoped ? { ...payload, evidenceIds: [...citedIds] } : payload;
  const groups = new Map();
  for (const entry of payload.evidence ?? []) {
    if (!entry?.evidenceId || !COMPOSITION_RESULT_TYPES.has(entry.value?.type)) continue;
    if (entry.temporalStatus === "historical" || entry.metadata?.temporalStatus === "historical") continue;
    if ((scoped || citedIds.size) && !citedIds.has(entry.evidenceId)) continue;
    const result = entry.value.type === "composition_rankings"
      ? normalizeRankings(entry.value)
      : entry.value;
    groups.set(entry.evidenceId, { evidenceId: entry.evidenceId, result: bindCompositionCardDetails(result, entry, cardPayload) });
  }
  const values = [...groups.values()];
  return scoped ? removeResolutionCopies(values, payload.evidence ?? []) : values;
}

const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const scope = (value) => stable(Object.fromEntries(Object.entries(value.query ?? {})
  .filter(([key]) => !["unit", "limit"].includes(key))));
const rowFacts = (row) => stable([row.compositionRef, row.members, row.traits, row.stats, row.source, row.lowSample]);

// Remove only a one-row identity-resolution copy of a retained candidate list.
// Never merge rows, modify order, or mix statistics from different snapshots.
function removeResolutionCopies(groups, entries) {
  const byId = new Map(entries.map(entry => [entry.evidenceId, entry.value]));
  return groups.filter(group => {
    const child = byId.get(group.evidenceId);
    if (child?.type !== "composition_rankings" || child.resolution?.status !== "resolved" || child.results?.length !== 1) return true;
    const row = child.results[0];
    return !groups.some(parentGroup => {
      const parent = byId.get(parentGroup.evidenceId);
      return parent?.type === "composition_rankings" && parent.resolution?.status === "unfiltered"
        && scope(parent) === scope(child) && stable(parent.source) === stable(child.source)
        && parent.results?.some(candidate => candidate.tacticalDetailQueryPlan?.resolutionPrerequisite?.tool === "comps_rankings"
          && candidate.tacticalDetailQueryPlan.resolutionPrerequisite.arguments?.mention === child.resolution.mention
          && rowFacts(candidate) === rowFacts(row));
    });
  });
}
