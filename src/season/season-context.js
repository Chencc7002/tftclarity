export const DEFAULT_SEASON_CONTEXT_ID = "set17-live";

const CONTEXTS = [
  {
    id: DEFAULT_SEASON_CONTEXT_ID,
    label: "Set 17 · 正式服",
    season: 17,
    environment: "live",
    mode: "standard",
    status: "live",
    visible: true,
    selectable: true,
    isDefault: true,
    catalogNamespace: DEFAULT_SEASON_CONTEXT_ID,
    source: {
      provider: "metatft-live",
      providerVersion: "metatft-live.v1",
      queue: "1100",
      patchPolicy: "latest",
      currentPatch: "17.7",
      previousPatch: "17.6"
    },
    themeId: "set17",
    theme: {
      documentTitle: "TFTClarity｜云顶数据智答",
      subtitle: {
        "zh-CN": "星神",
        "en-US": "Cosmic"
      },
      colors: {
        primary: "#6b63df",
        secondary: "#34b9d6"
      },
      wallpaper: {
        seasonId: "set-17",
        directory: "/assets/wallpapers/set-17/",
        defaultId: "set17-stargazer-convergence"
      },
      particles: {
        density: 1,
        speed: 1
      },
      patchNoteVersion: "17.7",
      quickQuestions: {
        "zh-CN": ["推荐当前版本热门阵容", "当前版本阵容趋势"],
        "en-US": ["Recommend popular comps in the current patch", "Show current comp trends"]
      },
      riskNotice: null
    },
    notices: []
  },
  {
    id: "set18-pbe",
    label: "Set 18 · PBE · 18.1",
    season: 18,
    environment: "pbe",
    mode: "standard",
    status: "pbe",
    visible: true,
    selectable: true,
    themePreview: false,
    isDefault: false,
    catalogNamespace: "set18-pbe",
    source: {
      provider: "metatft-pbe",
      providerVersion: "metatft-pbe.v1",
      pageUrl: "https://www.metatft.com/pbe-comps",
      explorerUrl: "https://www.metatft.com/explorer?set=TFTSet18",
      queue: "PBE",
      patchPolicy: "latest",
      currentPatch: "18.1",
      explorerPatch: "current",
      compsPatch: "18.1",
      tftSet: "TFTSet18",
      lookupChannel: "pbe",
      lookupLocale: "zh_cn",
      requestDeadlineMs: 20000
    },
    themeId: "set18",
    theme: {
      documentTitle: "TFTClarity｜云顶数据智答",
      subtitle: {
        "zh-CN": "S18 PBE · 18.1",
        "en-US": "Set 18 PBE · 18.1"
      },
      colors: {
        primary: "#356b43",
        secondary: "#48b8c7"
      },
      wallpaper: {
        seasonId: "set-18-pbe",
        directory: "/assets/wallpapers/set-18/",
        defaultId: "set18-verdant-realm"
      },
      particles: {
        density: 0.62,
        speed: 0.62,
        tones: ["214,239,160", "121,221,197", "239,211,116"]
      },
      patchNoteVersion: null,
      quickQuestions: {
        "zh-CN": ["当前有什么稳定阵容？", "当前版本阵容趋势", "阿狸最好的三件装备是什么"],
        "en-US": ["What comps are stable right now?", "Show current comp trends", "What are Ahri's best three items?"]
      },
      riskNotice: {
        "zh-CN": "S18 PBE 数据已开放；测试服内容和统计会频繁变化，结果仅供当前版本参考。",
        "en-US": "Set 18 PBE data is available. Test-realm content and statistics can change frequently."
      }
    },
    notices: ["S18 PBE 数据已开放；测试服内容和统计会频繁变化。"]
  }
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const SEASON_CONTEXTS = deepFreeze(CONTEXTS.map((context) => ({ ...context })));

export function normalizeSeasonContextId(value, fallback = DEFAULT_SEASON_CONTEXT_ID) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clone(value) {
  return structuredClone(value);
}

export class SeasonContextError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SeasonContextError";
    this.code = options.code ?? "invalid_season_context";
    this.statusCode = options.statusCode ?? 400;
    this.contextStatus = options.contextStatus ?? null;
    this.seasonContextId = options.seasonContextId ?? null;
  }
}

export class SeasonContextService {
  constructor(options = {}) {
    const contexts = options.contexts ?? SEASON_CONTEXTS;
    this.contexts = new Map(contexts.map((context) => [context.id, deepFreeze(clone(context))]));
    this.providerAvailability = new Map(Object.entries({
      "metatft-live": {
        available: true,
        status: "available",
        health: {
          status: "ready",
          lastCheckedAt: null,
          lastSuccessfulSyncAt: null,
          catalogStatus: "runtime_managed"
        }
      },
      "metatft-pbe": {
        available: true,
        status: "available",
        health: {
          status: "ready",
          lastCheckedAt: null,
          lastSuccessfulSyncAt: null,
          catalogStatus: "runtime_managed"
        }
      },
      ...(options.providerAvailability ?? {})
    }));
    const defaults = [...this.contexts.values()].filter((context) => context.isDefault);
    if (defaults.length !== 1) throw new Error("SeasonContext registry requires exactly one default context");
    this.defaultContextId = defaults[0].id;
  }

  listVisible() {
    return [...this.contexts.values()].filter((context) => context.visible).map(clone);
  }

  get(contextId) {
    const context = this.contexts.get(normalizeSeasonContextId(contextId, this.defaultContextId));
    return context ? clone(context) : null;
  }

  getDefault() {
    return this.get(this.defaultContextId);
  }

  getAvailability(context) {
    const state = this.providerAvailability.get(context.source.provider);
    if (!state) {
      return { available: false, status: "unavailable", reason: "Provider is not registered" };
    }
    if (typeof state === "function") return state(clone(context));
    return { ...state };
  }

  resolve(contextId, options = {}) {
    const id = normalizeSeasonContextId(contextId, this.defaultContextId);
    const context = this.contexts.get(id);
    if (!context || (options.requireVisible !== false && !context.visible)) {
      throw new SeasonContextError("赛季空间不存在或不可见", {
        code: "season_context_not_found",
        statusCode: 404,
        seasonContextId: id
      });
    }
    if (context.status === "archived") {
      throw new SeasonContextError("该赛季空间已归档，无法查询", {
        code: "season_context_archived",
        statusCode: 409,
        contextStatus: context.status,
        seasonContextId: id
      });
    }
    if (options.requireSelectable !== false && !context.selectable) {
      throw new SeasonContextError(
        context.status === "coming_soon" ? "该赛季数据准备中，暂不可查询" : "该赛季空间当前不可选择",
        {
          code: context.status === "coming_soon" ? "season_context_coming_soon" : "season_context_not_selectable",
          statusCode: 409,
          contextStatus: context.status,
          seasonContextId: id
        }
      );
    }
    const availability = this.getAvailability(context);
    if (options.requireAvailable !== false && !availability.available) {
      throw new SeasonContextError("该赛季数据提供者当前不可用", {
        code: availability.status === "coming_soon" ? "season_context_coming_soon" : "season_context_unavailable",
        statusCode: 503,
        contextStatus: availability.status ?? "unavailable",
        seasonContextId: id
      });
    }
    return {
      ...clone(context),
      availability,
      effectivePatch: context.source.patchPolicy === "latest" ? "current" : null,
      currentPatch: context.source.currentPatch ?? null,
      previousPatch: context.source.previousPatch ?? null,
      providerPatch: context.source.patchPolicy === "latest" ? "current" : null
    };
  }

  resolveForQuery(contextId) {
    return this.resolve(contextId, {
      requireVisible: true,
      requireSelectable: true,
      requireAvailable: true
    });
  }

  resolveForSelection(contextId) {
    const context = this.resolve(contextId, {
      requireVisible: true,
      requireSelectable: false,
      requireAvailable: false
    });
    if (!context.selectable && !context.themePreview) {
      throw new SeasonContextError("该赛季空间当前不可选择", {
        code: "season_context_not_selectable",
        statusCode: 409,
        contextStatus: context.status,
        seasonContextId: context.id
      });
    }
    return context;
  }

  publicRecord(context) {
    const availability = this.getAvailability(context);
    return {
      id: context.id,
      label: context.label,
      season: context.season,
      environment: context.environment,
      mode: context.mode,
      status: context.status,
      visible: context.visible,
      selectable: context.selectable && Boolean(availability.available),
      themePreview: Boolean(context.themePreview),
      isDefault: context.isDefault,
      currentPatch: context.source?.currentPatch ?? null,
      themeId: context.themeId,
      theme: context.theme ? clone(context.theme) : null,
      notices: [...(context.notices ?? [])],
      availability: {
        available: Boolean(availability.available),
        status: availability.status ?? (availability.available ? "available" : "unavailable"),
        health: availability.health ? clone(availability.health) : {
          status: availability.available ? "unknown" : "unavailable",
          lastCheckedAt: null,
          lastSuccessfulSyncAt: null,
          catalogStatus: "unknown"
        }
      }
    };
  }

  listPublic() {
    return this.listVisible().map((context) => this.publicRecord(context));
  }
}

export function createSeasonContextService(options = {}) {
  return new SeasonContextService(options);
}
