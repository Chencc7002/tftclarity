export const OFFICIAL_TFT_NEWS_URL = "https://teamfighttactics.leagueoflegends.com/en-us/news/";

export const PATCH_RESOLVER_CACHE_KEY = "current_patch";

export function parseLatestTftPatch(html) {
  const mentions = [...String(html ?? "").matchAll(/\b\d{1,2}\.\d+\b/g)]
    .map((match) => match[0])
    // Riot patch majors follow the calendar-year range. Ignore unrelated decimal
    // values from page markup and asset metadata (for example, "62.5").
    .filter((patch) => {
      const major = Number(patch.split(".")[0]);
      return major >= 10 && major <= 30;
    });
  if (!mentions.length) return null;
  return mentions.sort((left, right) => {
    const [leftMajor, leftMinor] = left.split(".").map(Number);
    const [rightMajor, rightMinor] = right.split(".").map(Number);
    return rightMajor - leftMajor || rightMinor - leftMinor;
  })[0];
}

export async function resolveLatestTftPatch(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const timeoutMs = Math.max(500, Number(options.timeoutMs ?? 5000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(options.url ?? OFFICIAL_TFT_NEWS_URL, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });
    if (!response?.ok) return null;
    return parseLatestTftPatch(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function previousPatchFor(currentPatch, fallback = null) {
  const match = String(currentPatch ?? "").match(/^(\d+)\.(\d+)$/u);
  if (!match) return fallback;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (!Number.isInteger(minor) || minor <= 1) return fallback;
  return `${major}.${minor - 1}`;
}

export function createPatchResolver(options = {}) {
  const ttlMs = Math.max(60_000, Number(options.ttlMs ?? 6 * 60 * 60 * 1000));
  let state = {
    currentPatch: options.configuredPatch ?? null,
    previousPatch: options.previousPatch ?? null,
    source: options.configuredPatch ? "configured" : "season_context",
    resolvedAt: null
  };
  let inFlight = null;

  const resolve = async () => {
    const resolved = await resolveLatestTftPatch({
      fetchImpl: options.fetchImpl,
      url: options.url,
      timeoutMs: options.timeoutMs
    });
    if (!resolved) return null;
    const previous = previousPatchFor(resolved, options.previousPatch);
    return {
      currentPatch: resolved,
      previousPatch: previous,
      source: "official_riot_news",
      resolvedAt: new Date().toISOString()
    };
  };

  return {
    state() {
      return { ...state };
    },
    async refresh() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const next = await resolve();
        if (next) state = next;
        return { ...state };
      })();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
    async ensureFresh() {
      if (
        state.source === "official_riot_news"
        && state.resolvedAt
        && Date.now() - Date.parse(state.resolvedAt) < ttlMs
      ) {
        return { ...state };
      }
      if (options.configuredPatch) return { ...state };
      return this.refresh();
    }
  };
}
