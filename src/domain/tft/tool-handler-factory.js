export const TFT_TOOL_HANDLER_FACTORY_VERSION = "tft-tool-handler-factory.v1";

function functionEntries(value = {}) {
  return Object.entries(value).filter(([, handler]) => typeof handler === "function");
}

const DEFAULT_SEMANTIC_DOCUMENT_TYPES = Object.freeze([
  "mechanism_knowledge",
  "patch_note",
  "static_game_knowledge"
]);
const ALLOWED_SEMANTIC_DOCUMENT_TYPES = Object.freeze([
  "mechanism_knowledge",
  "patch_note",
  "static_game_knowledge",
  "video_guide"
]);

function detailScope(dependencies = {}) {
  const seasonContext = dependencies.seasonContext ?? {};
  return {
    seasonContextId: String(seasonContext.id ?? dependencies.seasonContextId ?? "unknown"),
    patch: seasonContext.currentPatch ?? seasonContext.effectivePatch ?? dependencies.patch ?? null,
    locale: String(dependencies.locale ?? "zh-CN")
  };
}

function detailSource(record, details, retrievedAt) {
  const sourceId = record?.source?.url
    ?? record?.sourceUrl
    ?? details?.meta?.sources?.[0]
    ?? details?.meta?.sourceUrl
    ?? null;
  const communityDragon = /communitydragon/iu.test(String(sourceId ?? ""));
  return {
    sourceType: communityDragon ? "communitydragon" : "official_tft_catalog",
    sourceId,
    updatedAt: record?.source?.updatedAt ?? details?.meta?.updatedAt ?? null,
    retrievedAt
  };
}

function entityFacts(entityType, record = {}) {
  if (entityType === "unit") {
    return {
      cost: record.cost ?? null,
      traits: [...(record.traitNames ?? record.traits ?? [])],
      ability: structuredClone(record.ability ?? null),
      stats: structuredClone(record.stats ?? null),
      mana: record.stats?.mana ?? null,
      range: record.stats?.attackRange ?? null,
      role: record.role ?? null
    };
  }
  if (entityType === "item") {
    return {
      description: record.effect ?? record.description ?? null,
      effect: record.effect ?? record.description ?? null,
      composition: structuredClone(record.recipe ?? record.composition ?? []),
      category: record.category ?? null,
      stats: structuredClone(record.stats ?? null),
      unique: record.unique ?? null
    };
  }
  const levels = structuredClone(record.levels ?? record.effects ?? []);
  return {
    description: record.description ?? null,
    breakpoints: levels.map((level) => level?.units ?? level?.minUnits ?? null).filter((value) => value !== null),
    effects: levels,
    members: structuredClone(record.members ?? [])
  };
}

function detailCompleteness(entityType, facts) {
  if (entityType === "unit") {
    return facts.cost !== null && Boolean(facts.ability?.description || facts.ability?.name);
  }
  if (entityType === "item") {
    return Boolean(facts.description || facts.effect) && Array.isArray(facts.composition);
  }
  return Boolean(facts.description) && Array.isArray(facts.effects) && facts.effects.length > 0;
}

function detailResult(entityType, apiName, details, record, dependencies) {
  const retrievedAt = new Date().toISOString();
  const source = detailSource(record, details, retrievedAt);
  const found = Boolean(record);
  const facts = found ? entityFacts(entityType, record) : {};
  const status = !found ? "not_found" : detailCompleteness(entityType, facts) ? "found" : "partial";
  const displayName = record?.name ?? record?.displayName ?? null;
  return {
    schemaVersion: "official-entity-detail.v1",
    type: `${entityType}_details`,
    status,
    entityType,
    apiName,
    displayName,
    entityRef: { apiName, displayName },
    scope: detailScope(dependencies),
    facts,
    source,
    updatedAt: source.updatedAt ?? retrievedAt,
    warnings: !found ? ["entity_not_found"] : status === "partial" ? ["partial_entity_detail"] : []
  };
}

function semanticDocumentTypes(requested) {
  const allowed = new Set(ALLOWED_SEMANTIC_DOCUMENT_TYPES);
  const values = Array.isArray(requested) && requested.length
    ? requested.map(String)
    : DEFAULT_SEMANTIC_DOCUMENT_TYPES;
  return values.filter((value) => allowed.has(value));
}

function boundedSemanticHits(values = [], topK = 4) {
  const hits = [];
  let textBudget = 4000;
  for (const [index, value] of values.slice(0, topK).entries()) {
    if (textBudget <= 0) break;
    const claim = String(value?.claim ?? value?.text ?? value?.metadata?.content ?? "")
      .slice(0, Math.min(800, textBudget));
    if (!claim) continue;
    textBudget -= claim.length;
    hits.push({
      evidenceId: String(value?.evidenceId ?? value?.id ?? `semantic:${index + 1}`),
      documentId: String(value?.documentId ?? value?.id ?? value?.sourceId ?? `semantic:${index + 1}`),
      documentType: String(value?.documentType ?? "static_game_knowledge"),
      claimType: String(value?.claimType ?? "mechanism"),
      title: String(value?.sourceTitle ?? value?.title ?? value?.documentType ?? "Knowledge result"),
      claim,
      sourceType: String(value?.sourceType ?? value?.source ?? "semantic_index"),
      sourceId: value?.sourceId ?? null,
      sourceUrl: value?.sourceUrl ?? null,
      author: value?.author ?? null,
      publishedAt: value?.publishedAt ?? null,
      patch: value?.patch ?? null,
      season: value?.season ?? null,
      locale: value?.locale ?? null,
      timestampStart: value?.timestampStart ?? null,
      timestampEnd: value?.timestampEnd ?? null,
      score: Number.isFinite(Number(value?.score)) ? Number(value.score) : 0,
      warnings: [...(value?.warnings ?? [])]
    });
  }
  return hits;
}

export function assertHandlerCoverage(options = {}) {
  if (!options.registry) throw new TypeError("assertHandlerCoverage requires a ToolRegistry");
  const handlers = options.handlers ?? {};
  const allowedMissing = new Set((options.allowedMissingTools ?? []).map(String));
  const missing = options.registry.list()
    .map((definition) => definition.name)
    .filter((name) => typeof handlers[name] !== "function" && !allowedMissing.has(name));
  if (missing.length) {
    throw new TypeError(`Missing TFT tool handlers: ${missing.join(", ")}`);
  }
  return { valid: true, missing: [] };
}

export function createTftToolHandlers(dependencies = {}) {
  const handlers = Object.fromEntries(functionEntries(dependencies.handlers));

  if (
    typeof dependencies.loadOfficialEntityDetails === "function"
    && typeof dependencies.queryEntityCatalog === "function"
  ) {
    handlers.entity_catalog_query = async (input) => {
      const details = await dependencies.loadOfficialEntityDetails();
      return dependencies.queryEntityCatalog({
        catalog: dependencies.catalog,
        details,
        input,
        updatedAt: details?.meta?.updatedAt
      });
    };
  }

  if (typeof dependencies.queryCompositionMemberStatistics === "function") {
    handlers.composition_member_statistics = (input) => (
      dependencies.queryCompositionMemberStatistics(input, {
        catalog: dependencies.catalog,
        seasonContext: dependencies.seasonContext,
        preferences: dependencies.preferences,
        compsData: dependencies.compsData
      })
    );
  }

  if (typeof dependencies.queryUnitBuildsBatch === "function") {
    handlers.unit_builds_batch = (input, context) => (
      dependencies.queryUnitBuildsBatch(input, context)
    );
  }

  if (typeof dependencies.loadOfficialEntityDetails === "function") {
    handlers.unit_details = async (input, context) => {
      const details = await dependencies.loadOfficialEntityDetails(context);
      const apiName = String(input.apiName);
      return detailResult("unit", apiName, details, details?.units?.get?.(apiName), dependencies);
    };
    handlers.trait_details = async (input, context) => {
      const details = await dependencies.loadOfficialEntityDetails(context);
      const apiName = String(input.apiName).replace(/_\d+$/u, "");
      return detailResult("trait", apiName, details, details?.traits?.get?.(apiName), dependencies);
    };
  }

  if (typeof dependencies.loadOfficialItemDetails === "function") {
    handlers.item_details = async (input, context) => {
      const details = await dependencies.loadOfficialItemDetails(context);
      const apiName = String(input.apiName);
      return detailResult("item", apiName, details, details?.get?.(apiName), dependencies);
    };
    handlers.item_details_batch = async (input, context) => {
      const scope = detailScope(dependencies);
      const apiNames = [...new Set((input.apiNames ?? []).map(String))].slice(0, 4);
      const seasonMatches = String(input.seasonContextId) === scope.seasonContextId;
      const details = seasonMatches ? await dependencies.loadOfficialItemDetails(context) : null;
      const items = apiNames.map((apiName, index) => {
        const detail = seasonMatches
          ? detailResult("item", apiName, details, details?.get?.(apiName), dependencies)
          : {
            schemaVersion: "official-entity-detail.v1",
            type: "item_details",
            status: "season_mismatch",
            entityType: "item",
            apiName,
            displayName: null,
            entityRef: { apiName, displayName: null },
            scope,
            facts: {},
            source: null,
            updatedAt: null,
            warnings: ["season_context_mismatch"]
          };
        return {
          ...detail,
          claimId: `official-item:${apiName}`,
          evidencePath: `/items/${index}`
        };
      });
      const mechanismStatus = seasonMatches
        && items.length > 0
        && items.every((item) => item.status === "found" && Boolean(item.facts?.effect))
        ? "available"
        : "unavailable";
      return {
        schemaVersion: "official-item-detail-batch.v1",
        type: "item_details_batch",
        status: mechanismStatus === "available" ? "found" : "partial",
        scope,
        selection: {
          strategy: "stable_relative_replacement_pairs",
          apiNames,
          maxItems: 4
        },
        items,
        mechanismStatus,
        updatedAt: items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1)
          ?? new Date().toISOString(),
        warnings: mechanismStatus === "available"
          ? []
          : ["current_season_item_evidence_missing"]
      };
    };
  }

  const semanticSearch = dependencies.knowledgeSearch ?? dependencies.semanticSearch;
  if (typeof semanticSearch === "function") {
    handlers.semantic_search = async (input, context) => {
      const query = String(input.query ?? "").trim();
      if (query.length < 2 || query.length > 240) {
        throw new TypeError("Invalid input for semantic_search: query must contain 2 to 240 characters");
      }
      const requestedTypes = Array.isArray(input.documentTypes) ? input.documentTypes.map(String) : [];
      if (
        requestedTypes.length > 4
        || requestedTypes.some((value) => !ALLOWED_SEMANTIC_DOCUMENT_TYPES.includes(value))
      ) {
        throw new TypeError("Invalid input for semantic_search: unsupported semantic document type");
      }
      if (input.topK !== undefined && (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > 6)) {
        throw new TypeError("Invalid input for semantic_search: topK must be an integer from 1 to 6");
      }
      const documentTypes = semanticDocumentTypes(input.documentTypes);
      const topK = Math.max(1, Math.min(6, Number(input.topK ?? 4)));
      const values = documentTypes.length
        ? await semanticSearch({
          ...input,
          query,
          documentTypes,
          topK
        }, context)
        : [];
      const hits = boundedSemanticHits(values ?? [], topK);
      const updatedAt = (values ?? []).map((entry) => (
        entry?.updatedAt ?? entry?.metadata?.updatedAt ?? entry?.metadata?.generatedAt ?? null
      )).filter(Boolean).sort().at(-1) ?? new Date().toISOString();
      return {
        schemaVersion: "semantic-search-results.v1",
        type: "semantic_search_results",
        source: "semantic_index",
        updatedAt,
        query: input.query,
        scope: {
          seasonContextId: detailScope(dependencies).seasonContextId,
          patch: input.patch ?? detailScope(dependencies).patch,
          locale: input.locale ?? detailScope(dependencies).locale,
          documentTypes
        },
        hits,
        warnings: hits.length ? [] : ["no_semantic_match"]
      };
    };
  }

  if (typeof dependencies.videoGuideSearchService?.search === "function") {
    handlers.video_guide_search = (input, context) => (
      dependencies.videoGuideSearchService.search(input, context)
    );
  }

  const registeredTools = dependencies.registry?.list?.().map((definition) => definition.name) ?? [];
  const unavailableTools = registeredTools.filter((name) => typeof handlers[name] !== "function");
  const availableToolNames = Object.freeze(Object.keys(handlers).filter((name) => (
    registeredTools.length === 0 || registeredTools.includes(name)
  )));
  return {
    schemaVersion: TFT_TOOL_HANDLER_FACTORY_VERSION,
    handlers: Object.freeze(handlers),
    availableToolNames,
    unavailableTools: Object.freeze(unavailableTools)
  };
}
