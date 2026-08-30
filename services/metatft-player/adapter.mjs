import { PlayerMatchError } from "./errors.mjs";

const DEFAULT_PROFILE_ORIGIN = "https://api.metatft.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const MATCH_HOST_PATTERN = /^matches\d+\.metatft\.com$/i;

function valueOrNull(value) {
  return value === undefined || value === null ? null : value;
}

function isoDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function missingFields(record, fields) {
  return fields.filter((field) => {
    const value = record[field];
    return value === null || value === undefined;
  });
}

function normalizeUnit(unit = {}) {
  const normalized = {
    characterId: valueOrNull(unit.character_id ?? unit.characterId),
    starLevel: valueOrNull(unit.tier ?? unit.starLevel),
    items: Array.isArray(unit.itemNames)
      ? [...unit.itemNames]
      : Array.isArray(unit.items)
        ? [...unit.items]
        : []
  };
  normalized.missingFields = missingFields(normalized, [
    "characterId",
    "starLevel"
  ]);
  return normalized;
}

function normalizeTrait(trait) {
  if (typeof trait === "string") return { id: trait };
  if (!trait || typeof trait !== "object") return { id: null };
  return {
    id: valueOrNull(trait.name ?? trait.id ?? trait.trait_id),
    units: valueOrNull(trait.num_units ?? trait.units),
    style: valueOrNull(trait.style),
    tierCurrent: valueOrNull(trait.tier_current),
    tierTotal: valueOrNull(trait.tier_total)
  };
}

function validateMatchIdentity(match, context) {
  const matchId = String(match?.riot_match_id ?? match?.matchId ?? "").trim();
  if (!matchId) {
    throw new PlayerMatchError("DATA_INCOMPLETE", "Match ID is missing.");
  }
  if (!matchId.startsWith(`${context.platform}_`)) {
    throw new PlayerMatchError(
      "ENVIRONMENT_MISMATCH",
      `Match ${matchId} does not belong to ${context.platform}.`
    );
  }
  return matchId;
}

function normalizeMatchSummary(match, context) {
  const matchId = validateMatchIdentity(match, context);
  if (match.tft_set !== context.expectedSet) {
    throw new PlayerMatchError(
      "ENVIRONMENT_MISMATCH",
      `Match ${matchId} belongs to ${match.tft_set || "an unknown set"}, not ${context.expectedSet}.`
    );
  }

  const summary = match.summary && typeof match.summary === "object"
    ? match.summary
    : {};
  const normalized = {
    matchId,
    playedAt: isoDate(match.match_timestamp),
    placement: valueOrNull(match.placement),
    level: valueOrNull(summary.level),
    set: match.tft_set,
    patch: valueOrNull(match.patch),
    queue: {
      id: valueOrNull(match.queue_id),
      ratingId: valueOrNull(match.rating_queue_id)
    },
    durationSeconds: valueOrNull(match.game_duration),
    lastRound: valueOrNull(summary.last_round),
    units: Array.isArray(summary.units) ? summary.units.map(normalizeUnit) : [],
    traits: Array.isArray(summary.traits)
      ? summary.traits.map(normalizeTrait)
      : [],
    augments: Array.isArray(summary.augments) ? [...summary.augments] : null
  };
  normalized.missingFields = missingFields(normalized, [
    "playedAt",
    "placement",
    "level",
    "set",
    "patch",
    "durationSeconds",
    "lastRound",
    "augments"
  ]);
  if (!Array.isArray(summary.units)) normalized.missingFields.push("units");
  if (!Array.isArray(summary.traits)) normalized.missingFields.push("traits");
  return normalized;
}

function normalizeParticipant(participant, context, matchId) {
  const gameName = String(
    participant?.riotIdGameName ??
      participant?.riot_id_game_name ??
      participant?.game_name ??
      ""
  );
  const tagLine = String(
    participant?.riotIdTagline ??
      participant?.riot_id_tagline ??
      participant?.tag_line ??
      ""
  );
  if (
    gameName.localeCompare(context.gameName, undefined, { sensitivity: "accent" }) !== 0 ||
    tagLine.localeCompare(context.tagLine, undefined, { sensitivity: "accent" }) !== 0
  ) {
    return null;
  }

  const normalized = {
    matchId,
    placement: valueOrNull(participant.placement),
    level: valueOrNull(participant.level),
    lastRound: valueOrNull(participant.last_round),
    timeEliminatedSeconds: valueOrNull(participant.time_eliminated),
    playersEliminated: valueOrNull(participant.players_eliminated),
    totalDamageToPlayers: valueOrNull(participant.total_damage_to_players),
    units: Array.isArray(participant.units)
      ? participant.units.map(normalizeUnit)
      : [],
    traits: Array.isArray(participant.traits)
      ? participant.traits.map(normalizeTrait)
      : [],
    augments: Array.isArray(participant.augments)
      ? [...participant.augments]
      : null
  };
  normalized.missingFields = missingFields(normalized, [
    "placement",
    "level",
    "lastRound",
    "timeEliminatedSeconds",
    "playersEliminated",
    "totalDamageToPlayers",
    "augments"
  ]);
  if (!Array.isArray(participant.units)) normalized.missingFields.push("units");
  if (!Array.isArray(participant.traits)) normalized.missingFields.push("traits");
  return normalized;
}

function validatedMatchUrl(rawUrl, matchId) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PlayerMatchError("SOURCE_CHANGED", "Match detail URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !MATCH_HOST_PATTERN.test(url.hostname) ||
    url.pathname !== `/${encodeURIComponent(matchId)}.json` ||
    url.search ||
    url.hash
  ) {
    throw new PlayerMatchError(
      "SOURCE_CHANGED",
      "Match detail URL failed the MetaTFT allowlist check."
    );
  }
  return url;
}

function createMetaTftAdapter(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const profileOrigin = options.profileOrigin ?? DEFAULT_PROFILE_ORIGIN;
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function fetchJson(url, label, { redirect = "follow", method = "GET", requestTimeoutMs = timeoutMs } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        method,
        redirect,
        signal: AbortSignal.timeout(Math.max(1, requestTimeoutMs))
      });
    } catch (cause) {
      const timeout = cause?.name === "TimeoutError" || cause?.name === "AbortError";
      throw new PlayerMatchError(
        timeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        `${label} could not be loaded.`,
        { cause, retryable: true }
      );
    }

    if (response.status === 404) {
      throw new PlayerMatchError("PLAYER_OR_MATCH_NOT_FOUND", `${label} was not found.`, {
        status: 404
      });
    }
    if (response.status === 429) {
      throw new PlayerMatchError("RATE_LIMITED", "MetaTFT rate limit was reached.", {
        status: 429,
        retryable: true
      });
    }
    if (!response.ok) {
      throw new PlayerMatchError(
        "UPSTREAM_UNAVAILABLE",
        `MetaTFT returned HTTP ${response.status}.`,
        { status: response.status, retryable: response.status >= 500 }
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new PlayerMatchError("SOURCE_CHANGED", `${label} is no longer JSON.`);
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new PlayerMatchError("SOURCE_CHANGED", `${label} returned invalid JSON.`, {
        cause
      });
    }
  }

  async function fetchProfile(context, { forceRefresh = false } = {}) {
    // lookup_by_riotid reads MetaTFT's stored profile. Its public UI explicitly
    // POSTs refresh_by_riotid, polls completion, then reads the profile again.
    // Bound the entire refresh to the existing request timeout, including polls.
    const deadline = Date.now() + timeoutMs;
    if (forceRefresh) {
      const refreshUrl = new URL(
        `/public/profile/refresh_by_riotid/${context.platform}/${encodeURIComponent(context.gameName)}/${encodeURIComponent(context.tagLine)}`,
        profileOrigin
      );
      refreshUrl.searchParams.set("source", "full_profile");
      refreshUrl.searchParams.set("tier", "1");
      refreshUrl.searchParams.set("tft_set", context.expectedSet);
      refreshUrl.searchParams.set("include_revival_matches", "true");
      let status = await fetchJson(refreshUrl, "Player profile refresh", { method: "POST", requestTimeoutMs: deadline - Date.now() });
      const attempts = 3;
      for (let attempt = 0; attempt < attempts && status?.status !== "completed"; attempt += 1) {
        if (status?.status === "error" || status?.Error || status?.error) {
          throw new PlayerMatchError("UPSTREAM_UNAVAILABLE", "MetaTFT profile refresh failed.", { retryable: true });
        }
        const delay = Number(options.refreshPollDelayMs ?? 500) * (attempt + 1);
        if (deadline - Date.now() <= delay) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        status = await fetchJson(refreshUrl, "Player profile refresh status", { requestTimeoutMs: deadline - Date.now() });
      }
      if (status?.status === "error" || status?.Error || status?.error) {
        throw new PlayerMatchError("UPSTREAM_UNAVAILABLE", "MetaTFT profile refresh failed.", { retryable: true });
      }
      if (status?.status !== "completed") {
        throw new PlayerMatchError("REFRESH_PENDING", "MetaTFT 对局仍在更新队列中，请稍后重试；本次未将旧样本标记为已更新。", { retryable: true });
      }
    }
    const url = new URL(
      `/public/profile/lookup_by_riotid/${context.platform}/${encodeURIComponent(context.gameName)}/${encodeURIComponent(context.tagLine)}`,
      profileOrigin
    );
    url.searchParams.set("source", "full_profile");
    url.searchParams.set("tft_set", context.expectedSet);
    url.searchParams.set("include_revival_matches", "true");
    const body = await fetchJson(url, "Player profile", { requestTimeoutMs: forceRefresh ? deadline - Date.now() : timeoutMs });
    if (!Array.isArray(body?.matches)) {
      throw new PlayerMatchError("SOURCE_CHANGED", "Player profile matches are missing.");
    }
    return body;
  }

  function normalizeProfile(profile, context) {
    const allMatches = profile.matches;
    const wrongSeasonCount = allMatches.filter(
      (match) => match?.tft_set !== context.expectedSet
    ).length;
    if (context.environment === "pbe" && wrongSeasonCount > 0) {
      throw new PlayerMatchError(
        "ENVIRONMENT_MISMATCH",
        "PBE response contained matches outside the requested season."
      );
    }
    const selected = allMatches.filter(
      (match) => match?.tft_set === context.expectedSet
    );
    const summaries = selected
      .map((match) => normalizeMatchSummary(match, context))
      .sort((left, right) => {
        const leftTime = left.playedAt ? Date.parse(left.playedAt) : 0;
        const rightTime = right.playedAt ? Date.parse(right.playedAt) : 0;
        return rightTime - leftTime || right.matchId.localeCompare(left.matchId);
      });
    const warnings = [];
    if (wrongSeasonCount > 0) {
      warnings.push(`filtered_${wrongSeasonCount}_matches_outside_${context.season}`);
    }
    return { summaries, warnings, observedUpstreamCount: allMatches.length };
  }

  async function fetchMatchDetail(context, matchId, rawUrl) {
    if (!String(matchId).startsWith(`${context.platform}_`)) {
      throw new PlayerMatchError(
        "ENVIRONMENT_MISMATCH",
        `Match ${matchId} does not belong to ${context.platform}.`
      );
    }
    const url = validatedMatchUrl(rawUrl, matchId);
    const body = await fetchJson(url, "Match detail", { redirect: "manual" });
    const info = body?.info;
    if (!info || !Array.isArray(info.participants)) {
      throw new PlayerMatchError("SOURCE_CHANGED", "Match participants are missing.");
    }
    const detailSet = String(info.tft_set_core_name ?? "");
    const detailSetNumber = Number(info.tft_set_number);
    const expectedNumber = Number(context.expectedSet.replace("TFTSet", ""));
    if (
      (detailSet && detailSet !== context.expectedSet) ||
      (Number.isFinite(detailSetNumber) && detailSetNumber !== expectedNumber)
    ) {
      throw new PlayerMatchError(
        "ENVIRONMENT_MISMATCH",
        `Match ${matchId} detail does not belong to ${context.expectedSet}.`
      );
    }
    const participant = info.participants
      .map((entry) => normalizeParticipant(entry, context, matchId))
      .find(Boolean);
    if (!participant) {
      throw new PlayerMatchError(
        "DATA_INCOMPLETE",
        "Requested player is missing from match detail."
      );
    }
    return {
      ...participant,
      playedAt: isoDate(info.gameCreation ?? info.game_datetime),
      durationSeconds: valueOrNull(info.game_length),
      gameVersion: valueOrNull(info.game_version),
      queueId: valueOrNull(info.queueId ?? info.queue_id),
      set: context.expectedSet,
      participantCount: info.participants.length
    };
  }

  return {
    fetchProfile,
    normalizeProfile,
    fetchMatchDetail
  };
}

export {
  createMetaTftAdapter,
  normalizeMatchSummary,
  validatedMatchUrl
};
