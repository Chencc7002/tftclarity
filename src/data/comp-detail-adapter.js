const POSITIONING_MIN_CELL = 1;
const POSITIONING_MAX_CELL = 28;

export const AUGMENT_TIER_ORDER = Object.freeze(["S", "A", "B", "C", "D"]);

export const COMP_DETAIL_ENDPOINT = "/tft-comps-api/comp_details";
export const COMP_AUGMENT_TIERS_ENDPOINT = "/tft-comps-api/comp_augment_tiers";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nullableString(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = String(value).trim();
  return normalized || null;
}

function parseCell(value) {
  let parsed = null;

  if (typeof value === "number" && Number.isInteger(value)) {
    parsed = value;
  } else if (typeof value === "string") {
    const normalized = value.trim();
    const cellMatch = /^cell_(\d+)$/i.exec(normalized);
    const numericValue = cellMatch ? cellMatch[1] : normalized;

    if (/^\d+$/.test(numericValue)) {
      parsed = Number(numericValue);
    }
  }

  return parsed >= POSITIONING_MIN_CELL && parsed <= POSITIONING_MAX_CELL
    ? parsed
    : null;
}

function parseCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeFinalUnitApiNames(finalUnits) {
  const seen = new Set();
  const apiNames = [];

  for (const unit of asArray(finalUnits)) {
    const apiName = nullableString(
      typeof unit === "string" ? unit : unit?.apiName ?? unit?.api_name ?? unit?.id,
    );

    if (!apiName || seen.has(apiName)) continue;
    seen.add(apiName);
    apiNames.push(apiName);
  }

  return apiNames;
}

function buildSource({ endpoint, response, compId, clusterId }) {
  const root = asObject(response) ?? {};
  const results = asObject(root.results) ?? {};

  return {
    provider: "MetaTFT",
    endpoint,
    compId: nullableString(compId ?? root.compId ?? root.comp_id ?? results.compId ?? results.comp_id),
    clusterId: nullableString(
      clusterId ?? root.clusterId ?? root.cluster_id ?? results.clusterId ?? results.cluster_id,
    ),
  };
}

function positionCandidatesForUnit(rawUnitPositioning) {
  const byCell = new Map();
  const positions = asArray(rawUnitPositioning?.positions);

  for (const rawPosition of positions) {
    const cell = parseCell(rawPosition?.cell);
    const count = parseCount(rawPosition?.count);

    if (cell === null || count === null) continue;

    const existing = byCell.get(cell);
    if (!existing || count > existing.count) {
      byCell.set(cell, { cell, count });
    }
  }

  return [...byCell.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.cell - right.cell;
  });
}

function addFlowEdge(graph, from, to, cost, metadata = null) {
  const forward = {
    to,
    reverseIndex: graph[to].length,
    capacity: 1,
    cost,
    metadata
  };
  const backward = {
    to: from,
    reverseIndex: graph[from].length,
    capacity: 0,
    cost: -cost,
    metadata: null
  };
  graph[from].push(forward);
  graph[to].push(backward);
  return forward;
}

function shortestAugmentingPath(graph, source, sink) {
  const distance = Array(graph.length).fill(Infinity);
  const previous = Array(graph.length).fill(null);
  distance[source] = 0;

  for (let pass = 0; pass < graph.length - 1; pass += 1) {
    let changed = false;
    for (let from = 0; from < graph.length; from += 1) {
      if (!Number.isFinite(distance[from])) continue;
      for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex += 1) {
        const edge = graph[from][edgeIndex];
        if (edge.capacity <= 0) continue;
        const candidateDistance = distance[from] + edge.cost;
        if (candidateDistance >= distance[edge.to]) continue;
        distance[edge.to] = candidateDistance;
        previous[edge.to] = { from, edgeIndex };
        changed = true;
      }
    }
    if (!changed) break;
  }

  return previous[sink] ? previous : null;
}

function selectObservedPositions(candidateGroups) {
  const cells = [...new Set(candidateGroups.flatMap((group) => group.candidates.map((candidate) => candidate.cell)))];
  if (cells.length === 0) return new Map();

  const source = 0;
  const unitOffset = 1;
  const cellOffset = unitOffset + candidateGroups.length;
  const sink = cellOffset + cells.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const cellNodeByCell = new Map(cells.map((cell, index) => [cell, cellOffset + index]));
  const candidateEdges = [];

  candidateGroups.forEach((group, unitIndex) => {
    const unitNode = unitOffset + unitIndex;
    addFlowEdge(graph, source, unitNode, 0);
    group.candidates.forEach((candidate) => {
      const edge = addFlowEdge(graph, unitNode, cellNodeByCell.get(candidate.cell), -candidate.count, {
        unitIndex,
        candidate
      });
      candidateEdges.push({ unitIndex, candidate, edge });
    });
  });
  for (const cell of cells) addFlowEdge(graph, cellNodeByCell.get(cell), sink, 0);

  while (true) {
    const previous = shortestAugmentingPath(graph, source, sink);
    if (!previous) break;
    for (let node = sink; node !== source;) {
      const { from, edgeIndex } = previous[node];
      const edge = graph[from][edgeIndex];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
      node = from;
    }
  }

  const selected = new Map();
  for (const { unitIndex, candidate, edge } of candidateEdges) {
    if (edge.capacity === 0) selected.set(unitIndex, candidate);
  }
  return selected;
}

function unavailablePositioning({ source, code, apiName = null }) {
  return {
    status: "unavailable",
    units: [],
    missingUnitApiNames: apiName ? [apiName] : [],
    reasons: [{ code, ...(apiName ? { apiName } : {}) }],
    source,
  };
}

/**
 * Normalizes the observed MetaTFT comp-details positioning for a known final
 * roster. This function never creates a position that the source did not
 * provide: a unit without an available observed cell remains unpositioned.
 *
 * @param {unknown} response MetaTFT comp_details response body.
 * @param {unknown[]} finalUnits Final roster unit API names, or objects with
 *   an apiName/api_name/id field.
 * @param {{ compId?: string, clusterId?: string }} [options]
 * @returns {{
 *   status: "available" | "partial" | "unavailable",
 *   units: Array<{ apiName: string, cell: number, cellKey: string, count: number }>,
 *   missingUnitApiNames: string[],
 *   reasons: Array<{ code: string, apiName?: string }>,
 *   source: { provider: string, endpoint: string, compId: string | null, clusterId: string | null }
 * }}
 */
export function normalizeCompDetailsPositioning(response, finalUnits, options = {}) {
  const source = buildSource({
    endpoint: COMP_DETAIL_ENDPOINT,
    response,
    compId: options.compId,
    clusterId: options.clusterId,
  });
  const finalUnitApiNames = normalizeFinalUnitApiNames(finalUnits);

  if (finalUnitApiNames.length === 0) {
    return unavailablePositioning({ source, code: "missing_final_units" });
  }

  const rawUnits = asObject(asObject(response)?.results?.positioning?.units);
  if (!rawUnits) {
    return unavailablePositioning({ source, code: "missing_positioning_units" });
  }

  const candidateGroups = [];
  const candidatesByUnitIndex = new Map();
  const reasons = [];
  const missingUnitApiNames = [];

  finalUnitApiNames.forEach((apiName, unitIndex) => {
    const rawUnitPositioning = asObject(rawUnits[apiName]);

    if (!rawUnitPositioning) {
      candidatesByUnitIndex.set(unitIndex, { apiName, candidates: [], reason: "missing_unit_positioning" });
      return;
    }

    const candidates = positionCandidatesForUnit(rawUnitPositioning);
    if (candidates.length === 0) {
      candidatesByUnitIndex.set(unitIndex, { apiName, candidates: [], reason: "no_valid_position" });
      return;
    }

    const group = { apiName, candidates, unitIndex };
    candidateGroups.push(group);
    candidatesByUnitIndex.set(unitIndex, group);
  });

  const selectionByCandidateGroupIndex = selectObservedPositions(candidateGroups);
  const units = [];
  finalUnitApiNames.forEach((apiName, unitIndex) => {
    const group = candidatesByUnitIndex.get(unitIndex);
    const groupIndex = candidateGroups.indexOf(group);
    const selected = groupIndex >= 0 ? selectionByCandidateGroupIndex.get(groupIndex) : null;
    if (!selected) {
      missingUnitApiNames.push(apiName);
      reasons.push({ code: group?.reason ?? "all_valid_cells_conflict", apiName });
      return;
    }
    units.push({
      apiName,
      cell: selected.cell,
      cellKey: `cell_${selected.cell}`,
      count: selected.count,
    });
  });

  return {
    status:
      units.length === 0
        ? "unavailable"
        : missingUnitApiNames.length > 0
          ? "partial"
          : "available",
    units,
    missingUnitApiNames,
    reasons,
    source,
  };
}

function normalizeAugmentCap(value) {
  if (value === undefined || value === null) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeTier(value) {
  const tier = nullableString(value)?.toUpperCase() ?? null;
  return AUGMENT_TIER_ORDER.includes(tier) ? tier : null;
}

function unavailableAugments({ source, code }) {
  return {
    status: "unavailable",
    augments: [],
    totalAugments: 0,
    truncated: false,
    reasons: [{ code }],
    source,
  };
}

/**
 * Normalizes one comp's MetaTFT augment-tier data. Entries are returned in
 * S-to-D order and can be capped without changing the source-derived rank.
 *
 * @param {unknown} response MetaTFT comp_augment_tiers response body.
 * @param {string} compId MetaTFT comp id.
 * @param {{ clusterId?: string, cap?: number }} [options]
 * @returns {{
 *   status: "available" | "unavailable",
 *   augments: Array<{ apiName: string, tier: "S" | "A" | "B" | "C" | "D" }>,
 *   totalAugments: number,
 *   truncated: boolean,
 *   reasons: Array<{ code: string }>,
 *   source: { provider: string, endpoint: string, compId: string | null, clusterId: string | null }
 * }}
 */
export function normalizeCompAugmentTiers(response, compId, options = {}) {
  const normalizedCompId = nullableString(compId);
  const source = buildSource({
    endpoint: COMP_AUGMENT_TIERS_ENDPOINT,
    response,
    compId: normalizedCompId,
    clusterId: options.clusterId,
  });

  if (!normalizedCompId) {
    return unavailableAugments({ source, code: "missing_comp_id" });
  }

  const rawAugments = asArray(asObject(asObject(response)?.results)?.[normalizedCompId]?.augments);
  if (rawAugments.length === 0) {
    return unavailableAugments({ source, code: "missing_comp_augment_tiers" });
  }

  const byApiName = new Map();

  rawAugments.forEach((rawAugment, sourceIndex) => {
    const apiName = nullableString(rawAugment?.id ?? rawAugment?.apiName ?? rawAugment?.api_name);
    const tier = normalizeTier(rawAugment?.tier);
    if (!apiName || !tier) return;

    const normalized = { apiName, tier, sourceIndex };
    const existing = byApiName.get(apiName);
    const existingTierIndex = existing ? AUGMENT_TIER_ORDER.indexOf(existing.tier) : Infinity;
    const tierIndex = AUGMENT_TIER_ORDER.indexOf(tier);

    if (!existing || tierIndex < existingTierIndex) {
      byApiName.set(apiName, normalized);
    }
  });

  const sortedAugments = [...byApiName.values()]
    .sort((left, right) => {
      const tierDifference =
        AUGMENT_TIER_ORDER.indexOf(left.tier) - AUGMENT_TIER_ORDER.indexOf(right.tier);
      if (tierDifference !== 0) return tierDifference;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ apiName, tier }) => ({ apiName, tier }));

  if (sortedAugments.length === 0) {
    return unavailableAugments({ source, code: "no_valid_augment_tiers" });
  }

  const cap = normalizeAugmentCap(options.cap);
  const augments = cap === null ? sortedAugments : sortedAugments.slice(0, cap);

  return {
    status: "available",
    augments,
    totalAugments: sortedAugments.length,
    truncated: augments.length < sortedAugments.length,
    reasons: [],
    source,
  };
}
