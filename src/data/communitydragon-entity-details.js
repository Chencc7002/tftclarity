export const COMMUNITYDRAGON_PBE_TEAMPLANNER_URL =
  "https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tftchampions-teamplanner.json";
export const COMMUNITYDRAGON_PBE_TRAITS_URL =
  "https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tfttraits.json";
export const COMMUNITYDRAGON_LIVE_TEAMPLANNER_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tftchampions-teamplanner.json";
export const COMMUNITYDRAGON_LIVE_TRAITS_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tfttraits.json";

function sourceUrls(options = {}) {
  const channel = options.channel === "latest" ? "latest" : "pbe";
  return channel === "latest"
    ? {
        channel,
        teamplanner: COMMUNITYDRAGON_LIVE_TEAMPLANNER_URL,
        traits: COMMUNITYDRAGON_LIVE_TRAITS_URL
      }
    : {
        channel,
        teamplanner: COMMUNITYDRAGON_PBE_TEAMPLANNER_URL,
        traits: COMMUNITYDRAGON_PBE_TRAITS_URL
      };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

function communityDragonAssetUrl(value, channel = "pbe") {
  const path = String(value ?? "").trim();
  if (!path) return null;
  const relative = path
    .replace(/^\/lol-game-data\/assets\//i, "")
    .replace(/^\/+/, "")
    .toLowerCase();
  return `https://raw.communitydragon.org/${channel}/plugins/rcp-be-lol-game-data/global/default/${relative}`;
}

function lookupUnit(apiName, rows = []) {
  return rows.find((row) => row?.apiName === apiName
    || row?.characterName === apiName
    || (row?.assetNames ?? []).includes(apiName)) ?? null;
}

function constantsMap(...sets) {
  const result = new Map();
  for (const set of sets) {
    for (const constant of set?.constants ?? []) {
      if (constant?.name) result.set(constant.name, finite(constant.value));
    }
  }
  return result;
}

function formatConstant(value, multiplier = 1) {
  const number = finite(value);
  if (number === null) return "?";
  const scaled = number * multiplier;
  return Number.isInteger(scaled) ? String(scaled) : String(Number(scaled.toFixed(2)));
}

function renderCommunityDragonText(value, constants = new Map()) {
  return String(value ?? "")
    .replace(/@([A-Za-z0-9_]+)(?:\*([0-9.]+))?@/g, (_match, name, multiplier) => (
      formatConstant(constants.get(name), multiplier ? Number(multiplier) : 1)
    ))
    .replace(/%i:scaleAS%/gi, "攻击速度")
    .replace(/%i:scaleAD%/gi, "攻击力")
    .replace(/%i:scaleAP%/gi, "法术强度")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/%{2,}/g, "%")
    .replace(/%\s+%/g, "%")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function curveValue(lookup, row, column = null) {
  const entries = lookup?.curveTable?.[row] ?? lookup?.curveValues?.[row] ?? [];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (column !== null && Number.isFinite(Number(column))) {
    return entries.find(([index]) => Number(index) === Number(column))?.[1] ?? null;
  }
  const values = entries.map((entry) => Array.isArray(entry) ? entry[1] : entry).filter((entry) => finite(entry) !== null);
  return compact(values.map((entry) => formatConstant(entry))).join("/");
}

function renderLookupText(value, lookup) {
  return String(value ?? "")
    .replace(/<TFTAttribute\b[^>]*attributeID="([^"]+)"[^>]*\/?\s*>/gi, (_match, id) => {
      const values = lookup?.attributeValues?.[id] ?? lookup?.ability?.attributeValues?.[id] ?? [];
      return compact(values.map((entry) => formatConstant(entry))).join("/") || "?";
    })
    .replace(/<TFTCurveTable\b([^>]*)\/?\s*>/gi, (_match, attributes) => {
      const row = attributes.match(/\brow="([^"]+)"/i)?.[1];
      const column = attributes.match(/\bcolumn="([^"]+)"/i)?.[1] ?? null;
      const format = attributes.match(/\bformat="([^"]+)"/i)?.[1] ?? "";
      const raw = row ? curveValue(lookup, row, column) : null;
      const number = finite(raw);
      if (number !== null && /percentminusone/i.test(format)) {
        return `${formatConstant((number - 1) * 100)}%`;
      }
      if (number !== null && /percent/i.test(format)) return `${formatConstant(number * 100)}%`;
      return raw ?? "?";
    })
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceRecord(options = {}) {
  const urls = sourceUrls(options);
  return {
    version: options.version ?? (urls.channel === "latest" ? "Live current" : "PBE current"),
    season: options.tftSet ?? "TFTSet18",
    updatedAt: options.updatedAt ?? null,
    url: urls.teamplanner,
    sources: [urls.teamplanner, urls.traits]
  };
}

export function buildCommunityDragonEntityDetails(payloads = {}, options = {}) {
  const tftSet = options.tftSet ?? "TFTSet18";
  const plannerRows = Array.isArray(payloads?.teamplanner?.[tftSet])
    ? payloads.teamplanner[tftSet]
    : [];
  const traitRows = Array.isArray(payloads?.traits) ? payloads.traits : [];
  const lookupPayload = payloads?.lookup ?? {};
  const source = sourceRecord({ ...options, tftSet });
  const units = new Map();
  const traits = new Map();

  for (const row of plannerRows) {
    const apiName = String(row?.character_id ?? "").trim();
    if (!apiName) continue;
    const lookup = lookupUnit(apiName, lookupPayload.units);
    const stats = lookup?.stats ?? {};
    units.set(apiName, {
      apiName,
      name: row.display_name ?? lookup?.name ?? apiName,
      cost: finite(row.tier ?? lookup?.cost),
      role: Array.isArray(lookup?.roleTags) ? lookup.roleTags.map((tag) => String(tag).replace(/^Role\./, "")).join(" · ") : null,
      traitNames: compact((row.traits ?? []).map((trait) => trait?.name)),
      stats: {
        health: finite(stats.hp),
        mana: finite(stats.mana),
        startingMana: finite(stats.initialMana),
        attackDamage: finite(stats.damage),
        attackDamageByStar: Array.isArray(stats.damageByStar) ? stats.damageByStar.map(finite) : null,
        armor: finite(stats.armor),
        magicResist: finite(stats.magicResist),
        attackSpeed: finite(stats.attackSpeed),
        attackRange: finite(stats.range),
        critChance: finite(stats.critChance) === null ? null : finite(stats.critChance) * 100
      },
      ability: {
        name: lookup?.ability?.name ?? null,
        type: null,
        description: renderLookupText(lookup?.ability?.desc, lookup),
        iconUrl: null,
        sourceTokens: [],
        unresolvedTokens: [],
        scalingReferences: [],
        numericFormulaComplete: true
      },
      iconUrl: communityDragonAssetUrl(row.squareIconPath ?? row.squareSplashIconPath, sourceUrls(options).channel),
      source
    });
  }

  for (const row of traitRows) {
    if (row?.set !== tftSet) continue;
    const apiName = String(row?.trait_id ?? "").trim();
    if (!apiName) continue;
    const lookup = (lookupPayload.traits ?? []).find((entry) => entry?.apiName === apiName) ?? null;
    const innate = row.innate_trait_sets?.[0] ?? null;
    const baseConstants = constantsMap(innate);
    const parts = String(row.tooltip_text ?? "").split(/<br\s*\/?\s*>/i);
    const description = renderCommunityDragonText(parts[0], baseConstants);
    const rows = [...String(row.tooltip_text ?? "").matchAll(/<row>([\s\S]*?)<\/row>/gi)].map((match) => match[1]);
    const levels = (row.conditional_trait_sets ?? []).map((tier, index) => {
      const constants = constantsMap(innate, tier);
      constants.set("MinUnits", finite(tier.min_units));
      constants.set("MaxUnits", finite(tier.max_units));
      const lookupEffect = lookup?.effects?.[index] ?? null;
      const lookupText = renderLookupText(lookupEffect?.desc, lookup);
      const displayedUnits = finite(lookupText.match(/^\s*\((\d+)\)/)?.[1]);
      const units = displayedUnits ?? finite(tier.min_units);
      const communityText = renderCommunityDragonText(rows[index] ?? row.tooltip_text, constants);
      return {
        units,
        effect: communityText.replace(/^\s*\(\d+\)/, `(${units})`)
      };
    }).filter((level) => level.units !== null);
    traits.set(apiName, {
      apiName,
      name: row.display_name ?? apiName,
      type: null,
      description,
      levels,
      iconUrl: communityDragonAssetUrl(row.icon_path, sourceUrls(options).channel),
      source: { ...source, url: source.sources[1] }
    });
  }

  return {
    units,
    traits,
    meta: source
  };
}

export async function fetchCommunityDragonEntityDetails(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("CommunityDragon entity details require fetch");
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 15000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const urls = sourceUrls(options);
  try {
    const [teamplannerResponse, traitsResponse, lookup] = await Promise.all([
      fetchImpl(options.teamplannerUrl ?? urls.teamplanner, { signal: controller.signal }),
      fetchImpl(options.traitsUrl ?? urls.traits, { signal: controller.signal }),
      Promise.resolve(options.lookupPromise ?? options.lookup ?? null)
    ]);
    for (const response of [teamplannerResponse, traitsResponse]) {
      if (!response.ok) throw new Error(`CommunityDragon entity details request failed: ${response.status} ${response.statusText}`);
    }
    return buildCommunityDragonEntityDetails({
      teamplanner: await teamplannerResponse.json(),
      traits: await traitsResponse.json(),
      lookup
    }, options);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`CommunityDragon entity details request timed out after ${timeoutMs}ms`);
    const localCachePaths = options.localCachePaths;
    if (localCachePaths?.teamplanner && localCachePaths?.traits) {
      const readJsonFile = options.readJsonFile ?? (async (path) => JSON.parse(await readFile(path, "utf8")));
      try {
        const [teamplanner, traits] = await Promise.all([
          readJsonFile(localCachePaths.teamplanner),
          readJsonFile(localCachePaths.traits)
        ]);
        let lookup = options.lookup ?? null;
        if (!lookup && options.lookupPromise) {
          try {
            lookup = await Promise.resolve(options.lookupPromise);
          } catch {
            lookup = null;
          }
        }
        if (!lookup && localCachePaths.lookup) lookup = await readJsonFile(localCachePaths.lookup);
        return buildCommunityDragonEntityDetails({ teamplanner, traits, lookup }, {
          ...options,
          updatedAt: options.localCacheUpdatedAt ?? options.updatedAt ?? null
        });
      } catch {
        // Preserve the original remote failure when neither source is usable.
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
import { readFile } from "node:fs/promises";
