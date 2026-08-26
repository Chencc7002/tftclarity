const COMPOSITION_RESULT_TYPES = new Set([
  "comp_trends", "comp_rankings", "composition_rankings"
]);

// Presentation only: keep each tool's scope, ordering and source intact. Never
// combine statistics across queries or promote historical Bridge evidence.
export function collectCompositionResultGroups(payload, normalizeRankings) {
  const citedIds = new Set(payload.evidenceIds ?? []);
  const groups = new Map();
  for (const entry of payload.evidence ?? []) {
    if (!entry?.evidenceId || !COMPOSITION_RESULT_TYPES.has(entry.value?.type)) continue;
    if (entry.temporalStatus === "historical" || entry.metadata?.temporalStatus === "historical") continue;
    if (citedIds.size && !citedIds.has(entry.evidenceId)) continue;
    const result = entry.value.type === "composition_rankings"
      ? normalizeRankings(entry.value)
      : entry.value;
    groups.set(entry.evidenceId, { evidenceId: entry.evidenceId, result });
  }
  return [...groups.values()];
}
