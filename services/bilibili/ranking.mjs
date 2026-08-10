const PATCH_SCORE = Object.freeze({ current: 1, previous: 0.7, older: 0.2, unknown: 0.1 });
const PATCH_ORDER = Object.freeze({ current: 0, previous: 1, unknown: 2, older: 3 });

function finite(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/<[^>]+>/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function queryTerms(query) {
  const ignored = new Set([
    "bilibili", "b站", "视频", "攻略", "教学", "当前", "版本", "最近", "最新",
    "帮我", "给我", "找", "几个", "一个", "tft", "云顶", "云顶之弈"
  ]);
  const normalized = normalizeText(query);
  const spaced = normalized.split(/\s+/u).filter(Boolean);
  const terms = spaced.flatMap((part) => {
    if (/^[\p{Script=Han}]{3,}$/u.test(part)) {
      return [part, ...Array.from(part).filter((entry) => !ignored.has(entry))];
    }
    return [part];
  });
  return [...new Set(terms.filter((term) => term.length && !ignored.has(term)))].slice(0, 12);
}

export function relevanceScore(video, query) {
  const terms = queryTerms(query);
  if (!terms.length) return Math.max(0.2, 1 - (Number(video.searchRank ?? 1) - 1) * 0.05);
  const title = normalizeText(video.title);
  const description = normalizeText(video.description);
  let matchedWeight = 0;
  let possibleWeight = 0;
  for (const term of terms) {
    const weight = term.length > 1 ? 2 : 1;
    possibleWeight += weight * 2;
    if (title.includes(term)) matchedWeight += weight * 2;
    else if (description.includes(term)) matchedWeight += weight;
  }
  const apiRank = Math.max(0, 1 - (Number(video.searchRank ?? 1) - 1) / 20);
  return Math.min(1, (possibleWeight ? matchedWeight / possibleWeight : 0) * 0.85 + apiRank * 0.15);
}

export function classifyPatchTime(publishedAt, windows = {}) {
  const timestamp = new Date(publishedAt ?? "").getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const inWindow = (window) => {
    if (!window?.startAt) return false;
    const start = new Date(window.startAt).getTime();
    const end = window.endAt ? new Date(window.endAt).getTime() : Number.POSITIVE_INFINITY;
    const validEnd = Number.isFinite(end) || end === Number.POSITIVE_INFINITY;
    return Number.isFinite(start) && validEnd && timestamp >= start && timestamp < end;
  };
  if (inWindow(windows.current)) return "current";
  if (inWindow(windows.previous)) return "previous";
  const previousStart = new Date(windows.previous?.startAt ?? "").getTime();
  if (Number.isFinite(previousStart) && timestamp < previousStart) return "older";
  const currentStart = new Date(windows.current?.startAt ?? "").getTime();
  if (Number.isFinite(currentStart) && timestamp < currentStart) return windows.previous ? "older" : "unknown";
  return "unknown";
}

function engagementRate(numerator, views) {
  const count = finite(numerator);
  const viewCount = finite(views);
  return count === null || viewCount === null || viewCount <= 0 ? null : count / viewCount;
}

export function interactionSignals(video) {
  const viewCount = finite(video.viewCount);
  const likeRate = engagementRate(video.likeCount, viewCount);
  const favoriteRate = engagementRate(video.favoriteCount, viewCount);
  const coinRate = engagementRate(video.coinCount, viewCount);
  const replyRate = engagementRate(video.replyCount, viewCount);
  const available = [favoriteRate, coinRate, likeRate, replyRate]
    .map((value, index) => ({ value, weight: [0.45, 0.3, 0.2, 0.05][index] }))
    .filter((entry) => entry.value !== null);
  const weighted = available.length
    ? available.reduce((sum, entry) => sum + entry.value * entry.weight, 0)
      / available.reduce((sum, entry) => sum + entry.weight, 0)
    : null;
  const reliability = viewCount === null || viewCount <= 0 ? 0 : viewCount / (viewCount + 1000);
  return {
    likeRate,
    favoriteRate,
    coinRate,
    replyRate,
    interactionScore: weighted === null ? null : Math.min(1, weighted * reliability * 12),
    sampleReliability: reliability
  };
}

function recencyScore(publishedAt, now) {
  const timestamp = new Date(publishedAt ?? "").getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Number(now) - timestamp) / 86_400_000);
  return Math.exp(-ageDays / 45);
}

export function attachRankingSignals(videos, options = {}) {
  const maxViews = Math.max(1, ...videos.map((video) => finite(video.viewCount) ?? 0));
  const now = options.now ?? Date.now();
  return videos.map((video) => {
    const interaction = interactionSignals(video);
    const relevance = relevanceScore(video, options.query);
    const patch = PATCH_SCORE[video.patchTimeStatus] ?? 0.1;
    const recency = recencyScore(video.publishedAt, now);
    const popularity = video.viewCount === null || video.viewCount === undefined
      ? null
      : Math.log1p(Math.max(0, Number(video.viewCount))) / Math.log1p(maxViews);
    const total = relevance * 0.48
      + patch * 0.22
      + recency * 0.12
      + (interaction.interactionScore ?? 0.5) * 0.12
      + (popularity ?? 0.5) * 0.06;
    return {
      ...video,
      ...interaction,
      rankingSignals: {
        relevanceScore: relevance,
        patchScore: patch,
        recencyScore: recency,
        interactionScore: interaction.interactionScore,
        popularityScore: popularity,
        sampleReliability: interaction.sampleReliability,
        totalScore: total
      }
    };
  });
}

export function sortRankedVideos(videos) {
  return [...videos].sort((left, right) => (
    Number(PATCH_ORDER[left.patchTimeStatus] ?? PATCH_ORDER.unknown)
      - Number(PATCH_ORDER[right.patchTimeStatus] ?? PATCH_ORDER.unknown)
    || new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime()
    || Number(right.rankingSignals?.totalScore ?? 0) - Number(left.rankingSignals?.totalScore ?? 0)
    || Number(left.searchRank ?? 0) - Number(right.searchRank ?? 0)
  ));
}

export function selectPatchAwareResults(videos, options = {}) {
  const resultLimit = Math.max(1, Number(options.resultLimit ?? 5));
  const minCurrentResults = Math.max(1, Number(options.minCurrentResults ?? 3));
  const bucket = (status) => videos.filter((video) => video.patchTimeStatus === status);
  const current = bucket("current");
  const previous = bucket("previous");
  const older = bucket("older");
  const unknown = bucket("unknown");
  let selected;
  let fallbackType = null;
  if (current.length >= minCurrentResults) {
    selected = current;
  } else if (current.length) {
    selected = [...current, ...previous];
    if (previous.length) fallbackType = "previous_patch";
  } else if (previous.length) {
    selected = previous;
    fallbackType = "previous_patch";
  } else if (older.length) {
    selected = older;
    fallbackType = "older_patch";
  } else {
    selected = unknown;
    if (unknown.length) fallbackType = "unknown_patch";
  }
  return {
    videos: selected.slice(0, resultLimit),
    fallbackUsed: Boolean(fallbackType),
    fallbackType,
    bucketCounts: {
      current: current.length,
      previous: previous.length,
      older: older.length,
      unknown: unknown.length
    }
  };
}

export const bilibiliRankingInternals = Object.freeze({ queryTerms, normalizeText, recencyScore });
