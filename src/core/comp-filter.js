export const COMP_FILTER_SEMANTICS_VERSION = "metatft-explorer-sf-units-traits-v1";
export const COMP_CANDIDATE_ENDPOINT = "/tft-explorer-api/exact_units_traits2";
export const COMP_FINAL_ENDPOINT = "/tft-explorer-api/unit_builds/{unit}";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(String).map((value) => value.trim()).filter(Boolean))];
}

function sampleCountFromPlacementCounts(value) {
  const counts = asArray(value).map(Number);
  if (counts.length !== 8 || counts.some((count) => !Number.isFinite(count) || count < 0)) return 0;
  return counts.reduce((sum, count) => sum + count, 0);
}

export function parseCompSignature(value) {
  const signature = String(value ?? "").trim();
  const separator = signature.indexOf("|");
  if (separator <= 0 || separator === signature.length - 1) return null;

  const units = uniqueStrings(signature.slice(0, separator).split("&"));
  const traits = uniqueStrings(signature.slice(separator + 1).split("&"));
  if (!units.length || !traits.length) return null;
  if (units.some((unit) => !/^TFT[\w-]+$/i.test(unit))) return null;
  if (traits.some((trait) => !/^TFT[\w-]+_\d+(?:plus|minus)?$/i.test(trait))) return null;

  return {
    id: `${units.join("&")}|${traits.join("&")}`,
    units,
    traits
  };
}

function entityLabel(apiName, catalog, type) {
  const record = type === "unit"
    ? catalog?.unitByApiName?.get?.(apiName)
    : catalog?.traitByApiName?.get?.(apiName);
  return record?.zhName ?? record?.name ?? record?.displayName ?? apiName;
}

function readableCompName(parsed, catalog) {
  const meaningfulTraits = parsed.traits
    .filter((trait) => !/(?:UniqueTrait|RangedTrait|MeleeTrait|HPTank|ResistTank|ShieldTank|ManaTrait|SummonTrait)(?:_|$)/i.test(trait))
    .slice(0, 3)
    .map((trait) => entityLabel(trait, catalog, "trait"));
  if (meaningfulTraits.length) return meaningfulTraits.join(" + ");
  return parsed.units.slice(-3).map((unit) => entityLabel(unit, catalog, "unit")).join(" + ");
}

export function normalizeCompCandidateRows(responseOrRows, options = {}) {
  const rows = Array.isArray(responseOrRows)
    ? responseOrRows
    : asArray(responseOrRows?.data ?? responseOrRows?.results);
  const targetUnit = String(options.unit ?? "");

  return rows
    .map((row) => {
      const parsed = parseCompSignature(row?.units_traits ?? row?.unitsTraits ?? row?.comp);
      if (!parsed) return null;
      const sampleCount = sampleCountFromPlacementCounts(row?.placement_count ?? row?.placementCount);
      return {
        ...parsed,
        name: row?.comp_name ?? row?.compName ?? readableCompName(parsed, options.catalog),
        sampleCount,
        placementCount: asArray(row?.placement_count ?? row?.placementCount).map(Number),
        sourceEndpoint: COMP_CANDIDATE_ENDPOINT,
        semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
      };
    })
    .filter(Boolean)
    .filter((candidate) => !targetUnit || candidate.units.includes(targetUnit))
    .filter((candidate) => candidate.sampleCount > 0);
}

function compareCandidates(a, b) {
  if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
  return a.id.localeCompare(b.id);
}

function normalizedName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s·+/_-]+/g, "");
}

function explicitCandidateFromValue(value, options = {}) {
  const objectValue = value && typeof value === "object" ? value : null;
  const id = objectValue?.id ?? objectValue?.signature ?? (typeof value === "string" ? value : null);
  const parsed = parseCompSignature(id);
  if (!parsed) return null;
  if (options.unit && !parsed.units.includes(options.unit)) return null;
  return {
    ...parsed,
    name: objectValue?.name ?? readableCompName(parsed, options.catalog),
    sampleCount: Number(objectValue?.sampleCount ?? 0),
    placementCount: asArray(objectValue?.placementCount).map(Number),
    sourceEndpoint: objectValue?.sourceEndpoint ?? COMP_CANDIDATE_ENDPOINT,
    semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
  };
}

export function resolveExplicitComp(value, candidates = [], options = {}) {
  const direct = explicitCandidateFromValue(value, options);
  if (direct) return direct;

  const mention = normalizedName(value?.name ?? value);
  if (!mention) return null;
  const matches = candidates.filter((candidate) => {
    const name = normalizedName(candidate.name);
    return name === mention || name.includes(mention) || mention.includes(name);
  });
  return matches.sort(compareCandidates)[0] ?? null;
}

export function selectStableCompCandidate(responseOrRows, options = {}) {
  const candidates = normalizeCompCandidateRows(responseOrRows, options).sort(compareCandidates);
  const stabilityThreshold = Number(options.minSamples ?? 100);
  const stableCandidates = candidates.filter((candidate) => candidate.sampleCount >= stabilityThreshold);
  return {
    candidate: stableCandidates[0] ?? null,
    candidates,
    stableCandidates,
    stabilityThreshold,
    sourceEndpoint: COMP_CANDIDATE_ENDPOINT,
    semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
  };
}

export function createAppliedCompConstraint(candidate, options = {}) {
  const selection = options.selection === "explicit" ? "explicit" : "automatic";
  const source = options.source ?? (selection === "explicit" ? "current_input" : "system_default");
  return {
    value: {
      id: candidate.id,
      name: candidate.name,
      units: [...candidate.units],
      traits: [...candidate.traits],
      sampleCount: Number(candidate.sampleCount ?? 0),
      selection,
      sourceEndpoint: candidate.sourceEndpoint ?? COMP_CANDIDATE_ENDPOINT,
      semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
    },
    source,
    confidence: selection === "explicit" ? 1 : 0.9,
    status: "applied"
  };
}

export function createUnavailableCompConstraint(options = {}) {
  return {
    value: null,
    source: "system_default",
    confidence: 1,
    status: "not_available",
    reason: options.reason ?? "no_stable_candidate",
    stabilityThreshold: Number(options.stabilityThreshold ?? 100),
    sourceEndpoint: options.sourceEndpoint ?? COMP_CANDIDATE_ENDPOINT,
    semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
  };
}

export function compStructuredFilterParams(compConstraint) {
  if (compConstraint?.status !== "applied" || !compConstraint?.value) return {};
  const parsed = parseCompSignature(compConstraint.value.id);
  if (!parsed) return {};

  const filters = [
    ...parsed.units.map((unit) => ({ key: "unit_unique", value: `${unit}-1` })),
    ...parsed.traits.map((trait) => ({ key: "trait", value: trait }))
  ];
  return Object.fromEntries(filters.map((filter, index) => [
    `sf[0][and][${index}][${filter.key}]`,
    filter.value
  ]));
}
