export const SEASON_PROVIDER_OPERATIONS = Object.freeze([
  "getCatalog",
  "getCompRankings",
  "getItemStats",
  "getUnitStats"
]);

export class SeasonProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SeasonProviderError";
    this.code = options.code ?? "season_provider_error";
    this.providerId = options.providerId ?? null;
    this.seasonContextId = options.seasonContextId ?? null;
  }
}

export class SeasonDataProvider {
  constructor({ id }) {
    if (!String(id ?? "").trim()) throw new TypeError("SeasonDataProvider requires a stable id");
    this.id = String(id).trim();
  }

  getAvailability() {
    throw this.notImplemented("getAvailability");
  }

  async getCatalog(context) {
    throw this.notImplemented("getCatalog", context);
  }

  async getCompRankings(context) {
    throw this.notImplemented("getCompRankings", context);
  }

  async getItemStats(context) {
    throw this.notImplemented("getItemStats", context);
  }

  async getUnitStats(context) {
    throw this.notImplemented("getUnitStats", context);
  }

  notImplemented(operation, context = null) {
    return new SeasonProviderError(`${this.id}.${operation} is not implemented`, {
      code: "season_provider_not_implemented",
      providerId: this.id,
      seasonContextId: context?.id
    });
  }
}

export class UnavailableSeasonProvider extends SeasonDataProvider {
  constructor(options) {
    super(options);
    this.status = options.status ?? "coming_soon";
    this.reason = options.reason ?? "Provider has not been verified";
    this.health = Object.freeze({
      status: options.healthStatus ?? "not_verified",
      lastCheckedAt: null,
      lastSuccessfulSyncAt: null,
      catalogStatus: "not_synced"
    });
  }

  getAvailability() {
    return {
      available: false,
      status: this.status,
      reason: this.reason,
      health: { ...this.health }
    };
  }

  unavailable(operation, context) {
    return new SeasonProviderError(`${this.id} is unavailable; ${operation} was not attempted`, {
      code: "season_provider_unavailable",
      providerId: this.id,
      seasonContextId: context?.id
    });
  }

  async getCatalog(context) {
    throw this.unavailable("getCatalog", context);
  }

  async getCompRankings(context) {
    throw this.unavailable("getCompRankings", context);
  }

  async getItemStats(context) {
    throw this.unavailable("getItemStats", context);
  }

  async getUnitStats(context) {
    throw this.unavailable("getUnitStats", context);
  }
}

export function createPbeProviderPlaceholder(options = {}) {
  return new UnavailableSeasonProvider({
    id: "metatft-pbe",
    status: "coming_soon",
    reason: "PBE provider interface and catalog have not been verified",
    healthStatus: "not_verified",
    ...options
  });
}
