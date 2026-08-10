const DEFAULT_TFT_PATCH_SOURCE = "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/";
const DEFAULT_GOLDEN_PATCH_SOURCE = "https://newgame.17173.com/game-newslist-4075117.html";

function finiteDate(value) {
  const timestamp = new Date(value ?? "").getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function uniqueEntries(entries) {
  const byPatch = new Map();
  for (const entry of entries) {
    const patchId = String(entry?.patchId ?? "").trim();
    const startAt = finiteDate(entry?.startAt);
    if (!patchId || !startAt) continue;
    const existing = byPatch.get(patchId);
    if (!existing || new Date(startAt).getTime() > new Date(existing.startAt).getTime()) {
      byPatch.set(patchId, { patchId, startAt });
    }
  }
  return [...byPatch.values()].sort((left, right) => (
    new Date(right.startAt).getTime() - new Date(left.startAt).getTime()
  ));
}

function toPatchContext(entries, sourceUrl) {
  const ordered = uniqueEntries(entries);
  const windows = ordered.map((entry, index) => ({
    ...entry,
    endAt: index === 0 ? null : ordered[index - 1].startAt
  }));
  return {
    currentPatch: windows[0]?.patchId ?? null,
    previousPatch: windows[1]?.patchId ?? null,
    windows,
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

export function parseRiotTftPatchEntries(html) {
  const text = String(html ?? "");
  const entries = [];
  const cardPattern = /aria-label="Teamfight Tactics patch\s+([0-9]+\.[0-9]+[a-z]?)"[\s\S]{0,2600}?<time\s+dateTime="([^"]+)"/giu;
  for (const match of text.matchAll(cardPattern)) {
    entries.push({ patchId: match[1], startAt: match[2] });
  }
  const jsonPattern = /"title":"Teamfight Tactics patch\s+([0-9]+\.[0-9]+[a-z]?)(?:\s+notes)?"[\s\S]{0,2200}?"publishedAt":"([^"]+)"/giu;
  for (const match of text.matchAll(jsonPattern)) {
    entries.push({ patchId: match[1], startAt: match[2] });
  }
  return uniqueEntries(entries);
}

function inferredYear(month, now) {
  const current = new Date(now);
  let year = current.getUTCFullYear();
  if (month > current.getUTCMonth() + 2) year -= 1;
  return year;
}

export function parseGoldenSpatulaPatchEntries(html, now = Date.now()) {
  const text = String(html ?? "")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ");
  const entries = [];
  const fullDatePattern = /(?:《金铲铲之战》)?\s*([0-9]+\.[0-9]+[a-z]?)\s*版本[^<]{0,80}?([0-9]{4})[-年\/\.]([0-9]{1,2})[-月\/\.]([0-9]{1,2})日?/giu;
  for (const match of text.matchAll(fullDatePattern)) {
    entries.push({
      patchId: match[1],
      startAt: Date.UTC(Number(match[2]), Number(match[3]) - 1, Number(match[4]), 4)
    });
  }
  const titleDatePattern = /(?:《金铲铲之战》)?\s*([0-9]+\.[0-9]+[a-z]?)\s*版本\s*([0-9]{1,2})月([0-9]{1,2})日更新公告/giu;
  for (const match of text.matchAll(titleDatePattern)) {
    const month = Number(match[2]);
    entries.push({
      patchId: match[1],
      startAt: Date.UTC(inferredYear(month, now), month - 1, Number(match[3]), 4)
    });
  }
  return uniqueEntries(entries);
}

async function fetchText(fetchImpl, url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "text/html,application/json", ...headers }
    });
    if (!response.ok) throw new Error(`patch source returned HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function createOnlinePatchWindowProvider(options = {}, env = process.env) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const mode = String(options.mode ?? env.BILIBILI_PATCH_DISCOVERY_MODE ?? "auto").trim().toLowerCase();
  if (["off", "false", "0", "disabled"].includes(mode)) return null;
  const timeoutMs = Math.max(500, Math.min(15_000, Number(options.timeoutMs ?? env.BILIBILI_PATCH_DISCOVERY_TIMEOUT_MS ?? 5000)));
  const ttlMs = Math.max(60_000, Number(options.ttlMs ?? env.BILIBILI_PATCH_DISCOVERY_TTL_MS ?? 6 * 60 * 60 * 1000));
  const sources = {
    tft_pc: String(options.tftSourceUrl ?? env.BILIBILI_TFT_PATCH_SOURCE_URL ?? DEFAULT_TFT_PATCH_SOURCE),
    golden_spatula: String(options.goldenSourceUrl ?? env.BILIBILI_GOLDEN_SPATULA_PATCH_SOURCE_URL ?? DEFAULT_GOLDEN_PATCH_SOURCE)
  };
  const cache = new Map();
  return {
    async resolve(ecosystem) {
      const key = ecosystem === "golden_spatula" ? "golden_spatula" : "tft_pc";
      const cached = cache.get(key);
      if (cached && Date.now() - cached.cachedAt < ttlMs) return cached.value;
      const url = sources[key];
      const html = await fetchText(fetchImpl, url, timeoutMs);
      const entries = key === "golden_spatula"
        ? parseGoldenSpatulaPatchEntries(html, options.now?.() ?? Date.now())
        : parseRiotTftPatchEntries(html);
      if (entries.length < 2) throw new Error(`patch source did not expose two ${key} releases`);
      const value = toPatchContext(entries, url);
      cache.set(key, { cachedAt: Date.now(), value });
      return value;
    }
  };
}

export const patchWindowProviderDefaults = Object.freeze({
  tftSourceUrl: DEFAULT_TFT_PATCH_SOURCE,
  goldenSourceUrl: DEFAULT_GOLDEN_PATCH_SOURCE
});
