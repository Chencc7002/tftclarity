import { normalizeCompDetailsPositioning } from "../../data/comp-detail-adapter.js";
import {
  FACET_NAMES,
  NORMALIZED_SCHEMA_VERSION,
  NORMALIZER_VERSION,
  assertValid,
  normalizedCompIdentity,
  sha256,
  splitApiNames,
  validateNormalizedProbe,
  validateRawProbePair
} from "./contracts.js";

const AUGMENT_TIER_ORDER = Object.freeze(["S", "A", "B", "C", "D"]);
const EARLY_BOARD_LEVELS = Object.freeze([4, 5, 6, 7]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function observed(data, source, extra = {}) {
  return { status: "observed", data, source, ...extra };
}

function unavailable(reason, source = null) {
  return { status: "not_available", data: [], reason, source };
}

function parseFailed(reason, source = null) {
  return { status: "parse_failed", data: [], reason, source };
}

function facetSource(document, binding) {
  return document ? {
    provider: "MetaTFT",
    endpoint: new URL(document.url).pathname,
    url: document.url,
    responseSha256: document.responseSha256,
    binding
  } : null;
}

function compDefinition(raw) {
  const data = raw.endpoints.compsData.response?.results?.data;
  const definitions = data?.cluster_details;
  if (!isObject(definitions)) return null;
  return definitions[raw.identity.sourceCompId] ?? null;
}

function compStats(raw) {
  const response = raw.endpoints.compsStats.response;
  const rows = Array.isArray(response?.results) ? response.results : [];
  const row = rows.find((entry) => String(entry?.cluster ?? "") === raw.identity.sourceCompId);
  const totalRow = rows.find((entry) => String(entry?.cluster ?? "") === "");
  if (!row || !Array.isArray(row.places) || row.places.length < 8) {
    const failure = new Error(`MetaTFT stats are missing comp ${raw.identity.sourceCompId}`);
    failure.code = "PROBE_COMP_STATS_MISSING";
    throw failure;
  }
  const placements = row.places.slice(0, 8).map(finiteNumber);
  if (placements.some((value) => value === null || value < 0)) {
    const failure = new Error("MetaTFT comp placement counts changed type or range");
    failure.code = "PROBE_STATS_SCHEMA_CHANGED";
    throw failure;
  }
  const games = placements.reduce((sum, value) => sum + value, 0);
  const averagePlacement = games > 0
    ? placements.reduce((sum, value, index) => sum + value * (index + 1), 0) / games
    : null;
  return {
    games,
    averagePlacement,
    placementCounts: placements,
    totalPatchMatches: finiteNumber(totalRow?.places?.[0])
  };
}

function normalizeEarlyBoards(details, source) {
  const raw = details?.early_options;
  if (!isObject(raw)) return parseFailed("missing_or_invalid_early_options", source);
  const data = [];
  for (const level of EARLY_BOARD_LEVELS) {
    const rows = raw[String(level)];
    if (!Array.isArray(rows)) return parseFailed(`missing_or_invalid_early_options_level_${level}`, source);
    const normalized = rows.map((row) => {
      const units = splitApiNames(row?.unit_list, "&");
      const count = finiteNumber(row?.count);
      const averagePlacement = finiteNumber(row?.avg);
      const winRate = finiteNumber(row?.win);
      if (!units.length || count === null || averagePlacement === null || winRate === null) return null;
      return { level, units, count, averagePlacement, winRate };
    });
    if (normalized.some((row) => row === null)) {
      return parseFailed(`invalid_early_options_row_level_${level}`, source);
    }
    data.push(...normalized
      .sort((left, right) => right.count - left.count || left.units.join("&").localeCompare(right.units.join("&")))
      .slice(0, 2));
  }
  return data.length ? observed(data, source, { selection: "top_2_by_observed_count_per_level" }) : unavailable("empty_early_options", source);
}

function normalizeLeveling(details, source) {
  if (!Array.isArray(details?.levels)) return parseFailed("missing_or_invalid_levels", source);
  const data = details.levels.map((row) => {
    const level = integer(row?.level);
    const count = finiteNumber(row?.count);
    const stage = String(row?.stage ?? "").trim() || null;
    const round = String(row?.round ?? "").trim() || null;
    if (level === null || count === null || count < 0) return null;
    return { level, stage, round, count };
  });
  if (data.some((row) => row === null)) return parseFailed("invalid_leveling_row", source);
  return data.length ? observed(data, source, { semantics: "observed_level_reach_timing" }) : unavailable("empty_levels", source);
}

function normalizeReroll(details, source) {
  if (!isObject(details?.rerolls)) return parseFailed("missing_or_invalid_rerolls", source);
  const excludedSourceKeys = [];
  const data = [];
  for (const [key, row] of Object.entries(details.rerolls)) {
    const level = integer(key);
    if (level === null || level < 2 || level > 10) {
      excludedSourceKeys.push(key);
      continue;
    }
    const rerolls = finiteNumber(row?.rerolls);
    const matches = finiteNumber(row?.matches);
    const count = finiteNumber(row?.count);
    if (rerolls === null || matches === null || count === null || rerolls < 0 || matches < 0 || count < 0) {
      return parseFailed(`invalid_reroll_row_level_${key}`, source);
    }
    data.push({
      level,
      rerolls,
      matches,
      count,
      rerollsPerObservedMatch: matches > 0 ? rerolls / matches : null
    });
  }
  data.sort((left, right) => left.level - right.level);
  return data.length
    ? observed(data, source, { semantics: "observed_reroll_distribution", excludedSourceKeys: excludedSourceKeys.sort() })
    : unavailable("empty_rerolls", source);
}

function normalizeFirstCarouselComponents(details, source) {
  if (!Array.isArray(details?.first_carousel)) return parseFailed("missing_or_invalid_first_carousel", source);
  const parsed = details.first_carousel.map((row) => {
    const apiName = String(row?.items ?? "").trim();
    const count = finiteNumber(row?.count);
    const averagePlacement = finiteNumber(row?.avg);
    if (!apiName || count === null || averagePlacement === null || count < 0) return null;
    return { apiName, count, averagePlacement };
  });
  if (parsed.some((row) => row === null)) return parseFailed("invalid_first_carousel_row", source);
  const totalObservedCount = parsed.reduce((sum, row) => sum + row.count, 0);
  const data = parsed.map((row) => ({
    ...row,
    observedFrequency: totalObservedCount > 0 ? row.count / totalObservedCount : 0
  }));
  data.sort((left, right) => right.count - left.count || left.averagePlacement - right.averagePlacement || left.apiName.localeCompare(right.apiName));
  return data.length
    ? observed(data, source, { semantics: "observed_frequency", totalObservedCount })
    : unavailable("empty_first_carousel", source);
}

function normalizeAugments(response, compId, source) {
  const rows = response?.results?.[compId]?.augments;
  if (!Array.isArray(rows)) return parseFailed("missing_or_invalid_comp_augment_tiers", source);
  const seen = new Set();
  const data = [];
  for (const row of rows) {
    const apiName = String(row?.id ?? "").trim();
    const tier = String(row?.tier ?? "").trim().toUpperCase();
    if (!apiName || !AUGMENT_TIER_ORDER.includes(tier)) return parseFailed("invalid_comp_augment_tier_row", source);
    if (seen.has(apiName)) continue;
    seen.add(apiName);
    data.push({ apiName, tier });
  }
  data.sort((left, right) => AUGMENT_TIER_ORDER.indexOf(left.tier) - AUGMENT_TIER_ORDER.indexOf(right.tier) || left.apiName.localeCompare(right.apiName));
  return data.length ? observed(data, source, {
    semantics: "source_recommendation",
    sourceClaim: "observed_comp_compatibility_tier"
  }) : unavailable("empty_comp_augment_tiers", source);
}

function normalizePositioning(detailsResponse, raw, source) {
  const result = normalizeCompDetailsPositioning(detailsResponse, raw.identity.units, {
    compId: raw.identity.sourceCompId,
    clusterId: raw.identity.sourceClusterId
  });
  if (result.status === "unavailable") {
    return unavailable(result.reasons.map((reason) => reason.code).join(",") || "positioning_unavailable", source);
  }
  return observed(result.units.map((unit) => ({
    apiName: unit.apiName,
    cell: unit.cell,
    cellKey: unit.cellKey,
    observedCount: unit.count
  })), source, {
    partial: result.status === "partial",
    missingUnitApiNames: result.missingUnitApiNames,
    reasons: result.reasons
  });
}

function currentFacets(raw) {
  const detailsDocument = raw.endpoints.compDetails;
  const augmentsDocument = raw.endpoints.compAugmentTiers;
  const detailsResponse = detailsDocument?.response;
  const details = detailsResponse?.results;
  const detailsSource = facetSource(detailsDocument, "current_unversioned");
  const augmentsSource = facetSource(augmentsDocument, "current_unversioned");
  if (!isObject(details) || String(details.cluster ?? "") !== raw.identity.sourceCompId) {
    return Object.fromEntries(FACET_NAMES.map((name) => [name, parseFailed("missing_or_mismatched_comp_details", detailsSource)]));
  }
  return {
    earlyBoards: normalizeEarlyBoards(details, detailsSource),
    leveling: normalizeLeveling(details, detailsSource),
    reroll: normalizeReroll(details, detailsSource),
    firstCarouselComponents: normalizeFirstCarouselComponents(details, detailsSource),
    recommendedAugments: normalizeAugments(augmentsDocument?.response, raw.identity.sourceCompId, augmentsSource),
    positioning: normalizePositioning(detailsResponse, raw, detailsSource)
  };
}

function previousFacets(raw) {
  const reason = "source_endpoint_not_patch_bound";
  return Object.fromEntries(FACET_NAMES.map((name) => [name, unavailable(reason, {
    provider: "MetaTFT",
    binding: "unavailable_for_requested_patch",
    currentCanonicalResponseSha256: name === "recommendedAugments"
      ? raw.bindingProbes.compAugmentTiers.canonicalResponseSha256
      : raw.bindingProbes.compDetails.canonicalResponseSha256
  })]));
}

function buildEntityMappings(facets, assetManifest) {
  const catalog = new Map((assetManifest?.assets ?? []).map((asset) => [
    `${asset.entityType}:${asset.apiName}`,
    asset
  ]));
  const references = [];
  const add = (entityType, apiName) => {
    if (typeof apiName === "string" && apiName) references.push({ entityType, apiName });
  };
  for (const board of facets.earlyBoards.data) for (const apiName of board.units ?? []) add("unit", apiName);
  for (const row of facets.firstCarouselComponents.data) add("item", row.apiName);
  for (const row of facets.recommendedAugments.data) add("augment", row.apiName);
  for (const row of facets.positioning.data) add("unit", row.apiName);

  const unique = new Map(references.map((reference) => [`${reference.entityType}:${reference.apiName}`, reference]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, reference]) => {
    const asset = catalog.get(key);
    return {
      entityType: reference.entityType,
      providerRef: {
        provider: "MetaTFT",
        apiName: reference.apiName
      },
      canonicalId: asset ? asset.apiName : null,
      status: asset ? "resolved" : "explicitly_unmapped",
      guessed: false,
      source: asset ? {
        catalog: "src/data/generated/asset-manifest.json",
        source: asset.source ?? null,
        sourcePatch: asset.sourcePatch ?? null
      } : {
        catalog: "src/data/generated/asset-manifest.json",
        reason: "exact_api_name_not_present"
      }
    };
  });
}

function normalizedFixture(raw, assetManifest, pairVerification) {
  const definition = compDefinition(raw);
  if (!definition) {
    const failure = new Error(`MetaTFT comps_data is missing definition ${raw.identity.sourceCompId}`);
    failure.code = "PROBE_COMP_DEFINITION_MISSING";
    throw failure;
  }
  const stats = compStats(raw);
  const guideBinding = raw.patch.role === "current" ? "current_unversioned" : "unavailable_for_requested_patch";
  const facets = Object.fromEntries(Object.entries(
    raw.patch.role === "current" ? currentFacets(raw) : previousFacets(raw)
  ).map(([name, facet]) => [name, { binding: guideBinding, ...facet }]));
  const patchResponse = raw.endpoints.patchDiscovery.response;
  const identity = normalizedCompIdentity({
    tftSet: raw.source.tftSet,
    queue: raw.source.queue,
    sourceCompId: raw.identity.sourceCompId,
    sourceClusterId: raw.identity.sourceClusterId,
    units: raw.identity.units,
    traits: raw.identity.traits
  });
  const normalized = {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    capturedAt: raw.capturedAt,
    identity,
    statistics: {
      binding: "patch",
      patch: raw.patch.label,
      bPatch: raw.patch.bPatch,
      patchRole: raw.patch.role,
      status: "observed",
      games: stats.games,
      averagePlacement: stats.averagePlacement,
      placementCounts: stats.placementCounts,
      source: facetSource(raw.endpoints.compsStats, raw.patch.role === "current" ? "current_patch_pointer" : "explicit_patch_query"),
      verification: {
        status: "verified",
        mechanism: raw.patch.role === "current" ? "current_patch_pointer" : "comps_stats_patch_query",
        patchDiscovery: {
          patch: String(patchResponse.patch ?? ""),
          bPatch: String(patchResponse.b_patch_version ?? ""),
          start: patchResponse.start ?? null
        },
        statsRequestUrl: raw.endpoints.compsStats.url,
        statsResponseSha256: raw.endpoints.compsStats.responseSha256,
        totalPatchMatches: stats.totalPatchMatches,
        pairEvidenceSha256: pairVerification.evidenceSha256
      }
    },
    guide: {
      binding: guideBinding,
      observedDuringPatch: raw.patch.role === "current" ? raw.patch.label : null,
      facets
    },
    entityMappings: buildEntityMappings(facets, assetManifest),
    sourceMetadata: {
      provider: "MetaTFT",
      pageUrl: raw.source.pageUrl,
      queue: raw.source.queue,
      tftSet: raw.source.tftSet,
      rawSchemaVersion: raw.schemaVersion,
      normalizerVersion: NORMALIZER_VERSION,
      rawIdentity: {
        stableCompId: raw.identity.stableCompId,
        signatureVersion: raw.identity.signatureVersion
      },
      nameTokens: Array.isArray(definition.name) ? definition.name.map((entry) => String(entry?.name ?? "")).filter(Boolean) : []
    },
    safety: {
      crossPatchDetailReuse: false,
      guessedEntityMappings: 0,
      answerReady: false,
      probeOnly: true
    }
  };
  assertValid(validateNormalizedProbe(normalized), "normalized MetaTFT comp guide probe is invalid");
  return normalized;
}

export function normalizeCompGuideProbePair(rawFixtures, assetManifest = { assets: [] }) {
  assertValid(validateRawProbePair(rawFixtures), "raw MetaTFT comp guide probe pair is invalid");
  const current = rawFixtures.find((raw) => raw.patch.role === "current");
  const previous = rawFixtures.find((raw) => raw.patch.role === "previous");
  const pairVerification = {
    currentPatch: current.patch.label,
    previousPatch: previous.patch.label,
    stableCompId: current.identity.stableCompId,
    statsResponsesDistinct: true,
    detailsPatchBound: false,
    augmentsPatchBound: false,
    crossPatchContamination: 0
  };
  pairVerification.evidenceSha256 = sha256(pairVerification);
  return [current, previous].map((raw) => normalizedFixture(raw, assetManifest, pairVerification));
}

export function probePairSummary(normalizedFixtures) {
  return normalizedFixtures.map((fixture) => ({
    patch: fixture.statistics.patch,
    role: fixture.statistics.patchRole,
    compId: fixture.identity.compId,
    games: fixture.statistics.games,
    guideBinding: fixture.guide.binding,
    facets: Object.fromEntries(FACET_NAMES.map((name) => [name, fixture.guide.facets[name].status])),
    resolvedEntities: fixture.entityMappings.filter((entry) => entry.status === "resolved").length,
    explicitlyUnmappedEntities: fixture.entityMappings.filter((entry) => entry.status === "explicitly_unmapped").length
  }));
}
