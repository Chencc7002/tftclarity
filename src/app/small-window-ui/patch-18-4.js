// Verified against Riot's Traditional Chinese release notes and English October 7 B-patch.
// Official timestamp: 2026-10-06T18:00:00.000Z = October 7 02:00 Asia/Shanghai.
const t = (zh, en) => Object.freeze({ "zh-CN": zh, "en-US": en });
const c = (id, direction, before, after, zh, en, entityType = "system", entityApiNames = [], stat = id) => Object.freeze({
  id, direction, before, after, text: t(zh, en), entityType, entityApiNames: Object.freeze(entityApiNames), stat
});
const g = (zh, en, changes) => Object.freeze({ title: t(zh, en), changes: Object.freeze(changes) });

const releaseGroups = Object.freeze([
  g("羁绊", "Traits", [
    c("blossom-ad-ap", "buff", "12/30/45/50%", "12/30/50/55%", "盛放繁花 · 攻击力 / 法强", "Blossom · AD / AP", "trait", ["DA_18_Blossom"]),
    c("coven-130-components", "nerf", "2 components", "1 component + 6g", "女巫 130 精华 · 组件奖励", "Coven 130 Essence · Component reward", "trait", ["DA_18_Coven"]),
    c("coven-130-elise", "nerf", "1 component + 2-star Elise + 1-star Cassiopeia", "1 component + 2-star Elise", "女巫 130 精华 · 伊莉丝奖励", "Coven 130 Essence · Elise reward", "trait", ["DA_18_Coven"]),
    c("coven-130-random-item", "nerf", "1 random item", "1 component + 2-star Camille + 3g", "女巫 130 精华 · 随机物品奖励", "Coven 130 Essence · Random item reward", "trait", ["DA_18_Coven"]),
    c("coven-130-caitlyn", "nerf", "2-star Caitlyn + 1 component + 3g", "2-star Caitlyn + 1 component", "女巫 130 精华 · 凯特琳奖励", "Coven 130 Essence · Caitlyn reward", "trait", ["DA_18_Coven"]),
    c("eclipse-delay", "buff", "10s", "8s", "日蚀 · 首次处决延迟", "Eclipse · Initial execute delay", "trait", ["DA_18_Eclipse"]),
    c("elderwood-mana", "buff", "20/70", "20/60", "神木精灵（7）· 深林保护者法力", "Elderwood (7) · Deepwood Protector Mana", "trait", ["DA_18_Elderwood"]),
    c("elderwood-resists", "buff", "65", "70", "神木精灵（7）· 深林保护者双抗", "Elderwood (7) · Deepwood Protector resists", "trait", ["DA_18_Elderwood"]),
    c("elderwood-plant-health", "nerf", "155%", "140%", "神木精灵（9）· 植物升星生命倍率", "Elderwood (9) · Plant star-up Health multiplier", "trait", ["DA_18_Elderwood"]),
    c("executioner-bleed", "nerf", "30/40%", "25/35%", "处刑者（3/4）· 流血伤害", "Executioner (3/4) · Bleed damage", "trait", ["DA_18_Executioner"]),
    c("fae-pixie-stats", "nerf", "5/8%", "4.5/7%", "妖精 · 每个皮克斯提供的攻击力 / 法强", "Fae · AD / AP per Pixie", "trait", ["DA_18_Fae"]),
    c("juggernaut-durability", "nerf", "20/33/45%", "20/30/42%", "重装战士 · 续战力", "Juggernaut · Durability", "trait", ["DA_18_Vanguard"]),
    c("lunar-ap", "buff", "7/10/14/18%", "7/12/16/20%", "月华 · 法强", "Lunar · Ability Power", "trait", ["DA_18_Lunar"]),
    c("riftbeast-seven-stats", "buff", "5%", "6%", "峡谷巨兽（7）· 每 5 秒攻击力 / 法强 / 攻速", "Riftbeast (7) · AD / AP / AS every 5 seconds", "trait", ["DA_Riftbeast18"]),
    c("sprykin-seven-stats", "buff", "45% HP + 45% AS", "55% HP + 55% AS", "百战老兵（7）· 生命值与攻速", "Sprykin (7) · Health and Attack Speed", "trait", ["DA_18_Sprykin"])
  ]),
  g("一费弈子", "Tier 1 champions", [
    c("camille-damage", "buff", "150/225/375/640", "150/225/400/665", "卡蜜尔 · 技能攻击力倍率", "Camille · Ability AD ratio", "unit", ["DA_18_Camille"]),
    c("kobuko-heal", "buff", "265/315/460/575", "285/335/480/595", "柯布柯 · 治疗法强倍率", "Kobuko · Heal AP ratio", "unit", ["DA_18_Kobuko"]),
    c("rakan-shield", "buff", "270/320/415/490", "290/340/435/510", "锐空 · 护盾", "Rakan · Shield", "unit", ["DA_18_Rakan"]),
    c("xayah-damage", "buff", "68/102/155/165", "73/108/165/175", "霞 · 技能伤害", "Xayah · Ability damage", "unit", ["DA_18_Xayah"]),
    c("varus-attack-speed", "buff", "0.7", "0.75", "韦鲁斯 · 攻速", "Varus · Attack Speed", "unit", ["DA_18_Varus"]),
    c("veigar-damage", "nerf", "200/300/450/765", "190/285/430/725", "维迦 · 技能伤害", "Veigar · Ability damage", "unit", ["DA_18_Veigar"]),
    c("veigar-low-health-damage", "nerf", "300/450/675/1015", "285/430/640/1000", "维迦 · 低生命目标技能伤害", "Veigar · Low-Health ability damage", "unit", ["DA_18_Veigar"])
  ]),
  g("二费弈子", "Tier 2 champions", [
    c("gromp-ad-mana", "buff", "20/80", "0/70", "魔沼蛙（物理）· 法力", "Gromp AD form · Mana", "unit", ["DA_Gromp18_AD"]),
    c("gromp-ap-splash", "buff", "160/240/360/610", "160/240/375/625", "魔沼蛙（法系）· 溅射伤害法强倍率", "Gromp AP form · Splash AP ratio", "unit", ["DA_Gromp18_AP"]),
    c("kayle-damage", "buff", "62/92/105/115", "65/97/110/115", "凯尔 · 技能伤害", "Kayle · Ability damage", "unit", ["DA_18_Kayle"]),
    c("shen-shield", "buff", "350/430/550/700", "375/450/575/725", "慎 · 自身护盾", "Shen · Self shield", "unit", ["DA_18_Shen"]),
    c("shen-ally-shield", "buff", "200/275/375/475", "225/300/400/500", "慎 · 友军护盾", "Shen · Ally shield", "unit", ["DA_18_Shen"]),
    c("teemo-aoe-damage", "buff", "55/82/130/215", "55/82/155/240", "提莫 · 范围伤害", "Teemo · Area damage", "unit", ["DA_18_Teemo"])
  ]),
  g("三费弈子", "Tier 3 champions", [
    c("hecarim-mana", "buff", "30/110", "50/110", "赫卡里姆 · 法力", "Hecarim · Mana", "unit", ["DA_18_Hecarim"]),
    c("mama-beak-damage", "buff", "22/30/48 AD", "22/30/52 AD", "巨喙鸟妈妈 · 技能攻击力倍率", "Mama Beak · Ability AD ratio", "unit", ["DA_CrimsonRaptor18"]),
    c("rammus-shield", "nerf", "400/550/725 AP", "400/550/700 AP", "拉莫斯 · 护盾法强倍率", "Rammus · Shield AP ratio", "unit", ["DA_18_Rammus"]),
    c("rengar-damage", "buff", "255/385/615 AD", "255/385/650 AD", "雷恩加尔 · 技能攻击力倍率", "Rengar · Ability AD ratio", "unit", ["DA_18_Rengar"]),
    c("tristana-damage", "buff", "160/240/385 AD", "175/265/420 AD", "崔丝塔娜 · 技能攻击力倍率", "Tristana · Ability AD ratio", "unit", ["DA_18_Tristana"])
  ]),
  g("四费弈子", "Tier 4 champions", [
    c("brambleback-bonus-ad", "buff", "80% AD", "100% AD", "树精长老 · 技能额外攻击力", "Brambleback · Ability bonus AD", "unit", ["DA_Brambleback18"]),
    c("brambleback-leap", "nerf", "155/235 AD", "135/205 AD", "树精长老 · 跃击伤害", "Brambleback · Leap damage", "unit", ["DA_Brambleback18"]),
    c("ezreal-small-cast", "buff", "250/375 AD", "270/405 AD", "伊泽瑞尔 · 小型施法伤害", "Ezreal · Small cast damage", "unit", ["DA_18_Ezreal"]),
    c("nidalee-ap-small-spear", "buff", "170/255 AP", "185/275 AP", "奈德丽（法系）· 小矛伤害", "Nidalee AP form · Small spear damage", "unit", ["DA_Nidalee18_AP"]),
    c("nidalee-ad-damage", "nerf", "210/315 AD", "200/300 AD", "奈德丽（物理）· 技能伤害", "Nidalee AD form · Ability damage", "unit", ["DA_Nidalee18_AD"]),
    c("sivir-damage", "buff", "190/285 AD", "200/300 AD", "希维尔 · 技能伤害", "Sivir · Ability damage", "unit", ["DA_18_Sivir"])
  ]),
  g("五费弈子", "Tier 5 champions", [
    c("ashe-mana", "mixed", "20/80", "0/80", "艾希 · 法力", "Ashe · Mana", "unit", ["DA_18_Ashe"]),
    c("ashe-percent-health", "nerf", "2/3%", "1.5%", "艾希 · 百分比生命值伤害", "Ashe · Percent-Health damage", "unit", ["DA_18_Ashe"]),
    c("draven-bleed", "buff", "140/210 AD", "150/225 AD", "德莱文 · 流血伤害", "Draven · Bleed damage", "unit", ["DA_Draven18"]),
    c("ivern-damage-amp", "nerf", "8/12%", "6/10%", "艾翁 · 绿林格伤害增幅", "Ivern · Grove tile damage amp", "unit", ["DA_18_Ivern"]),
    c("ivern-health", "nerf", "8/12%", "6/10%", "艾翁 · 绿林格额外生命值", "Ivern · Grove tile bonus Health", "unit", ["DA_18_Ivern"]),
    c("ivern-resists", "buff", "8/12", "10/14", "艾翁 · 绿林格双抗", "Ivern · Grove tile resists", "unit", ["DA_18_Ivern"]),
    c("kennen-shield", "nerf", "250/350 AP", "230/300 AP", "凯南 · 护盾法强倍率", "Kennen · Shield AP ratio", "unit", ["DA_18_Kennen"])
  ]),
  g("装备与纹章", "Items and Emblems", [
    c("crownguard-ap", "nerf", "25", "20", "皇冠卫士 · 护盾结束后的额外法强", "Crownguard · AP after shield expires", "item", ["TFT_Item_Crownguard"]),
    c("spirit-visage-durability", "buff", "8%", "10%", "振奋盔甲 · 续航能力", "Spirit Visage · Durability", "item", ["TFT_Item_Redemption"]),
    c("radiant-spirit-visage-durability", "buff", "15%", "18%", "光明振奋盔甲 · 续航能力", "Radiant Spirit Visage · Durability", "item", ["TFT5_Item_RedemptionRadiant"]),
    c("elderwood-emblem-resists", "nerf", "35", "25", "神木精灵纹章 · 双抗", "Elderwood Emblem · Resists", "item", ["DA_18_EmblemElderwood"])
  ]),
  g("强化符文", "Augments", [
    c("dark-ritual-cashout-2", "nerf", "15", "12", "暗黑仪式 · 第 2 次兑现法强", "Dark Ritual · Cashout 2 AP", "augment"),
    c("dark-ritual-cashout-3", "nerf", "50", "33", "暗黑仪式 · 第 3 次兑现法强", "Dark Ritual · Cashout 3 AP", "augment"),
    c("dark-ritual-cashout-4", "nerf", "75", "50", "暗黑仪式 · 第 4 次兑现法强", "Dark Ritual · Cashout 4 AP", "augment"),
    c("dark-ritual-cashout-5", "nerf", "125", "100", "暗黑仪式 · 第 5 次兑现法强", "Dark Ritual · Cashout 5 AP", "augment"),
    c("dark-ritual-cashout-6", "nerf", "200", "175", "暗黑仪式 · 第 6 次兑现法强", "Dark Ritual · Cashout 6 AP", "augment"),
    c("bronze-for-life-ii", "nerf", "4", "3", "铜级之命 II · 双抗", "Bronze for Life II · Resists", "augment"),
    c("component-quest-gold", "nerf", "5g", "1g", "组件任务 · 最终金币", "Component Quest · Final gold", "augment"),
    c("dummify-health", "buff", "1000", "1500", "钝化 · 起始生命值", "Dummify · Starting Health", "augment"),
    c("explosive-growth-plus", "nerf", "10", "9", "爆炸性成长+ · 每回合经验", "Explosive Growth+ · XP per round", "augment"),
    c("heart-of-steel-health", "buff", "16", "18", "钢铁之心 · 最大生命值增量", "Heart of Steel · Max-Health increase", "augment"),
    c("investment-strategy-i-health", "buff", "8", "9", "投资策略 I · 每层利息最大生命值", "Investment Strategy I · Max Health per interest", "augment"),
    c("investment-strategy-i-gold", "buff", "4g", "6g", "投资策略 I · 初始金币", "Investment Strategy I · Starting gold", "augment"),
    c("investment-strategy-ii-health", "buff", "10", "12", "投资策略 II · 每层利息最大生命值", "Investment Strategy II · Max Health per interest", "augment"),
    c("investment-strategy-ii-gold", "buff", "8g", "10g", "投资策略 II · 获得金币", "Investment Strategy II · Gold", "augment"),
    c("level-up-xp", "buff", "6", "10", "升级咯！· 立即经验", "Level Up! · Immediate XP", "augment"),
    c("luxury-subscription-gold", "buff", "3g", "5g", "奢侈品订阅 · 获得金币", "Luxury Subscription · Gold", "augment"),
    c("small-furry-friend", "buff", "35%", "45%", "毛茸茸小伙伴 · 效果", "Small Furry Friend · Effect", "augment"),
    c("trait-ladder-four", "nerf", "6g", "5g", "特性阶梯 · 4 特性兑现金币", "Trait Ladder · 4-trait cashout gold", "augment"),
    c("trait-ladder-six-gold", "nerf", "10g", "7g", "特性阶梯 · 6 特性兑现金币", "Trait Ladder · 6-trait cashout gold", "augment"),
    c("trait-ladder-six-units", "nerf", "3x 3-cost", "2x 3-cost", "特性阶梯 · 6 特性兑现弈子", "Trait Ladder · 6-trait cashout units", "augment"),
    c("trait-ladder-seven", "nerf", "Component Anvil + 8g", "Component Anvil + 2g", "特性阶梯 · 7 特性兑现", "Trait Ladder · 7-trait cashout", "augment"),
    c("trait-ladder-eight", "nerf", "2 different components + Reforger", "2 different components", "特性阶梯 · 8 特性兑现", "Trait Ladder · 8-trait cashout", "augment"),
    c("trait-ladder-nine", "nerf", "3x 5-cost + 2g", "2x 5-cost + 2g", "特性阶梯 · 9 特性兑现", "Trait Ladder · 9-trait cashout", "augment"),
    c("verticality-ii", "buff", "2%", "2.5%", "特性参天 II · 每名友军攻击力 / 法强", "Verticality II · AD / AP per ally", "augment"),
    c("verticality-iii", "buff", "3.5%", "4%", "特性参天 III · 每名友军攻击力 / 法强", "Verticality III · AD / AP per ally", "augment")
  ]),
  g("灵火", "Wisps", [
    c("backrow-star-as", "buff", "85%", "100%", "后排巨星 · 额外攻速", "Backrow Star · Bonus Attack Speed", "wisp"),
    c("backrow-star-blossom-as", "buff", "115%", "130%", "后排巨星 · 盛放繁花强化攻速", "Backrow Star · Blossom-upgraded Attack Speed", "wisp"),
    c("forest-guide-cost", "nerf", "5g", "6g", "森林向导 · 价格", "Forest Guide · Cost", "wisp"),
    c("forest-guide-blossom-cost", "nerf", "4g", "5g", "森林向导 · 盛放繁花强化价格", "Forest Guide · Blossom-upgraded cost", "wisp"),
    c("giants-growth-health", "buff", "750", "800", "巨大成长 · 生命值", "Giant's Growth · Health", "wisp"),
    c("giants-growth-blossom-health", "buff", "750", "800", "巨大成长 · 盛放繁花强化生命值", "Giant's Growth · Blossom-upgraded Health", "wisp"),
    c("improved-reach-cost", "buff", "2g", "1g", "提升攻击距离 · 价格", "Improved Reach · Cost", "wisp"),
    c("improved-reach-blossom-cost", "buff", "2g", "1g", "提升攻击距离 · 盛放繁花强化价格", "Improved Reach · Blossom-upgraded cost", "wisp"),
    c("killing-frenzy-as", "buff", "115%", "130%", "杀戮狂热 · 击杀后攻速", "Killing Frenzy · Attack Speed after a kill", "wisp"),
    c("killing-frenzy-blossom-as", "buff", "140%", "160%", "杀戮狂热 · 盛放繁花强化攻速", "Killing Frenzy · Blossom-upgraded Attack Speed", "wisp"),
    c("mana-potion-restore", "nerf", "80", "70", "法力药水 · 法力回复", "Mana Potion · Mana restored", "wisp"),
    c("mana-potion-start", "nerf", "20", "10", "法力药水 · 起始法力", "Mana Potion · Starting Mana", "wisp"),
    c("mana-potion-radiant-restore", "nerf", "90", "80", "光明法力药水 · 法力回复", "Radiant Mana Potion · Mana restored", "wisp"),
    c("mana-potion-radiant-start", "nerf", "20", "10", "光明法力药水 · 起始法力", "Radiant Mana Potion · Starting Mana", "wisp"),
    c("stealthy-duration", "buff", "6s", "8s", "隐密行动 · 持续时间", "Stealthy · Duration", "wisp"),
    c("stealthy-blossom-duration", "buff", "10s", "12s", "隐密行动 · 盛放繁花强化持续时间", "Stealthy · Blossom-upgraded duration", "wisp")
  ])
]);

const hotfixGroups = Object.freeze([
  g("弈子", "Champions", [
    c("camille-damage", "buff", "150/225/375 AD", "150/225/400 AD", "卡蜜尔 · 技能攻击力倍率（B 补丁最终值）", "Camille · Ability AD ratio (B-patch endpoint)", "unit", ["DA_18_Camille"]),
    c("varus-mana", "buff", "30/120", "20/110", "韦鲁斯 · 法力", "Varus · Mana", "unit", ["DA_18_Varus"]),
    c("alistar-heal", "buff", "200/260/320 AP", "230/300/400 AP", "阿利斯塔 · 治疗法强倍率", "Alistar · Heal AP ratio", "unit", ["DA_18_Alistar"]),
    c("alistar-damage", "buff", "100/150/225 AP", "180/270/420 AP", "阿利斯塔 · 技能伤害法强倍率", "Alistar · Spell damage AP ratio", "unit", ["DA_18_Alistar"]),
    c("gromp-ap-splash", "buff", "160/240/375 AP", "180/270/435 AP", "魔沼蛙（法系）· 溅射伤害法强倍率（B 补丁最终值）", "Gromp AP form · Splash AP ratio (B-patch endpoint)", "unit", ["DA_Gromp18_AP"]),
    c("gromp-ad-base-ad", "buff", "45", "50", "魔沼蛙（物理）· 基础攻击力", "Gromp AD form · Base AD", "unit", ["DA_Gromp18_AD"]),
    c("gromp-ad-attack-speed", "buff", "0.7", "0.75", "魔沼蛙（物理）· 攻速", "Gromp AD form · Attack Speed", "unit", ["DA_Gromp18_AD"]),
    c("murkwolf-damage", "buff", "60/90/135 AD", "65/100/160 AD", "暗影狼 · 强化攻击伤害", "Murkwolf · Empowered attack damage", "unit", ["DA_Murkwolf18"]),
    c("warwick-damage", "buff", "215/325/500 AD", "230/345/535 AD", "沃里克 · 技能伤害", "Warwick · Spell damage", "unit", ["DA_18_Warwick"]),
    c("warwick-healing", "buff", "20%", "25%", "沃里克 · 技能治疗", "Warwick · Spell healing", "unit", ["DA_18_Warwick"]),
    c("mama-beak-base-ad", "buff", "55", "60", "巨喙鸟妈妈 · 基础攻击力", "Mama Beak · Base AD", "unit", ["DA_CrimsonRaptor18"])
  ]),
  g("灵火", "Wisps", [
    c("stat-boosters-resists", "nerf", "10", "8", "能力值强化 · 护甲与魔抗", "Stat Boosters · Armor and Magic Resist", "wisp"),
    c("stat-boosters-attack-speed", "nerf", "8%", "6%", "能力值强化 · 攻速", "Stat Boosters · Attack Speed", "wisp"),
    c("combust-explosion", "buff", "12%", "15%", "爆发四散 · 爆炸伤害", "Combust · Explosion damage", "wisp"),
    c("mana-rich-soil", "nerf", "25/18%", "20/15%", "魔力土壤 · 法力减免", "Mana-Rich Soil · Mana reduction", "wisp"),
    c("search-party-cost", "buff", "3/1g", "1/0g", "搜索队 · 价格", "Search Party · Cost", "wisp"),
    c("three-me-cost", "nerf", "9g", "10g", "三个我 · 价格", "Three Me · Cost", "wisp")
  ]),
  g("强化符文", "Augments", [
    c("challengers-grace", "buff", "3s", "4s", "挑战者恩惠 · 增益持续时间", "Challenger's Grace · Buff duration", "augment"),
    c("early-learnings", "nerf", "5%", "3%", "早期教育 · 基础攻击力 / 法强", "Early Learnings · Baseline AD / AP", "augment"),
    c("electrocharge-i", "nerf", "30/50/70/90", "25/40/60/80", "电火花 I · 各阶段伤害", "Electrocharge I · Damage by stage", "augment"),
    c("future-focused", "nerf", "8g", "5g", "着眼未来 · 金币", "Future Focused · Gold", "augment"),
    c("giant-and-mighty", "buff", "200", "225", "巨大强悍 · 生命值", "Giant and Mighty · Health", "augment"),
    c("group-hug-i", "buff", "6", "7", "抱团取暖 I · 双抗", "Group Hug I · Resists", "augment"),
    c("group-hug-ii", "buff", "9", "10", "抱团取暖 II · 双抗", "Group Hug II · Resists", "augment"),
    c("heroic-grab-bag", "buff", "4g", "6g", "英雄礼包 · 初始金币", "Heroic Grab Bag · Initial gold", "augment"),
    c("hold-the-line-ad", "buff", "9%", "11%", "坚守前线 · 攻击力", "Hold the Line · AD", "augment"),
    c("hold-the-line-ap", "buff", "10%", "11%", "坚守前线 · 法强", "Hold the Line · AP", "augment"),
    c("spirit-of-redemption", "buff", "7.5%", "9%", "救赎之魂 · 治疗", "Spirit of Redemption · Heal", "augment")
  ])
]);

export const PATCH_18_4_REVISION = Object.freeze({
  id: "18.4-release-2026-10-07",
  publishedAt: "2026-10-07",
  kind: "release",
  title: t("18.4 正式版本数值调整", "18.4 release numeric changes"),
  summary: t(
    "共 91 项数值记录。战斗进退场各缩短 1 秒；艾希与德莱文技能落空会返还法力，日蚀拉克丝新增伤害效果；建构伙伴、暗黑仪式和铸造朋友重新启用，大型变形术修复后恢复；新增四种 0 金币灵火并包含多项修复。上述机制与状态没有完整前后数值，未计入数值清单。",
    "91 numeric records. Combat arrival and departure are each one second shorter; Ashe and Draven refund Mana on misses, Solar Lux gains a new damage effect, three Augments and Greater Polymorph return, four zero-cost Wisps are added, and bugs are fixed. Non-numeric rules and statuses are summarized but excluded from the numeric list."
  ),
  sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-18-4/",
  groups: releaseGroups
});

export const PATCH_18_4_HOTFIX = Object.freeze({
  id: "18.4-hotfix-2026-10-07",
  publishedAt: "2026-10-07",
  kind: "hotfix",
  title: t("18.4 B 补丁", "18.4 B-patch"),
  summary: t(
    "10 月 7 日 B 补丁追加 28 项数值记录，并修复衡量价值、技能消失、最大最小化磁性卸除器及强化符文大厅上限等问题。钢铁之心暂时禁用；胖胖龙水花派对、黎明与黑夜和进步之桥竞技场因性能问题暂时禁用。官方说明先推送 PC、移动端随后跟进；截至 10 月 8 日不假定移动端已全部完成。重复出现的数值是最终落点，不得在首发值上再次叠加。",
    "The October 7 B-patch adds 28 numeric records plus bug fixes. Heart of Steel and three Arenas are temporarily disabled. Riot says PC rolls out first with mobile to follow; mobile completion is not assumed as of October 8. Repeated values are final endpoints and must not be compounded with the release changes."
  ),
  sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/",
  groups: hotfixGroups
});

export const PATCH_18_4_REVISIONS = Object.freeze([PATCH_18_4_REVISION, PATCH_18_4_HOTFIX]);
