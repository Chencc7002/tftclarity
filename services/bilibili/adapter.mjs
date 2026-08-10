import { parseMcpPayload } from "./mcp-client.mjs";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function first(value, paths) {
  for (const path of paths) {
    const result = path.split(".").reduce((current, key) => current?.[key], value);
    if (result !== undefined && result !== null && result !== "") return result;
  }
  return null;
}

function number(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/gu, "").trim();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([万亿]?)$/u);
  if (!match) return null;
  const multiplier = match[2] === "万" ? 10_000 : match[2] === "亿" ? 100_000_000 : 1;
  return Number(match[1]) * multiplier;
}

function isoDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" || /^\d{10,13}$/u.test(String(value))) {
    const numeric = Number(value);
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publishedPrecision(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? "").trim()) ? "day" : value ? "instant" : null;
}

function durationSeconds(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parts = String(value ?? "").split(":").map(Number);
  if (!parts.length || parts.some((entry) => !Number.isFinite(entry))) return null;
  return parts.reduce((total, entry) => total * 60 + entry, 0);
}

function payloadArray(payloads) {
  for (const payload of payloads) {
    if (Array.isArray(payload)) return payload;
    const candidate = first(payload, ["items", "data", "results", "result", "list", "videos"]);
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function payloadObject(payloads) {
  for (const payload of payloads) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return object(payload.data ?? payload.result ?? payload);
    }
  }
  return {};
}

function videoId(value) {
  const id = first(value, ["videoId", "video_id", "bvid", "bv_id", "aid", "id"]);
  if (id === null) return null;
  const text = String(id).trim();
  if (!text) return null;
  if (/^BV[A-Za-z0-9]{10}$/u.test(text) || /^av\d+$/iu.test(text)) return text;
  return /^\d+$/u.test(text) ? `av${text}` : text;
}

function urlFor(value, id) {
  const url = first(value, ["url", "arcurl", "short_link_v2"]);
  if (url) return String(url);
  return id ? `https://www.bilibili.com/video/${id}` : null;
}

function normalizeSearchCandidate(value, index) {
  const id = videoId(value);
  const publishedValue = first(value, ["publishedAt", "publish_date", "pubdate", "created_at"]);
  const searchViewCount = number(first(value, ["searchViewCount", "viewCount", "play_count", "play", "stat.view"]));
  return {
    source: "bilibili",
    videoId: id,
    url: urlFor(value, id),
    title: String(first(value, ["title", "name"]) ?? "").replace(/<[^>]+>/gu, "").trim(),
    authorName: first(value, ["authorName", "author", "owner.name", "uploader.name"]),
    authorId: first(value, ["authorId", "mid", "owner.mid", "uploader.id"]),
    description: first(value, ["description", "desc", "summary"]),
    coverUrl: first(value, ["coverUrl", "pic", "cover", "thumbnail"]),
    authorAvatarUrl: first(value, ["authorAvatarUrl", "upic", "owner.face"]),
    publishedAt: isoDate(publishedValue),
    publishedDate: isoDate(publishedValue)?.slice(0, 10) ?? null,
    publishedPrecision: publishedPrecision(publishedValue),
    durationSeconds: durationSeconds(first(value, ["durationSeconds", "duration"])),
    searchViewCount,
    detailViewCount: null,
    viewCount: searchViewCount,
    viewCountSource: searchViewCount === null ? null : "search",
    tags: first(value, ["tags", "tag", "tname"]),
    searchRank: index + 1,
    raw: value
  };
}

function normalizeDetail(value, requestedVideoId) {
  const id = videoId(value) ?? requestedVideoId;
  const publishedValue = first(value, ["publishedAt", "publish_date", "pubdate", "create_time"]);
  const detailViewCount = number(first(value, ["detailViewCount", "viewCount", "play_count", "stat.view"]));
  return {
    source: "bilibili",
    videoId: id,
    url: urlFor(value, id),
    title: first(value, ["title", "name"]),
    description: first(value, ["description", "desc", "summary"]),
    authorName: first(value, ["authorName", "author", "owner.name"]),
    authorId: first(value, ["authorId", "mid", "owner.mid"]),
    coverUrl: first(value, ["coverUrl", "pic", "cover"]),
    publishedAt: isoDate(publishedValue),
    publishedDate: isoDate(publishedValue)?.slice(0, 10) ?? null,
    publishedPrecision: publishedPrecision(publishedValue),
    durationSeconds: durationSeconds(first(value, ["durationSeconds", "duration"])),
    detailViewCount,
    viewCount: detailViewCount,
    viewCountSource: detailViewCount === null ? null : "detail",
    likeCount: number(first(value, ["likeCount", "like", "stat.like"])),
    favoriteCount: number(first(value, ["favoriteCount", "favorite", "stat.favorite"])),
    coinCount: number(first(value, ["coinCount", "coin", "stat.coin"])),
    replyCount: number(first(value, ["replyCount", "reply", "stat.reply"])),
    danmakuCount: number(first(value, ["danmakuCount", "danmaku", "stat.danmaku"])),
    shareCount: number(first(value, ["shareCount", "share", "stat.share"])),
    raw: value
  };
}

export class BilibiliMcpAdapter {
  constructor(options = {}) {
    if (typeof options.client?.callTool !== "function") {
      throw new TypeError("BilibiliMcpAdapter requires an MCP client");
    }
    this.client = options.client;
    this.searchToolName = options.searchToolName ?? "bilibili-search-summary";
    this.detailToolName = options.detailToolName ?? "bilibili-video-detail";
  }

  async searchVideos(input, context = {}) {
    const result = await this.client.callTool(this.searchToolName, {
      keyword: input.query,
      page: input.page ?? 1,
      limit: input.limit
    }, context);
    const parsed = parseMcpPayload(result);
    if (parsed.candidates.length === 0 && parsed.warnings.length > 0) {
      const error = new Error("Bilibili MCP search response did not contain readable structured data");
      error.code = "bilibili_mcp_schema_error";
      throw error;
    }
    const requestedLimit = Number(input.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, requestedLimit)) : 20;
    return {
      videos: payloadArray(parsed.candidates).map(normalizeSearchCandidate).slice(0, limit),
      warnings: parsed.warnings,
      toolName: this.searchToolName
    };
  }

  async getVideoDetail(input, context = {}) {
    const result = await this.client.callTool(this.detailToolName, {
      videoId: input.videoId
    }, context);
    const parsed = parseMcpPayload(result);
    if (parsed.candidates.length === 0 && parsed.warnings.length > 0) {
      const error = new Error("Bilibili MCP detail response did not contain readable structured data");
      error.code = "bilibili_mcp_schema_error";
      throw error;
    }
    return {
      video: normalizeDetail(payloadObject(parsed.candidates), input.videoId),
      warnings: parsed.warnings,
      toolName: this.detailToolName
    };
  }
}

export const bilibiliAdapterInternals = Object.freeze({
  number,
  isoDate,
  durationSeconds,
  publishedPrecision,
  normalizeSearchCandidate,
  normalizeDetail
});
