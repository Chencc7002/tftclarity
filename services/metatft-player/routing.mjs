import { PlayerMatchError } from "./errors.mjs";

const DEFAULT_PBE_TAG_PATTERN = "^PBE[0-9]+$";
const DEFAULT_NA_TAG_PATTERN = "^NA[0-9]+$";

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function setIdForSeason(season, environment) {
  const normalized = String(season ?? "").trim().toLowerCase();
  const match = normalized.match(/^set(\d+)-(pbe|live)$/);
  if (!match || match[2] !== environment) {
    throw new PlayerMatchError(
      "UNSUPPORTED_SEASON",
      `Season ${season || "(empty)"} is not valid for ${environment}.`
    );
  }
  return `TFTSet${match[1]}`;
}

function compilePattern(source, fallback, label) {
  try {
    return new RegExp(String(source || fallback), "i");
  } catch (cause) {
    throw new PlayerMatchError(
      "INVALID_CONFIGURATION",
      `${label} is not a valid regular expression.`,
      { cause }
    );
  }
}

function resolveRoutingContext(input, options = {}) {
  const env = options.env ?? process.env;
  const gameName = String(input?.gameName ?? input?.game_name ?? "").trim();
  const tagLine = String(input?.tagLine ?? input?.tag_line ?? "")
    .trim()
    .replace(/^#/, "")
    .toUpperCase();

  if (!gameName || !tagLine) {
    throw new PlayerMatchError(
      "INVALID_PLAYER_ID",
      "gameName and tagLine are required."
    );
  }

  const pbePattern = compilePattern(
    options.pbeTagPattern ?? env.PBE_TAG_PATTERN,
    DEFAULT_PBE_TAG_PATTERN,
    "PBE_TAG_PATTERN"
  );
  const naPattern = compilePattern(
    options.naTagPattern ?? env.NA_TAG_PATTERN,
    DEFAULT_NA_TAG_PATTERN,
    "NA_TAG_PATTERN"
  );

  let environment;
  let platform;
  if (pbePattern.test(tagLine)) {
    environment = "pbe";
    platform = "PBE1";
  } else if (naPattern.test(tagLine)) {
    environment = "live";
    platform = "NA1";
  } else if (/^(PBE|NA)/i.test(tagLine)) {
    throw new PlayerMatchError(
      "INVALID_TAG_FORMAT",
      `Tag line #${tagLine} is outside the supported PBE/NA numeric format.`
    );
  } else {
    throw new PlayerMatchError(
      "UNSUPPORTED_TAG_PREFIX",
      `Tag line #${tagLine} is not supported by this MCP version.`
    );
  }

  const explicitEnvironment = String(input?.environment ?? "")
    .trim()
    .toLowerCase();
  if (explicitEnvironment && explicitEnvironment !== environment) {
    throw new PlayerMatchError(
      "ENVIRONMENT_MISMATCH",
      `Tag line #${tagLine} routes to ${environment}, not ${explicitEnvironment}.`
    );
  }

  const defaultSeason =
    environment === "pbe"
      ? options.pbeDefaultSeason ?? env.METATFT_PBE_DEFAULT_SEASON ?? "set18-pbe"
      : options.naDefaultSeason ?? env.METATFT_NA_DEFAULT_SEASON ?? "set17-live";
  const season = String(input?.season ?? defaultSeason).trim().toLowerCase();
  const expectedSet = setIdForSeason(season, environment);

  const masterEnabled = enabled(
    options.masterEnabled ?? env.METATFT_PLAYER_MATCH_ENABLED,
    false
  );
  const routeEnabled =
    environment === "pbe"
      ? enabled(options.pbeEnabled ?? env.METATFT_PBE_ENABLED, false)
      : enabled(options.naEnabled ?? env.METATFT_NA_ENABLED, false);
  if (!masterEnabled || !routeEnabled) {
    throw new PlayerMatchError(
      "PROVIDER_DISABLED",
      `${environment.toUpperCase()} MetaTFT player matches are disabled.`
    );
  }

  return Object.freeze({
    provider: "metatft",
    providerMode: "public_profile",
    gameName,
    tagLine,
    environment,
    platform,
    season,
    expectedSet,
    playerIdentity: `${gameName.toLocaleLowerCase()}#${tagLine.toLowerCase()}`
  });
}

export {
  DEFAULT_NA_TAG_PATTERN,
  DEFAULT_PBE_TAG_PATTERN,
  resolveRoutingContext,
  setIdForSeason
};
