export const AUGMENT_ALIAS_OVERRIDES = [
  {
    apiName: "DA_18_OnesTwosThree",
    zhName: "一一二三",
    aliases: ["一，二，三", "1，2，3"],
    confidence: 1,
    source: "communitydragon_pbe_2026_08_05_zh_cn"
  },
  {
    apiName: "DA_18_RiftbeastTraitAugment",
    zhName: "欧米茄之怪",
    aliases: ["欧米茄之兽"],
    confidence: 1,
    source: "communitydragon_pbe_2026_08_05_zh_cn"
  },
  {
    apiName: "DA_18_LunarTraitAugmentPlus",
    zhName: "日月同辉＋",
    aliases: ["日月同辉", "日月同辉+"],
    confidence: 1,
    source: "communitydragon_pbe_2026_08_05_zh_cn"
  },
  {
    apiName: "DA_18_PrimalAugmentPlus_Nidalee",
    zhName: "兽性本能+",
    aliases: ["兽性本能"],
    confidence: 1,
    source: "communitydragon_pbe_2026_08_05_zh_cn"
  },
  {
    apiName: "DA_18_PrimalAugmentPlus_Sivir",
    zhName: "兽性本能+",
    aliases: ["兽性本能"],
    confidence: 1,
    source: "communitydragon_pbe_2026_08_05_zh_cn"
  }
];

export const augmentAliasOverrideByApiName = new Map(
  AUGMENT_ALIAS_OVERRIDES.map((override) => [override.apiName, override])
);
