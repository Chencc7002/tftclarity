import { buildConclusionEvidence } from "../llm/conclusion-evidence.js";
import { EVIDENCE_PACK_SCHEMA_VERSION, createEvidencePack } from "./contracts.js";

export const DEFAULT_EVIDENCE_MAX_ITEMS = 40;
export const DEFAULT_EVIDENCE_MAX_CHARACTERS = 16000;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clipped(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\b(?:https?|wss?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|authorization)\s*[:=]\s*\S+)/giu, "[redacted-secret]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/gu, "[redacted-path]")
    .trim()
    .slice(0, limit);
}

function sourceMetadata(result, evidence) {
  const source = result?.source ?? {};
  const query = result?.query ?? {};
  return {
    provider: clipped(source.provider ?? evidence?.dataStatus?.provider ?? "MetaTFT", 60),
    patch: source.patch ?? query.patch ?? evidence?.dataStatus?.patch ?? null,
    cluster: source.cluster ?? source.clusterId ?? result?.clusterId ?? null,
    updatedAt: source.updatedAt ?? result?.sourceUpdatedAt ?? evidence?.dataStatus?.updatedAt ?? null,
    filters: {
      days: query.days ?? null,
      rankFilter: array(query.rankFilter).map(String),
      minSamples: Number.isFinite(Number(query.minSamples)) ? Number(query.minSamples) : null,
      queue: query.queue ?? null
    },
    cache: evidence?.dataStatus?.cache ?? source.cache ?? null
  };
}

function decorateStructured(record, metadata) {
  return {
    ...record,
    evidenceId: String(record.evidenceId),
    visible: true,
    authority: "primary_statistics",
    source: metadata.provider,
    patch: metadata.patch,
    cluster: metadata.cluster,
    updatedAt: metadata.updatedAt,
    filters: metadata.filters,
    cacheStatus: metadata.cache
  };
}

function normalizeSemantic(record, index) {
  const evidenceId = clipped(record?.evidenceId ?? record?.id ?? `semantic:${index + 1}`, 160);
  const source = clipped(record?.source ?? record?.metadata?.source ?? "semantic_index", 80);
  return {
    evidenceId,
    type: clipped(record?.documentType ?? record?.type ?? "static_description", 80),
    text: clipped(record?.text ?? record?.content ?? record?.metadata?.content ?? "", 1400),
    authority: /official|tencent/iu.test(source) ? "official_static_catalog" : "semantic_context",
    source,
    patch: record?.patch ?? record?.metadata?.patch ?? null,
    locale: record?.locale ?? record?.metadata?.locale ?? null,
    visible: Boolean(record?.visible ?? record?.metadata?.visible ?? true),
    metadata: {
      ...(record?.apiName ? { apiName: clipped(record.apiName, 160) } : {}),
      ...(record?.intent ? { intent: clipped(record.intent, 80) } : {}),
      ...(record?.metadata?.canonicalName ? {
        canonicalName: clipped(record.metadata.canonicalName, 160)
      } : {}),
      ...(Array.isArray(record?.metadata?.aliases) ? {
        aliases: record.metadata.aliases.slice(0, 20).map((alias) => clipped(alias, 160)).filter(Boolean)
      } : {})
    }
  };
}

function dedupeSemantic(records) {
  const seen = new Set();
  const output = [];
  for (const record of records) {
    if (!record.text || !record.visible) continue;
    const key = `${record.evidenceId}|${record.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output;
}

function criticalErrors(legacy) {
  const errors = [];
  const intent = legacy?.request?.intent;
  const recommendations = array(legacy?.recommendations);
  if (recommendations.length === 0) errors.push("no_visible_structured_candidates");
  for (const record of recommendations) {
    if (!record?.evidenceId) errors.push("missing_evidence_id");
    const stats = record?.stats;
    if (["unit_build_rankings", "unit_item_rankings", "unit_emblem_rankings", "unit_item_comparison", "comp_rankings", "comp_trends"].includes(intent)) {
      if (!stats || !Number.isFinite(Number(stats.games))) errors.push(`missing_games:${record?.evidenceId ?? "unknown"}`);
    }
  }
  if (intent === "unit_item_comparison" && array(legacy?.comparison?.options).length < 2) {
    errors.push("missing_comparison_options");
  }
  if (intent === "comp_trends") {
    for (const record of recommendations) {
      if (!Number.isFinite(Number(record?.trend?.placementImprovement ?? record?.trend?.avgPlacementChange))) {
        errors.push(`missing_trend_improvement:${record?.evidenceId ?? "unknown"}`);
      }
    }
  }
  return [...new Set(errors)];
}

function derivedSignals(legacy) {
  return {
    itemSignals: array(legacy?.itemSignals),
    itemRankingContext: legacy?.itemRankingContext ?? null,
    compRankingContext: legacy?.compRankingContext ?? null,
    comparison: legacy?.comparison ? {
      winner: legacy.comparison.winner ?? null,
      winnerEvidenceId: legacy.comparison.winnerEvidenceId ?? null,
      primaryMetric: legacy.comparison.primaryMetric ?? null,
      decision: legacy.comparison.decision ?? null
    } : null,
    stableCandidateIds: array(legacy?.recommendations).filter((entry) => entry?.stable).map((entry) => entry.evidenceId),
    lowSampleCandidateIds: array(legacy?.recommendations).filter((entry) => entry?.lowSample).map((entry) => entry.evidenceId)
  };
}

export class EvidenceAssemblyError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EvidenceAssemblyError";
    this.code = options.code ?? "stale_or_missing_evidence";
    this.details = options.details ?? [];
  }
}

export class EvidenceAssembler {
  constructor(options = {}) {
    this.options = options;
  }

  assemble({ result, catalog, input = "", locale = "zh-CN", previousQuery = null, semanticEvidence = [], plan = null } = {}) {
    const legacy = buildConclusionEvidence({ result, catalog, input, locale, previousQuery });
    const requestIntent = result?.type ?? result?.query?.intent;
    if (requestIntent === "unit_emblem_rankings") {
      legacy.request.intent = "unit_emblem_rankings";
      legacy.request.requestedIntent = "unit_emblem_rankings";
    } else if (requestIntent === "comp_trends") {
      legacy.request.intent = "comp_trends";
      legacy.request.requestedIntent = "comp_trends";
    }
    const errors = criticalErrors(legacy);
    if (errors.length) {
      throw new EvidenceAssemblyError("Critical visible evidence is incomplete", { details: errors });
    }

    const metadata = sourceMetadata(result, legacy);
    const structuredEvidence = [
      ...array(legacy.recommendations),
      ...array(legacy.itemSignals)
    ].map((record) => decorateStructured(record, metadata));
    const configuredBudget = plan?.evidenceBudget ?? this.options.evidenceBudget ?? {};
    const maxItems = Math.max(1, Number(configuredBudget.maxItems ?? DEFAULT_EVIDENCE_MAX_ITEMS));
    const maxCharacters = Math.max(256, Number(configuredBudget.maxCharacters ?? DEFAULT_EVIDENCE_MAX_CHARACTERS));
    if (structuredEvidence.length > maxItems) {
      throw new EvidenceAssemblyError("Visible structured evidence exceeds the item budget", {
        details: [`required=${structuredEvidence.length}`, `max=${maxItems}`]
      });
    }

    const semantic = dedupeSemantic(array(semanticEvidence).map(normalizeSemantic));
    const pack = createEvidencePack({
      request: {
        ...legacy.request,
        entities: legacy.query?.unit?.apiName ? [legacy.query.unit.apiName] : []
      },
      query: legacy.query,
      structuredEvidence,
      semanticEvidence: [],
      derivedSignals: derivedSignals(legacy),
      warnings: legacy.warnings,
      dataStatus: {
        ...legacy.dataStatus,
        patch: metadata.patch,
        cluster: metadata.cluster,
        filters: metadata.filters
      },
      generationRules: {
        ...legacy.generationRules,
        factsMustComeFromEvidence: true,
        structuredEvidenceHasPriority: true,
        visibleEvidenceOnly: true
      }
    });

    for (const record of semantic) {
      if (pack.structuredEvidence.length + pack.semanticEvidence.length >= maxItems) break;
      pack.semanticEvidence.push(record);
      if (JSON.stringify(pack).length > maxCharacters) {
        pack.semanticEvidence.pop();
        pack.warnings.push("semantic_evidence_trimmed_to_budget");
        break;
      }
    }
    if (JSON.stringify({ ...pack, semanticEvidence: [] }).length > maxCharacters) {
      throw new EvidenceAssemblyError("Critical visible evidence exceeds the character budget", {
        details: [`max=${maxCharacters}`]
      });
    }

    // Compatibility aliases keep the existing validator and downstream consumers stable
    // while callers migrate to structuredEvidence/derivedSignals.
    return {
      ...pack,
      recommendations: legacy.recommendations,
      itemSignals: legacy.itemSignals,
      itemRankingContext: legacy.itemRankingContext,
      compRankingContext: legacy.compRankingContext,
      comparison: legacy.comparison,
      locale: legacy.locale
    };
  }
}

export function createEvidenceAssembler(options = {}) {
  return new EvidenceAssembler(options);
}

export function assembleEvidencePack(input, options = {}) {
  return createEvidenceAssembler(options).assemble(input);
}

export { EVIDENCE_PACK_SCHEMA_VERSION };
