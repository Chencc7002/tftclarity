import { BilibiliMcpAdapter } from "./adapter.mjs";
import { createBilibiliMcpHttpClient } from "./mcp-client.mjs";
import { createOnlinePatchWindowProvider } from "./patch-window-provider.mjs";
import { filterStrategyVideoDomain, gateStrategyVideoRequest } from "./domain-filter.mjs";
import { createVideoEntityScope } from "../../src/domain/tft/video-entity-scope.js";
import {
  attachRankingSignals,
  classifyPatchTime,
  relevanceScore,
  selectPatchAwareResults,
  sortRankedVideos
} from "./ranking.mjs";

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function parsePatchWindows(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePatchWindows(value) {
  return parsePatchWindows(value).flatMap((entry) => {
    const patchId = String(entry?.patchId ?? entry?.patch ?? "").trim();
    const startAt = String(entry?.startAt ?? entry?.start_at ?? entry?.start ?? "").trim();
    const endAt = String(entry?.endAt ?? entry?.end_at ?? entry?.end ?? "").trim() || null;
    if (!patchId || Number.isNaN(new Date(startAt).getTime())) return [];
    if (endAt && Number.isNaN(new Date(endAt).getTime())) return [];
    return [{ patchId, startAt: new Date(startAt).toISOString(), endAt: endAt ? new Date(endAt).toISOString() : null }];
  });
}

export function resolveBilibiliMcpConfig(options = {}, env = process.env) {
  const token = String(options.authToken ?? env.BILIBILI_MCP_AUTH_TOKEN ?? "").trim();
  const tftPatchWindows = normalizePatchWindows(
    options.tftPatchWindows ?? options.patchWindows ?? env.BILIBILI_TFT_PATCH_WINDOWS_JSON ?? env.BILIBILI_PATCH_WINDOWS_JSON
  );
  return {
    mode: String(options.mode ?? env.BILIBILI_MCP_MODE ?? "auto").trim().toLowerCase(),
    transport: String(options.transport ?? env.BILIBILI_MCP_TRANSPORT ?? "streamable_http").trim().toLowerCase(),
    endpoint: String(options.endpoint ?? env.BILIBILI_MCP_ENDPOINT ?? "").trim(),
    searchToolName: String(options.searchToolName ?? env.BILIBILI_MCP_SEARCH_TOOL ?? "bilibili-search-summary").trim(),
    detailToolName: String(options.detailToolName ?? env.BILIBILI_MCP_DETAIL_TOOL ?? "bilibili-video-detail").trim(),
    timeoutMs: integer(options.timeoutMs ?? env.BILIBILI_MCP_TIMEOUT_MS, 8000, 500, 60_000),
    recallLimit: integer(options.recallLimit ?? env.BILIBILI_SEARCH_RECALL_LIMIT, 10, 1, 20),
    detailLimit: integer(options.detailLimit ?? env.BILIBILI_DETAIL_CANDIDATE_LIMIT, 5, 0, 10),
    resultLimit: integer(options.resultLimit ?? env.BILIBILI_RESULT_LIMIT, 5, 1, 10),
    minCurrentResults: integer(options.minCurrentResults ?? env.BILIBILI_MIN_CURRENT_RESULTS, 3, 1, 10),
    entityMatchMode: ["off", "shadow", "enforce"].includes(options.entityMatchMode ?? env.BILIBILI_ENTITY_MATCH_MODE)
      ? options.entityMatchMode ?? env.BILIBILI_ENTITY_MATCH_MODE : "shadow",
    tftPatchWindows,
    patchWindows: tftPatchWindows,
    goldenSpatulaPatchWindows: normalizePatchWindows(
      options.goldenSpatulaPatchWindows ?? env.BILIBILI_GOLDEN_SPATULA_PATCH_WINDOWS_JSON
    ),
    goldenSpatulaCurrentPatch: String(
      options.goldenSpatulaCurrentPatch ?? env.BILIBILI_GOLDEN_SPATULA_CURRENT_PATCH ?? ""
    ).trim() || null,
    goldenSpatulaPreviousPatch: String(
      options.goldenSpatulaPreviousPatch ?? env.BILIBILI_GOLDEN_SPATULA_PREVIOUS_PATCH ?? ""
    ).trim() || null,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  };
}

function patchWindowContext(config, context = {}, ecosystem = "tft_pc") {
  const golden = ecosystem === "golden_spatula";
  const discovered = context.onlinePatchContexts?.[ecosystem] ?? null;
  const configuredWindows = golden ? config.goldenSpatulaPatchWindows : config.tftPatchWindows;
  const windows = configuredWindows.length ? configuredWindows : (discovered?.windows ?? []);
  const currentPatch = String(golden
    ? context.goldenSpatulaCurrentPatch ?? context.currentGoldenSpatulaPatch ?? config.goldenSpatulaCurrentPatch ?? discovered?.currentPatch ?? ""
    : context.currentPatch ?? discovered?.currentPatch ?? "").trim() || null;
  const previousPatch = String(golden
    ? context.goldenSpatulaPreviousPatch ?? context.previousGoldenSpatulaPatch ?? config.goldenSpatulaPreviousPatch ?? discovered?.previousPatch ?? ""
    : context.previousPatch ?? discovered?.previousPatch ?? "").trim() || null;
  const byId = new Map(windows.map((window) => [window.patchId, window]));
  return {
    ecosystem,
    currentPatch,
    previousPatch,
    current: currentPatch ? byId.get(currentPatch) ?? null : null,
    previous: previousPatch ? byId.get(previousPatch) ?? null : null,
    windowsConfigured: Boolean(currentPatch && byId.get(currentPatch)),
    sourceUrl: configuredWindows.length ? null : discovered?.sourceUrl ?? null,
    fetchedAt: configuredWindows.length ? null : discovered?.fetchedAt ?? null
  };
}

function safeFailure(error) {
  return {
    code: String(error?.code ?? "bilibili_mcp_unavailable"),
    message: "Bilibili MCP is currently unavailable"
  };
}

function patchFields(video, patch) {
  if (!patch.windowsConfigured) {
    return {
      patchTimeStatus: "unknown",
      patchTimeReason: "ecosystem_patch_window_unavailable"
    };
  }
  const patchTimeStatus = classifyPatchTime(video.publishedAt, patch);
  return {
    patchTimeStatus,
    patchTimeReason: patchTimeStatus === "unknown"
      ? (video.publishedAt ? "publish_date_outside_configured_windows" : "publish_date_unavailable")
      : null
  };
}

function mergeDetail(candidate, detail) {
  const merged = { ...candidate };
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (key === "raw" || key === "source") continue;
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  if (detail?.detailViewCount !== null && detail?.detailViewCount !== undefined) {
    merged.detailViewCount = detail.detailViewCount;
    merged.viewCount = detail.detailViewCount;
    merged.viewCountSource = "detail";
  } else {
    merged.viewCount = candidate.searchViewCount ?? candidate.viewCount ?? null;
    merged.viewCountSource = merged.viewCount === null ? null : "search";
  }
  const hasDetailMetrics = [merged.viewCount, merged.likeCount, merged.favoriteCount, merged.coinCount]
    .some((value) => value !== null && value !== undefined);
  merged.detailStatus = hasDetailMetrics ? "available" : "partial";
  return merged;
}

function publicVideo(video, evidence) {
  const { raw, ...value } = video;
  return {
    ...value,
    evidence: {
      source: "bilibili",
      videoId: value.videoId,
      requestedEcosystem: evidence.requestedEcosystem,
      resolvedEcosystem: value.ecosystem,
      ecosystemResolutionSource: evidence.ecosystemSource,
      matchedTftAnchors: value.domainEvidence?.matchedTftAnchors ?? [],
      matchedGoldenSpatulaAnchors: value.domainEvidence?.matchedGoldenSpatulaAnchors ?? [],
      searchTool: evidence.searchTool,
      userQuery: evidence.userQuery,
      searchQuery: evidence.searchQuery,
      searchRetrievedAt: evidence.searchRetrievedAt,
      detailTool: evidence.detailTool,
      detailRequested: evidence.detailRequested.has(value.videoId),
      detailSucceeded: value.detailStatus !== "unavailable",
      viewCountSource: value.viewCountSource ?? null,
      patchEcosystem: value.ecosystem === "cross_ecosystem" ? null : evidence.patch.ecosystem,
      patchWindowEcosystem: value.ecosystem === "cross_ecosystem" ? null : evidence.patch.ecosystem,
      patchId: evidence.patch.currentPatch,
      patchStartAt: evidence.patch.current?.startAt ?? null,
      patchEndAt: evidence.patch.current?.endAt ?? null,
      patchTimeStatus: value.patchTimeStatus,
      patchTimeReason: value.patchTimeReason,
      patchInferenceMethod: "publish_date",
      patchInferencePrecision: value.publishedPrecision ?? "unknown"
    }
  };
}

function emptyGroup(plan, patch, failure, retrievedAt) {
  return {
    ecosystem: plan.ecosystem,
    status: "unavailable",
    effectiveSearchQuery: plan.effectiveQuery,
    updatedAt: retrievedAt,
    patch: {
      currentPatch: patch.currentPatch,
      previousPatch: patch.previousPatch,
      currentWindow: patch.current,
      previousWindow: patch.previous,
      windowsConfigured: patch.windowsConfigured
    },
    videos: [],
    results: [],
    fallbackUsed: false,
    fallbackType: null,
    failure: safeFailure(failure),
    warnings: ["bilibili_search_unavailable"]
  };
}

export class BilibiliStrategyVideoService {
  constructor(options = {}) {
    if (typeof options.adapter?.searchVideos !== "function") {
      throw new TypeError("BilibiliStrategyVideoService requires an adapter");
    }
    this.adapter = options.adapter;
    this.config = options.config ?? resolveBilibiliMcpConfig();
    this.now = options.now ?? Date.now;
    this.patchWindowProvider = options.patchWindowProvider ?? null;
  }

  async searchGroup(plan, input, context, userQuery, retrievedAt, ecosystemSource, entityMatcher) {
    let onlinePatchContext = null;
    let patchDiscoveryWarning = null;
    if (this.patchWindowProvider) {
      try {
        onlinePatchContext = await this.patchWindowProvider.resolve(plan.ecosystem);
      } catch {
        patchDiscoveryWarning = `patch_discovery_unavailable:${plan.ecosystem}`;
      }
    }
    const patch = patchWindowContext(this.config, {
      ...context,
      onlinePatchContexts: {
        ...(context.onlinePatchContexts ?? {}),
        ...(onlinePatchContext ? { [plan.ecosystem]: onlinePatchContext } : {})
      }
    }, plan.ecosystem);
    let search;
    try {
      search = await this.adapter.searchVideos({
        query: plan.effectiveQuery,
        page: input.page ?? 1,
        limit: Math.min(Number(input.limit ?? this.config.recallLimit), this.config.recallLimit)
      }, context);
    } catch (error) {
      return emptyGroup(plan, patch, error, retrievedAt);
    }

    const normalized = search.videos
      .filter((video) => video.videoId && video.url && video.title)
      .map((video) => ({ ...video, detailStatus: "unavailable" }));
    const domainFiltered = filterStrategyVideoDomain(normalized, userQuery, plan.ecosystem);
    const entityMode = this.config.entityMatchMode ?? "shadow";
    const titleMatches = new Map();
    const matchesEntity = (video) => {
      if (!titleMatches.has(video.title)) titleMatches.set(video.title, entityMatcher?.matchTitle(video.title)
        ?? { accepted: true, reason: "off", matches: [] });
      return titleMatches.get(video.title);
    };
    const observed = domainFiltered.accepted.map((video) => ({ video, match: matchesEntity(video) }));
    const candidates = domainFiltered.accepted
      .map((video) => ({ ...video, ...patchFields(video, patch) }))
      .filter((video) => entityMode === "enforce" && entityMatcher?.scope.status !== "unscoped"
        ? matchesEntity(video).accepted : relevanceScore(video, userQuery) >= 0.08);
    const preliminary = sortRankedVideos(attachRankingSignals(candidates, { query: userQuery, now: this.now() }));
    const detailCandidates = preliminary
      .filter((video) => video.videoId)
      .slice(0, Math.min(this.config.detailLimit, preliminary.length));
    const detailRequested = new Set(detailCandidates.map((video) => video.videoId));
    const detailById = new Map();
    const detailFailureById = new Map();
    const warnings = [...(search.warnings ?? []), ...(patchDiscoveryWarning ? [patchDiscoveryWarning] : [])];
    await Promise.all(detailCandidates.map(async (candidate) => {
      try {
        const result = await this.adapter.getVideoDetail({ videoId: candidate.videoId }, context);
        detailById.set(candidate.videoId, result.video);
        warnings.push(...(result.warnings ?? []));
      } catch (error) {
        detailFailureById.set(candidate.videoId, String(error?.code ?? "bilibili_mcp_tool_error"));
        warnings.push(`detail_unavailable:${candidate.videoId}`);
      }
    }));
    const enriched = preliminary.map((candidate) => detailById.has(candidate.videoId)
      ? mergeDetail(candidate, detailById.get(candidate.videoId))
      : detailFailureById.has(candidate.videoId)
        ? { ...candidate, detailFailureCode: detailFailureById.get(candidate.videoId) }
        : candidate);
    // Details can replace the title. Recheck it before selection and every
    // patch/ecosystem fallback; popularity and freshness cannot bypass scope.
    const finalCandidates = entityMode === "enforce"
      ? enriched.filter((video) => matchesEntity(video).accepted) : enriched;
    const reranked = sortRankedVideos(attachRankingSignals(finalCandidates.map((video) => ({
      ...video,
      ...patchFields(video, patch)
    })), { query: userQuery, now: this.now() }));
    const resultLimit = Math.min(Number(input.limit ?? this.config.resultLimit), this.config.resultLimit);
    const exactRanked = reranked.filter((video) => video.ecosystem === plan.ecosystem);
    const crossRanked = reranked.filter((video) => video.ecosystem === "cross_ecosystem");
    const selectedExact = patch.windowsConfigured
      ? selectPatchAwareResults(exactRanked, { resultLimit, minCurrentResults: this.config.minCurrentResults })
      : {
          videos: exactRanked.slice(0, resultLimit),
          fallbackUsed: false,
          fallbackType: null,
          bucketCounts: { current: 0, previous: 0, older: 0, unknown: exactRanked.length }
        };
    const crossSupplement = crossRanked.slice(0, Math.max(0, resultLimit - selectedExact.videos.length));
    const selected = {
      ...selectedExact,
      videos: [...selectedExact.videos, ...crossSupplement],
      fallbackUsed: selectedExact.fallbackUsed || crossSupplement.length > 0,
      fallbackType: selectedExact.fallbackType ?? (crossSupplement.length ? "cross_ecosystem" : null),
      bucketCounts: {
        ...selectedExact.bucketCounts,
        crossEcosystem: crossRanked.length
      }
    };
    const evidence = {
      requestedEcosystem: plan.ecosystem,
      ecosystemSource,
      searchTool: search.toolName,
      detailTool: this.adapter.detailToolName ?? this.config.detailToolName,
      userQuery,
      searchQuery: plan.effectiveQuery,
      searchRetrievedAt: retrievedAt,
      detailRequested,
      patch
    };
    const videos = selected.videos.map((video) => {
      const result = publicVideo(video, evidence);
      if (entityMode === "enforce") result.evidence.titleEntityMatch = matchesEntity(video);
      return result;
    });
    if (entityMode === "enforce" && entityMatcher) {
      if (["ambiguous", "catalog_unavailable"].includes(entityMatcher.scope.status)) {
        warnings.push(`video_entity_scope_${entityMatcher.scope.status}`);
      } else if (entityMatcher.scope.status === "resolved" && !videos.length) {
        warnings.push("no_title_entity_match");
      }
    }
    return {
      ecosystem: plan.ecosystem,
      status: videos.length ? "found" : "no_results",
      effectiveSearchQuery: plan.effectiveQuery,
      updatedAt: retrievedAt,
      patch: {
        currentPatch: patch.currentPatch,
        previousPatch: patch.previousPatch,
        currentWindow: patch.current,
        previousWindow: patch.previous,
        windowsConfigured: patch.windowsConfigured,
        sourceUrl: patch.sourceUrl,
        fetchedAt: patch.fetchedAt
      },
      videos,
      results: videos,
      bucketCounts: selected.bucketCounts,
      domainFilter: {
        accepted: domainFiltered.accepted.length,
        rejected: domainFiltered.rejected.length,
        rejectionCounts: domainFiltered.rejectionCounts
      },
      ...(entityMatcher ? { entityFilter: {
        mode: entityMode,
        ...entityMatcher.scope,
        accepted: observed.filter(({ match }) => match.accepted).length,
        rejected: observed.filter(({ match }) => !match.accepted).length,
        rejections: observed.filter(({ match }) => !match.accepted)
          .map(({ video, match }) => ({ videoId: video.videoId, reason: match.reason })),
        returnedOutsideScope: videos.filter((video) => !matchesEntity(video).accepted).map((video) => video.videoId),
        detailTitleRejected: enriched.length - finalCandidates.length
      } } : {}),
      fallbackUsed: selected.fallbackUsed,
      fallbackType: selected.fallbackType,
      resultShortage: videos.length < resultLimit,
      searchTool: search.toolName,
      detailTool: evidence.detailTool,
      detailRequested: detailRequested.size,
      detailSucceeded: detailById.size,
      warnings: [...new Set(warnings)]
    };
  }

  async search(input = {}, context = {}) {
    const query = String(input.query ?? "").trim();
    if (query.length < 1 || query.length > 240) {
      throw new TypeError("Bilibili video query must contain 1 to 240 characters");
    }
    context.signal?.throwIfAborted?.();
    let entityMatcher = null;
    if ((this.config.entityMatchMode ?? "shadow") !== "off") {
      let resources;
      try {
        resources = typeof context.loadVideoEntityResources === "function"
          ? await context.loadVideoEntityResources({ mode: this.config.entityMatchMode ?? "shadow" }) : context;
        context.signal?.throwIfAborted?.();
        entityMatcher = createVideoEntityScope(query, resources ?? {});
      } catch {
        context.signal?.throwIfAborted?.();
        entityMatcher = createVideoEntityScope(query, {});
      }
      context.signal?.throwIfAborted?.();
    }
    const requestedEcosystem = ["tft_pc", "golden_spatula", "both"].includes(input.ecosystem)
      ? input.ecosystem
      : null;
    const scopeAwareQuery = requestedEcosystem === "both"
      ? `${query} \u5206\u522b \u4e91\u9876\u4e4b\u5f08 \u91d1\u94f2\u94f2\u4e4b\u6218`
      : requestedEcosystem === "golden_spatula"
        ? `${query} \u91d1\u94f2\u94f2\u4e4b\u6218`
        : requestedEcosystem === "tft_pc" ? `${query} \u4e91\u9876\u4e4b\u5f08` : query;
    let requestGate = gateStrategyVideoRequest(scopeAwareQuery);
    if (this.config.entityMatchMode === "enforce" && entityMatcher?.scope.status === "resolved"
      && requestGate.reason === "tft_strategy_signal_required") {
      requestGate = gateStrategyVideoRequest(`${scopeAwareQuery} 云顶之弈`);
    }
    const retrievedAt = new Date(this.now()).toISOString();
    if (!requestGate.allowed) {
      return {
        schemaVersion: "strategy-video-search-results.v1",
        type: "strategy_video_search_results",
        status: requestGate.status,
        source: "bilibili",
        query,
        effectiveSearchQuery: null,
        updatedAt: retrievedAt,
        requestedEcosystem: requestGate.requestedEcosystem,
        ecosystemSource: requestGate.ecosystemSource ?? null,
        groups: [],
        videos: [],
        fallbackUsed: false,
        fallbackType: null,
        failure: { code: requestGate.reason, message: "Only TFT and Golden Spatula strategy-video search is supported" },
        warnings: [requestGate.reason]
      };
    }

    const groups = await Promise.all(requestGate.searchPlans.map((plan) => (
      this.searchGroup(plan, input, context, query, retrievedAt, requestGate.ecosystemSource, entityMatcher)
    )));
    if (requestGate.requestedEcosystem === "both") {
      const nativeGroups = groups.map((group) => ({
        ...group,
        videos: group.videos.filter((video) => video.ecosystem !== "cross_ecosystem"),
        results: group.results.filter((video) => video.ecosystem !== "cross_ecosystem")
      })).map((group) => ({
        ...group,
        status: group.status === "unavailable" ? "unavailable" : group.videos.length ? "found" : "no_results",
        resultShortage: group.status === "unavailable" ? false : group.videos.length < Math.min(Number(input.limit ?? this.config.resultLimit), this.config.resultLimit)
      }));
      const crossById = new Map();
      for (const video of groups.flatMap((group) => group.videos)) {
        if (video.ecosystem !== "cross_ecosystem" || !video.videoId) continue;
        const existing = crossById.get(video.videoId);
        if (!existing || Number(video.rankingSignals?.totalScore ?? 0) > Number(existing.rankingSignals?.totalScore ?? 0)) {
          crossById.set(video.videoId, {
            ...video,
            evidence: {
              ...video.evidence,
              requestedEcosystem: "both",
              patchEcosystem: null,
              patchWindowEcosystem: null
            }
          });
        }
      }
      const crossVideos = sortRankedVideos([...crossById.values()])
        .slice(0, Math.min(Number(input.limit ?? this.config.resultLimit), this.config.resultLimit));
      const resultGroups = crossVideos.length ? [...nativeGroups, {
        ecosystem: "cross_ecosystem",
        status: "found",
        effectiveSearchQuery: null,
        updatedAt: retrievedAt,
        patch: { currentPatch: null, previousPatch: null, currentWindow: null, previousWindow: null, windowsConfigured: false },
        videos: crossVideos,
        results: crossVideos,
        resultShortage: false,
        fallbackUsed: false,
        fallbackType: null,
        warnings: []
      }] : nativeGroups;
      const anyFound = resultGroups.some((group) => group.status === "found");
      const allUnavailable = resultGroups.every((group) => group.status === "unavailable");
      return {
        schemaVersion: "strategy-video-search-results.v1",
        type: "strategy_video_search_results",
        status: anyFound ? "found" : allUnavailable ? "unavailable" : "no_results",
        source: "bilibili",
        query,
        effectiveSearchQuery: null,
        requestedEcosystem: "both",
        ecosystemSource: requestGate.ecosystemSource,
        updatedAt: retrievedAt,
        groups: resultGroups,
        videos: [],
        fallbackUsed: resultGroups.some((group) => group.fallbackUsed),
        fallbackType: null,
        warnings: [...new Set(resultGroups.flatMap((group) => group.warnings ?? []))]
      };
    }

    const group = groups[0];
    return {
      schemaVersion: "strategy-video-search-results.v1",
      type: "strategy_video_search_results",
      source: "bilibili",
      query,
      requestedEcosystem: requestGate.requestedEcosystem,
      ecosystemSource: requestGate.ecosystemSource,
      groups,
      ...group
    };
  }
}

function unavailableServiceResult(input, code, message, warning) {
  return {
    schemaVersion: "strategy-video-search-results.v1",
    type: "strategy_video_search_results",
    status: "unavailable",
    source: "bilibili",
    query: String(input.query ?? ""),
    updatedAt: new Date().toISOString(),
    groups: [],
    videos: [],
    fallbackUsed: false,
    fallbackType: null,
    failure: { code, message },
    warnings: [warning]
  };
}

export function createBilibiliStrategyVideoService(options = {}, env = process.env) {
  if (options.service) return options.service;
  const config = options.config ?? resolveBilibiliMcpConfig(options, env);
  if (config.transport !== "streamable_http" && config.transport !== "remote") {
    return {
      config,
      async search(input = {}) {
        return unavailableServiceResult(input, "unsupported_bilibili_mcp_transport", "Bilibili MCP transport is not supported", "bilibili_transport_unavailable");
      }
    };
  }
  if (!config.endpoint) {
    return {
      config,
      async search(input = {}) {
        return unavailableServiceResult(input, "provider_not_configured", "Bilibili MCP provider is not configured", "provider_not_configured");
      }
    };
  }
  const client = options.client ?? createBilibiliMcpHttpClient({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    headers: config.headers,
    fetchImpl: options.fetchImpl
  });
  const adapter = options.adapter ?? new BilibiliMcpAdapter({
    client,
    searchToolName: config.searchToolName,
    detailToolName: config.detailToolName
  });
  const patchWindowProvider = options.patchWindowProvider ?? createOnlinePatchWindowProvider({
    fetchImpl: options.patchFetchImpl ?? options.fetchImpl,
    mode: options.patchDiscoveryMode,
    now: options.now
  }, env);
  return new BilibiliStrategyVideoService({ adapter, config, now: options.now, patchWindowProvider });
}

export const bilibiliServiceInternals = Object.freeze({ normalizePatchWindows, patchWindowContext, patchFields });
