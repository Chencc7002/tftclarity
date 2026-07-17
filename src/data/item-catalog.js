import { ITEMS } from "./static-data.js";
import { normalizeItemRows } from "./metatft-response-adapter.js";
import { itemAliasOverrideByApiName } from "./item-alias-overrides.js";
import { traitAliasOverrideByApiName } from "./domain-alias-overrides.js";
import {
  findItemAvailabilityOverride
} from "./item-availability-overrides.js";
import {
  applyOfficialItemLocalization
} from "./item-localization.js";

const COMPONENT_ITEM_API_NAMES = new Set([
  "TFT_Item_BFSword",
  "TFT_Item_ChainVest",
  "TFT_Item_GiantsBelt",
  "TFT_Item_NeedlesslyLargeRod",
  "TFT_Item_NegatronCloak",
  "TFT_Item_RecurveBow",
  "TFT_Item_SparringGloves",
  "TFT_Item_TearOfTheGoddess",
  "TFT_Item_Spatula",
  "TFT_Item_FryingPan"
]);

const SET_SPECIAL_PATTERNS = [
  /^TFT17_AnimaSquadItem_/,
  /^TFT17_EkkoOffering_/,
  /^TFT17_Item_PsyOps_/,
  /^TFT17_Item_.*TraitEmblemItem$/,
  /^TFT17_Item_.*EmblemItem$/
];

const ARTIFACT_PATTERNS = [
  /_Artifact_/,
  /^TFT_Item_Artifact_/,
  /^TFT4_Item_Ornn/,
  /^TFT7_Item_Shimmerscale/,
  /^TFT9_Item_Ornn/,
  /^TFT9_Item_CrownOfDemacia/
];

const SUPPORT_OR_TACTICIAN_PATTERNS = [
  /^TFT_Item_Tacticians/,
  /^TFT_Item_ForceOfNature$/
];

const CONSUMABLE_ITEM_PATTERNS = [
  /^TFT_Consumable_/,
  /^TFT\d+_Consumable_/
];

const seedByApiName = new Map(ITEMS.map((item) => [item.apiName, item]));
const seedOrOverrideItemByToken = new Map();

const ANIMA_SQUAD_ITEM_NAMES = new Map([
  ["ClunkyPrototype", "笨重原型"],
  ["LeakyPrototype", "漏液原型"],
  ["SparkingPrototype", "火花原型"],
  ["GuidingHex", "指引海克斯"],
  ["RocketSwarm", "火箭蜂群"],
  ["SavageSlicer", "野性切割器"],
  ["TentacleSlam", "触手猛击"],
  ["Annihilator", "歼灭者"],
  ["BattleBunnyCrossbow", "战斗兔弩"],
  ["CyclonicSlicers", "旋风切割器"],
  ["EchoingBatblades", "回响蝠刃"],
  ["IceblastArmor", "冰爆护甲"],
  ["LionessLament", "母狮哀歌"],
  ["RadiantField", "光辉力场"],
  ["SearingShortbow", "灼热短弓"],
  ["UwuBlaster", "Uwu爆破枪"],
  ["Omniweapon", "全能武器"]
]);

const PSYOPS_MOD_NAMES = new Map([
  ["ChemicalCapacitorMod", "化学电容器改件"],
  ["DroneMod", "无人机改件"],
  ["GrenadeMod", "手雷改件"],
  ["SympatheticImplantMod", "共感植入改件"],
  ["TargetlockMod", "目标锁定改件"]
]);

const HERO_ARTIFACT_NAMES = new Map([
  ["Ahri", "阿狸"],
  ["Evelynn", "伊芙琳"],
  ["Soraka", "索拉卡"],
  ["Thresh", "锤石"],
  ["Varus", "韦鲁斯"],
  ["Yasuo", "亚索"]
]);

for (const item of ITEMS) {
  seedOrOverrideItemByToken.set(normalizeLookupToken(apiToken(item.apiName)), item);
}

for (const override of itemAliasOverrideByApiName.values()) {
  seedOrOverrideItemByToken.set(normalizeLookupToken(apiToken(override.apiName)), override);
}

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

function containsHan(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ""));
}

function normalizeLookupToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function apiToken(apiName) {
  return String(apiName ?? "")
    .replace(/^TFT\d*_Item_/, "")
    .replace(/^TFT_Item_/, "")
    .replace(/^TFT\d*_/, "");
}

function humanizeToken(token) {
  return String(token ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function displayNameForTraitApiName(apiName) {
  const override = traitAliasOverrideByApiName.get(apiName);
  return override?.zhName ?? override?.displayName ?? null;
}

function deriveEmblemAlias(apiName) {
  const match = String(apiName ?? "").match(/^(TFT\d+)_Item_([A-Za-z0-9]+)EmblemItem$/);
  if (!match) return null;

  const [, setPrefix, traitToken] = match;
  const traitApiName = `${setPrefix}_${traitToken}`;
  const traitName = displayNameForTraitApiName(traitApiName);
  if (!traitName) {
    const fallbackName = `${humanizeToken(traitToken)} Emblem`;
    return {
      shortName: fallbackName,
      aliases: [fallbackName, `${humanizeToken(traitToken)} emblem`, apiToken(apiName)],
      source: "derived_unknown_emblem_alias",
      confidence: 0.4
    };
  }

  return {
    zhName: `${traitName}纹章`,
    shortName: `${traitName}转`,
    aliases: [
      `${traitName}纹章`,
      `${traitName}转`,
      `${traitName}转职`,
      `${traitName}徽章`,
      apiToken(apiName)
    ],
    source: "derived_emblem_alias",
    confidence: 0.85
  };
}

function deriveRadiantAlias(apiName) {
  const token = apiToken(apiName);
  if (!/Radiant$/i.test(token)) return null;

  const baseToken = token.replace(/Radiant$/i, "");
  const base = seedOrOverrideItemByToken.get(normalizeLookupToken(baseToken));
  const derivedBase = deriveSetSpecialAlias(String(apiName ?? "").replace(/_Radiant$/i, ""));
  const baseAlias = base ?? derivedBase;
  if (!baseAlias?.zhName && !baseAlias?.shortName) return null;

  const baseLongName = baseAlias.zhName ?? baseAlias.shortName;
  const baseShortName = baseAlias.shortName ?? baseAlias.zhName;
  const baseChineseAliases = compact([
    baseAlias.shortName,
    ...(baseAlias.aliases ?? [])
  ]).filter((alias) => containsHan(alias) && !/^(?:光明|光)/u.test(alias));

  return {
    zhName: `光明${baseLongName}`,
    shortName: `光明${baseShortName}`,
    aliases: compact([
      `光明${baseLongName}`,
      `光明${baseShortName}`,
      ...baseChineseAliases.flatMap((alias) => [
        `光明${alias}`,
        `光${alias}`
      ]),
      `${baseToken}radiant`,
      `${baseToken} radiant`,
      token
    ]),
    source: "derived_radiant_alias",
    confidence: 0.8
  };
}

function deriveAnimaSquadAlias(apiName) {
  const match = String(apiName ?? "").match(/^TFT17_AnimaSquadItem_Tier(\d+)_(.+)$/);
  if (!match) return null;

  const [, tier, token] = match;
  const itemName = ANIMA_SQUAD_ITEM_NAMES.get(token) ?? humanizeToken(token);
  const englishName = humanizeToken(token);

  return {
    zhName: `幻灵${itemName}`,
    shortName: itemName,
    aliases: compact([
      `幻灵${itemName}`,
      itemName,
      `T${tier}${itemName}`,
      `Tier${tier}${englishName}`,
      englishName,
      apiToken(apiName)
    ]),
    source: "derived_set_special_alias",
    confidence: ANIMA_SQUAD_ITEM_NAMES.has(token) ? 0.7 : 0.5
  };
}

function derivePsyOpsAlias(apiName) {
  const match = String(apiName ?? "").match(/^TFT17_Item_PsyOps_([^_]+)$/);
  if (!match) return null;

  const [, token] = match;
  const itemName = PSYOPS_MOD_NAMES.get(token) ?? humanizeToken(token);
  const englishName = humanizeToken(token);

  return {
    zhName: `灵能${itemName}`,
    shortName: itemName,
    aliases: compact([
      `灵能${itemName}`,
      itemName,
      englishName,
      apiToken(apiName)
    ]),
    source: "derived_set_special_alias",
    confidence: PSYOPS_MOD_NAMES.has(token) ? 0.7 : 0.5
  };
}

function deriveHeroArtifactAlias(apiName) {
  const heroArtifact = String(apiName ?? "").match(/^TFT17_Item_Artifact_([A-Za-z]+)Artifact$/);
  if (heroArtifact) {
    const [, heroToken] = heroArtifact;
    const heroName = HERO_ARTIFACT_NAMES.get(heroToken);
    if (!heroName) return null;
    return {
      zhName: `${heroName}专属神器`,
      shortName: `${heroName}神器`,
      aliases: [
        `${heroName}专属神器`,
        `${heroName}神器`,
        `${heroName}专属`,
        apiToken(apiName)
      ],
      source: "derived_hero_artifact_alias",
      confidence: 0.7
    };
  }

  if (apiName === "TFT17_Item_Artifact_ThreshLantern") {
    return {
      zhName: "锤石灯笼",
      shortName: "灯笼",
      aliases: ["锤石灯笼", "灯笼", "thresh lantern", apiToken(apiName)],
      source: "derived_hero_artifact_alias",
      confidence: 0.75
    };
  }

  return null;
}

function deriveGenericArtifactAlias(apiName) {
  const match = String(apiName ?? "").match(/^TFT_Item_Artifact_(.+)$/);
  if (!match) return null;

  const [, baseToken] = match;
  const base = seedOrOverrideItemByToken.get(normalizeLookupToken(baseToken));
  if (!base?.zhName && !base?.shortName) return null;

  const baseLongName = base.zhName ?? base.shortName;
  const baseShortName = base.shortName ?? base.zhName;

  return {
    zhName: `神器${baseLongName}`,
    shortName: `神器${baseShortName}`,
    aliases: compact([
      `神器${baseLongName}`,
      `神器${baseShortName}`,
      `${baseShortName}神器`,
      `${baseToken} artifact`,
      apiToken(apiName)
    ]),
    source: "derived_artifact_alias",
    confidence: 0.8
  };
}

function deriveEkkoOfferingAlias(apiName) {
  if (apiName !== "TFT17_EkkoOffering_AnomalyItem") return null;
  return {
    zhName: "艾克异常道具",
    shortName: "艾克异常",
    aliases: ["艾克异常", "艾克异常道具", "ekko anomaly", apiToken(apiName)],
    source: "derived_set_special_alias",
    confidence: 0.65
  };
}

function deriveSetSpecialAlias(apiName) {
  return deriveAnimaSquadAlias(apiName) ?? derivePsyOpsAlias(apiName) ?? deriveEkkoOfferingAlias(apiName);
}

function deriveItemAlias(apiName, category) {
  if (category === "emblem") return deriveEmblemAlias(apiName);
  if (category === "radiant") return deriveRadiantAlias(apiName);
  if (category === "artifact") return deriveHeroArtifactAlias(apiName) ?? deriveGenericArtifactAlias(apiName);
  if (category === "set_special") return deriveSetSpecialAlias(apiName);
  return null;
}

function resolveItemAvailabilityOverride(apiName, options = {}) {
  const configuredOverride = findItemAvailabilityOverride(
    apiName,
    options.patch ?? "current"
  );
  if (configuredOverride) return configuredOverride;

  if (!options.removedItems?.has(apiName)) return null;
  return {
    category: "removed_or_legacy",
    current: false,
    obtainable: false,
    reason: "Marked unavailable by the caller-provided removed item set.",
    source: "caller_removed_items"
  };
}

function applyResolvedItemAvailability(item, options = {}) {
  if (!item?.apiName) return item;

  const availabilityOverride = resolveItemAvailabilityOverride(item.apiName, {
    ...options,
    patch: options.patch ?? item.patch ?? "current"
  });
  if (!availabilityOverride) return item;

  return {
    ...item,
    category: availabilityOverride.category,
    current: availabilityOverride.current,
    obtainable: availabilityOverride.obtainable,
    availabilityOverride: true,
    availabilityReason: availabilityOverride.reason,
    availabilitySource: availabilityOverride.source
  };
}

export function classifyItemApiName(apiName, options = {}) {
  const itemName = String(apiName ?? "");

  if (!itemName) return "unknown";
  if (resolveItemAvailabilityOverride(itemName, options)?.category === "removed_or_legacy") {
    return "removed_or_legacy";
  }
  if (COMPONENT_ITEM_API_NAMES.has(itemName)) return "component";
  if (CONSUMABLE_ITEM_PATTERNS.some((pattern) => pattern.test(itemName))) return "consumable";
  if (/_Radiant$/i.test(itemName) || /^TFT5_Item_/.test(itemName)) return "radiant";
  if (itemName.includes("EmblemItem")) return "emblem";
  if (ARTIFACT_PATTERNS.some((pattern) => pattern.test(itemName))) return "artifact";
  if (SUPPORT_OR_TACTICIAN_PATTERNS.some((pattern) => pattern.test(itemName))) return "support";
  if (SET_SPECIAL_PATTERNS.some((pattern) => pattern.test(itemName))) return "set_special";
  if (itemName.startsWith("TFT_Item_")) return "ordinary_completed";
  return "unknown";
}

function itemFromApiName(apiName, options = {}, dynamicSource = null) {
  const seed = seedByApiName.get(apiName);
  const override = itemAliasOverrideByApiName.get(apiName);
  const availabilityOverride = resolveItemAvailabilityOverride(apiName, options);
  const category = availabilityOverride?.category
    ?? seed?.category
    ?? classifyItemApiName(apiName, options);
  const current = availabilityOverride?.current
    ?? seed?.current
    ?? (category !== "removed_or_legacy");
  const obtainable = availabilityOverride?.obtainable
    ?? seed?.obtainable
    ?? (category !== "removed_or_legacy" && category !== "unknown");
  const token = apiToken(apiName);
  const derived = override?.suppressDerivedAliases
    ? null
    : deriveItemAlias(apiName, category);

  return applyOfficialItemLocalization({
    apiName,
    zhName: override?.zhName ?? seed?.zhName ?? derived?.zhName ?? null,
    shortName: override?.shortName ?? seed?.shortName ?? derived?.shortName ?? token,
    preferredDisplayName: override?.preferredDisplayName ?? seed?.preferredDisplayName ?? null,
    supersededBy: seed?.supersededBy ?? null,
    aliases: compact([
      override?.zhName,
      override?.shortName,
      seed?.zhName,
      seed?.shortName,
      derived?.zhName,
      derived?.shortName,
      ...(override?.aliases ?? []),
      ...(seed?.aliases ?? []),
      ...(derived?.aliases ?? []),
      apiName,
      token
    ]),
    category,
    current,
    obtainable,
    patch: options.patch ?? "current",
    source: compact([
      seed ? "seed" : null,
      override ? "alias_override" : null,
      derived ? "derived_alias" : null,
      dynamicSource
    ]).join("+"),
    aliasSource: override?.source ?? derived?.source ?? null,
    aliasConfidence: override?.confidence ?? derived?.confidence ?? null,
    availabilityOverride: Boolean(availabilityOverride),
    availabilityReason: availabilityOverride?.reason ?? null,
    availabilitySource: availabilityOverride?.source ?? null
  }, {
    localizationByApiName: options.localizationByApiName
  });
}

export function buildItemCatalogFromItemsResponse(response, options = {}) {
  const rows = normalizeItemRows(response);
  const itemsByApiName = new Map();

  for (const row of rows) {
    const apiName = row.items ?? row.itemName ?? row.item ?? row.apiName ?? row.api_name;
    if (!apiName) continue;
    itemsByApiName.set(apiName, {
      ...itemFromApiName(apiName, options, "metatft_items"),
      raw: row
    });
  }

  for (const seed of ITEMS) {
    if (!itemsByApiName.has(seed.apiName)) {
      const unobserved = itemFromApiName(seed.apiName, options);
      itemsByApiName.set(seed.apiName, {
        ...unobserved,
        category: "removed_or_legacy",
        current: false,
        obtainable: false,
        availabilityOverride: false,
        availabilityReason: "Not observed in the current MetaTFT /items snapshot.",
        availabilitySource: "metatft_items_snapshot_absence"
      });
    }
  }

  return [...itemsByApiName.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function mergeCatalogItems(baseItems, generatedItems, options = {}) {
  const merged = new Map();
  for (const item of baseItems ?? []) merged.set(item.apiName, item);
  for (const item of generatedItems ?? []) {
    const existing = merged.get(item.apiName);
    const incomingManualAlias = String(item.source ?? "").includes("alias_override") && Boolean(item.shortName);
    merged.set(item.apiName, existing ? {
      ...item,
      zhName: existing.zhName ?? item.zhName,
      shortName: incomingManualAlias ? item.shortName : existing.shortName ?? item.shortName,
      aliases: compact([...(existing.aliases ?? []), ...(item.aliases ?? [])])
    } : item);
  }
  return [...merged.values()]
    .map((item) => applyResolvedItemAvailability(item, options))
    .map((item) => applyOfficialItemLocalization(item, {
      localizationByApiName: options.localizationByApiName
    }))
    .sort((a, b) => a.apiName.localeCompare(b.apiName));
}
