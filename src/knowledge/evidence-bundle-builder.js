export const EVIDENCE_BUNDLE_SCHEMA_VERSION = "evidence_bundle.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stats(value = {}) {
  return {
    games: finite(value.games ?? value.sampleSize),
    avgPlacement: finite(value.avgPlacement ?? value.avg),
    top4Rate: finite(value.top4Rate ?? (
      Number.isFinite(Number(value.top4)) ? Number(value.top4) / 100 : null
    )),
    winRate: finite(value.winRate ?? (
      Number.isFinite(Number(value.win)) ? Number(value.win) / 100 : null
    )),
    avgPlacementChange: finite(value.avgPlacementChange),
    emergenceScore: finite(value.emergenceScore)
  };
}

function itemName(value) {
  return String(value?.name ?? value?.apiName ?? value ?? "");
}

function buildCandidates(result = {}) {
  return array(result.rankedBuilds).map((record, index) => ({
      evidenceId: String(record.evidenceId ?? `stats:build:${index + 1}`),
      resultType: "item_build",
      items: array(record.items).map(itemName),
      stats: stats(record.stats),
      riskFlags: [
        ...(record.lowSample ? ["low_sample"] : []),
        ...array(record.riskFlags)
      ]
    }));
}

function itemRankingCandidates(result = {}) {
  return array(result.itemRankings).map((record, index) => ({
      evidenceId: String(record.evidenceId ?? `stats:item:${index + 1}`),
      resultType: "item_ranking",
      item: itemName(record),
      stats: stats(record.stats),
      riskFlags: [
        ...(record.lowSample ? ["low_sample"] : []),
        ...array(record.riskFlags)
      ]
    }));
}

function trendCandidates(result = {}) {
  const seen = new Set();
  const trends = [
    ...array(result.rising),
    ...array(result.improving),
    ...array(result.falling)
  ].filter((record) => {
    const key = String(record?.evidenceId ?? record?.id ?? record?.name ?? record?.compName ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return trends.map((record, index) => ({
      evidenceId: String(record.evidenceId ?? `stats:trend:${index + 1}`),
      resultType: "comp_trend",
      name: String(record.name ?? record.compName ?? record.id ?? `comp-${index + 1}`),
      stats: stats({
        ...(record.stats ?? {}),
        ...(record.trend ?? {})
      }),
      trendDirection: record.trend?.direction ?? (
        record.trend?.improving ? "rising" : "falling"
      ),
      riskFlags: [
        ...(record.lowSample ? ["low_sample"] : []),
        ...array(record.riskFlags)
      ]
    }));
}

function compRankingCandidates(result = {}) {
  const rankings = Object.values(result.rankings ?? {}).find((values) => array(values).length) ?? [];
  return array(rankings).map((record, index) => ({
    evidenceId: String(record.evidenceId ?? `stats:comp:${index + 1}`),
    resultType: "comp_ranking",
    name: String(record.name ?? record.compName ?? record.id ?? `comp-${index + 1}`),
    stats: stats(record.stats),
    riskFlags: [
      ...(record.lowSample ? ["low_sample"] : []),
      ...array(record.riskFlags)
    ]
  }));
}

function itemCarrierCandidates(result = {}) {
  return array(result.carriers).map((record, index) => ({
    evidenceId: String(record.evidenceId ?? `stats:carrier:${index + 1}`),
    resultType: "item_carrier",
    name: String(
      record.name
      ?? record.unitName
      ?? record.unitApiName
      ?? record.unit?.name
      ?? record.unit?.apiName
      ?? `unit-${index + 1}`
    ),
    stats: stats(record.stats),
    placementUplift: finite(record.placementUplift),
    riskFlags: [
      ...(record.lowSample ? ["low_sample"] : []),
      ...array(record.riskFlags)
    ]
  }));
}

function genericCandidates(result = {}) {
  if (array(result.rankedBuilds).length) return buildCandidates(result);
  if (array(result.itemRankings).length) return itemRankingCandidates(result);
  if (array(result.carriers).length) return itemCarrierCandidates(result);
  return compRankingCandidates(result);
}

export const STRUCTURED_RESULT_CANDIDATE_ADAPTERS = Object.freeze({
  unit_build_rankings: buildCandidates,
  unit_build_completion: buildCandidates,
  unit_best_3_items: buildCandidates,
  unit_item_rankings: itemRankingCandidates,
  unit_item_comparison: itemRankingCandidates,
  unit_item_availability: itemRankingCandidates,
  unit_emblem_rankings: itemRankingCandidates,
  item_carrier_rankings: itemCarrierCandidates,
  comp_rankings: compRankingCandidates,
  comp_trends: trendCandidates,
  comp_analysis: compRankingCandidates
});

export function structuredResultCandidates(result = {}) {
  const adapter = STRUCTURED_RESULT_CANDIDATE_ADAPTERS[String(result?.type ?? "")];
  return (adapter ?? genericCandidates)(result);
}

export function createEvidenceBundle(value = {}) {
  const candidates = array(value.structuredEvidence ?? structuredResultCandidates(value.structuredResult));
  const knowledgeEvidence = array(value.knowledgeEvidence);
  return {
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    mode: value.mode ?? "structured",
    query: value.query ?? value.structuredResult?.query ?? {},
    queryResult: value.queryResult ?? {
      resultType: value.structuredResult?.type ?? null,
      generatedAt: value.structuredResult?.source?.updatedAt ?? new Date().toISOString(),
      source: value.structuredResult?.source?.provider ?? (
        candidates.length ? "metatft" : null
      ),
      candidates
    },
    knowledgeEvidence,
    authorityRules: {
      currentBestAuthority: "metatft",
      structuredEvidenceHasPriority: true,
      creatorAdviceMayOverrideStatistics: false,
      creatorAdviceMustRemainConditional: true
    },
    warnings: [...new Set(array(value.warnings).map(String))]
  };
}

export function validateEvidenceBundle(bundle) {
  const errors = [];
  if (bundle?.schemaVersion !== EVIDENCE_BUNDLE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${EVIDENCE_BUNDLE_SCHEMA_VERSION}`);
  }
  if (!["structured", "rag", "hybrid"].includes(bundle?.mode)) errors.push("mode is invalid");
  if (!Array.isArray(bundle?.queryResult?.candidates)) errors.push("queryResult.candidates must be an array");
  if (!Array.isArray(bundle?.knowledgeEvidence)) errors.push("knowledgeEvidence must be an array");
  if (bundle?.authorityRules?.currentBestAuthority !== "metatft") {
    errors.push("currentBestAuthority must be metatft");
  }
  return { valid: errors.length === 0, errors, value: errors.length ? null : bundle };
}

export function buildEvidenceBundle(value = {}) {
  const bundle = createEvidenceBundle(value);
  const validation = validateEvidenceBundle(bundle);
  if (!validation.valid) throw new TypeError(`Invalid EvidenceBundle: ${validation.errors.join("; ")}`);
  return bundle;
}
