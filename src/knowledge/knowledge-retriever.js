const SCOPE_DOCUMENT_TYPES = Object.freeze({
  video_guides: ["video_guide"],
  mechanism_knowledge: ["mechanism_knowledge"],
  static_knowledge: [
    "static_game_knowledge",
    "patch_note",
    "unit_description",
    "item_description",
    "trait_description"
  ],
  current_stats: [
    "meta_snapshot",
    "unit_stats",
    "comp_stats",
    "item_stats",
    "trend_snapshot"
  ]
});

const CURRENT_STATS_DOCUMENT_TYPES = new Set(SCOPE_DOCUMENT_TYPES.current_stats);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function documentTypes(scopes) {
  return [...new Set(array(scopes).flatMap((scope) => SCOPE_DOCUMENT_TYPES[scope] ?? []))];
}

function sourceUrl(metadata = {}) {
  return metadata.sourceUrl ?? metadata.videoUrl ?? (
    metadata.source === "youtube" && metadata.sourceId
      ? `https://www.youtube.com/watch?v=${metadata.sourceId}`
      : null
  );
}

export function semanticHitToKnowledgeEvidence(hit, index = 0) {
  const metadata = hit?.metadata ?? {};
  return {
    evidenceId: String(hit?.evidenceId ?? hit?.id ?? `knowledge:${index + 1}`),
    sourceType: String(metadata.source ?? hit?.source ?? "semantic_index"),
    sourceId: metadata.sourceId ?? null,
    sourceTitle: metadata.sourceTitle ?? metadata.title ?? null,
    author: metadata.author ?? null,
    publishedAt: metadata.publishedAt ?? null,
    season: metadata.season ?? null,
    patch: hit?.patch ?? metadata.patch ?? null,
    rank: metadata.rank ?? null,
    timeWindow: metadata.timeWindow ?? null,
    region: metadata.region ?? null,
    locale: hit?.locale ?? metadata.locale ?? null,
    timestampStart: optionalFinite(metadata.timestampStart),
    timestampEnd: optionalFinite(metadata.timestampEnd),
    claimType: metadata.claimType ?? (
      hit?.documentType === "video_guide" ? "creator_advice" : "mechanism"
    ),
    claim: metadata.content ?? hit?.text ?? "",
    conditions: array(metadata.conditions).map(String),
    topics: array(metadata.topics).map(String),
    sourceUrl: sourceUrl(metadata),
    generatedAt: metadata.generatedAt ?? hit?.updatedAt ?? null,
    expiresAt: metadata.expiresAt ?? null,
    videoVersion: metadata.videoVersion ?? null,
    transcriptHash: metadata.transcriptHash ?? null,
    segmentId: metadata.segmentId ?? null,
    segmentIndex: metadata.segmentIndex ?? null,
    ingestionStatus: metadata.ingestionStatus ?? null,
    aiGenerated: metadata.aiGenerated === true,
    contentOrigin: metadata.contentOrigin ?? null,
    reviewStatus: metadata.reviewStatus ?? null,
    contentDisclosure: metadata.contentDisclosure ?? null,
    extractionModel: metadata.extractionModel ?? null,
    isCurrentVersion: metadata.isCurrentVersion ?? null,
    namespace: metadata.namespace ?? null,
    documentType: hit?.documentType ?? metadata.documentType ?? "static_game_knowledge"
  };
}

function compatiblePatch(evidence, patch) {
  if (evidence.documentType === "video_guide") {
    return Boolean(patch) && String(evidence.patch ?? "") === String(patch);
  }
  if (!patch) return true;
  if (CURRENT_STATS_DOCUMENT_TYPES.has(evidence.documentType)) {
    return String(evidence.patch ?? "") === String(patch);
  }
  if (!evidence.patch || evidence.patch === "current") return true;
  return String(evidence.patch) === String(patch);
}

function compatibleCurrentStatsScope(evidence, options) {
  if (!CURRENT_STATS_DOCUMENT_TYPES.has(evidence.documentType)) return true;
  for (const key of ["rank", "timeWindow", "region"]) {
    if (options[key] !== undefined && options[key] !== null
      && String(evidence[key] ?? "").toLowerCase() !== String(options[key]).toLowerCase()) {
      return false;
    }
  }
  return true;
}

function activeEvidence(evidence, now = Date.now()) {
  if (
    evidence.documentType === "video_guide"
    && (
      !evidence.videoVersion
      || !["success", "partial_success"].includes(evidence.ingestionStatus)
      || evidence.isCurrentVersion !== true
    )
  ) return false;
  if (!evidence.expiresAt) return true;
  const expiresAt = Date.parse(evidence.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function normalizedRank(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return values.map((entry) => String(entry).trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function sameScopeValue(left, right, normalizer = (value) => String(value ?? "").toLowerCase()) {
  if (right === null || right === undefined || right === "") return true;
  return normalizer(left) === normalizer(right);
}

export function currentStatsScopeMatches(scope = {}, requested = {}) {
  return sameScopeValue(scope.seasonContextId, requested.seasonContextId)
    && sameScopeValue(scope.season, requested.season)
    && sameScopeValue(scope.patch, requested.patch)
    && sameScopeValue(scope.rank, requested.rank, normalizedRank)
    && sameScopeValue(scope.timeWindow, requested.timeWindow)
    && sameScopeValue(scope.region, requested.region)
    && sameScopeValue(scope.locale, requested.locale);
}

function requestedCurrentStatsScope(options = {}) {
  return {
    seasonContextId: options.seasonContextId ?? "set17-live",
    season: options.season ?? null,
    patch: options.patch ?? null,
    rank: normalizedRank(options.rank),
    timeWindow: options.timeWindow ?? null,
    region: options.region ?? null,
    locale: options.locale ?? "zh-CN"
  };
}

export class KnowledgeRetriever {
  constructor(options = {}) {
    if (!options.retriever?.search) throw new TypeError("KnowledgeRetriever requires a SemanticRetriever");
    this.retriever = options.retriever;
  }

  async searchEvidence(question, options = {}) {
    const types = documentTypes(options.scopes ?? [
      "video_guides",
      "mechanism_knowledge",
      "static_knowledge"
    ]);
    if (!types.length) return [];
    const hits = await this.retriever.search(String(question ?? ""), {
      documentTypes: types,
      seasonContextId: options.seasonContextId ?? "set17-live",
      patch: options.patch,
      rank: options.rank,
      timeWindow: options.timeWindow,
      region: options.region,
      locale: options.locale ?? "zh-CN",
      topK: Math.max(1, Number(options.topK ?? 8)),
      minimumScore: Number(options.minimumScore ?? 0.1)
    });
    const seen = new Set();
    return array(hits)
      .map(semanticHitToKnowledgeEvidence)
      .filter((evidence) => compatiblePatch(evidence, options.patch))
      .filter((evidence) => compatibleCurrentStatsScope(evidence, options))
      .filter((evidence) => activeEvidence(evidence, options.now ?? Date.now()))
      .filter((evidence) => {
        const key = `${evidence.sourceType}|${evidence.sourceId}|${evidence.timestampStart}|${evidence.claim}`;
        if (!evidence.claim || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }

  async currentStatsAvailability(options = {}) {
    if (!array(options.scopes).includes("current_stats")) {
      return {
        status: "not_requested",
        requestedScope: null,
        availableScopes: []
      };
    }
    const requestedScope = requestedCurrentStatsScope(options);
    if (typeof this.retriever.listCurrentStatsScopes !== "function") {
      return {
        status: "unknown",
        requestedScope,
        availableScopes: []
      };
    }
    const availableScopes = await this.retriever.listCurrentStatsScopes({
      seasonContextId: requestedScope.seasonContextId,
      locale: requestedScope.locale,
      now: options.now
    });
    const available = availableScopes.some(
      (scope) => currentStatsScopeMatches(scope, requestedScope)
    );
    return {
      status: available ? "available" : "scope_unavailable",
      requestedScope,
      availableScopes
    };
  }

  async searchWithStatus(question, options = {}) {
    const currentStats = await this.currentStatsAvailability(options);
    const scopes = currentStats.status === "scope_unavailable"
      ? array(options.scopes).filter((scope) => scope !== "current_stats")
      : options.scopes;
    return {
      evidence: await this.searchEvidence(question, {
        ...options,
        scopes
      }),
      warnings: currentStats.status === "scope_unavailable"
        ? ["current_stats_scope_unavailable"]
        : [],
      currentStats
    };
  }

  async search(question, options = {}) {
    return (await this.searchWithStatus(question, options)).evidence;
  }
}

export function createKnowledgeRetriever(options = {}) {
  return new KnowledgeRetriever(options);
}
