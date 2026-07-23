import { applyItemAvailabilityOverride } from "./item-availability-overrides.js";
import { applyOfficialItemLocalization } from "./item-localization.js";
import { applyPinyinAliases } from "./pinyin-aliases.js";

export const DEFAULT_RANK_FILTER = [
  "CHALLENGER",
  "DIAMOND",
  "EMERALD",
  "GRANDMASTER",
  "MASTER",
  "PLATINUM"
];

export const DEFAULT_QUERY_OPTIONS = {
  queue: "1100",
  patch: "current",
  days: 3,
  rankFilter: DEFAULT_RANK_FILTER,
  minSamples: 100,
  itemPolicy: "ordinary_only",
  sort: "top4_first"
};

export const UNITS = [
  {
    apiName: "TFT17_Xayah",
    zhName: "霞",
    aliases: ["霞", "逆羽", "xayah"]
  }
];

export const TRAITS = [
  {
    apiName: "TFT17_Stargazer",
    filterId: "TFT17_Stargazer_1",
    zhName: "观星者",
    displayName: "3观星",
    aliases: ["观星", "观星者", "3观星", "三观星"]
  }
];

export const ITEMS = [
  {
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "鬼索的狂暴之刃",
    shortName: "羊刀",
    aliases: ["羊刀", "鬼索", "鬼索的狂暴之刃", "guinsoo"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_InfinityEdge",
    zhName: "无尽之刃",
    shortName: "无尽",
    aliases: ["无尽", "无尽之刃", "ie"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_GiantSlayer",
    zhName: "巨人杀手",
    shortName: "巨杀",
    aliases: ["巨杀", "巨人杀手"],
    supersededBy: "TFT_Item_MadredsBloodrazor",
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_RapidFireCannon",
    zhName: "红霸符",
    shortName: "红霸符",
    aliases: ["红霸符", "红buff", "redbuff", "red buff"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_MadredsBloodrazor",
    zhName: "巨人杀手",
    shortName: "巨人杀手",
    aliases: ["巨杀", "巨人杀手", "麦瑞德", "裂血手套", "红叉", "madreds"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_LastWhisper",
    zhName: "最后的轻语",
    shortName: "轻语",
    aliases: ["轻语", "最后的轻语"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_PowerGauntlet",
    zhName: "力量手套",
    shortName: "力量手套",
    aliases: ["力量手套", "powergauntlet"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_HextechGunblade",
    zhName: "海克斯科技枪刃",
    shortName: "科技枪",
    aliases: ["科技枪", "海克斯科技枪", "海克斯科技枪刃"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_Quicksilver",
    zhName: "水银",
    shortName: "水银",
    aliases: ["水银", "伏击水银", "quicksilver"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_Deathblade",
    zhName: "死亡之刃",
    shortName: "杀人剑",
    aliases: ["杀人剑", "死亡之刃"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_SpearOfShojin",
    zhName: "朔极之矛",
    shortName: "青龙刀",
    aliases: ["青龙刀", "朔极之矛", "shojin"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT5_Item_GuinsoosRagebladeRadiant",
    zhName: "光明鬼索的狂暴之刃",
    shortName: "光明羊刀",
    aliases: ["光明羊刀", "光明鬼索"],
    category: "radiant",
    current: true,
    obtainable: true
  },
  {
    apiName: "TFT_Item_RunaansHurricane",
    zhName: "海妖之怒",
    shortName: "海妖之怒",
    aliases: ["海妖", "海妖之怒", "分裂弓", "飓风", "卢安娜", "卢安娜的飓风", "runaan"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  }
];

export function createCatalog(overrides = {}) {
  const units = (overrides.units ?? UNITS).map((unit) => applyPinyinAliases(unit, "unit"));
  const traits = (overrides.traits ?? TRAITS).map((trait) => applyPinyinAliases(trait, "trait"));
  const items = (overrides.items ?? ITEMS).map((item) => applyOfficialItemLocalization(
    applyItemAvailabilityOverride(applyPinyinAliases(item, "item"), {
      patch: overrides.patch ?? item.patch ?? "current"
    }), {
      localizationByApiName: overrides.localizationByApiName
    }
  ));

  return {
    units,
    traits,
    items,
    unitByApiName: new Map(units.map((unit) => [unit.apiName, unit])),
    traitByFilterId: new Map(traits.map((trait) => [trait.filterId, trait])),
    traitByApiName: new Map(traits.map((trait) => [trait.apiName, trait])),
    itemByApiName: new Map(items.map((item) => [item.apiName, item]))
  };
}
