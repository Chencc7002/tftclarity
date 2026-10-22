// Verified against Riot's Traditional Chinese and English 18.5 release notes.
// Official timestamp: 2026-10-20T18:00:00.000Z = October 21 02:00 Asia/Shanghai.
const t = (zh, en) => Object.freeze({ "zh-CN": zh, "en-US": en });
const c = (id, direction, before, after, zh, en, entityType = "system", entityApiNames = [], stat = id) => Object.freeze({
  id, direction, before, after, text: t(zh, en), entityType, entityApiNames: Object.freeze(entityApiNames), stat
});
const g = (zh, en, changes) => Object.freeze({ title: t(zh, en), changes: Object.freeze(changes) });

const releaseGroups = Object.freeze([
  g("羁绊", "Traits", [
    c("blackthorn-six-enhanced", "nerf", "60%", "50%", "黑荆棘（6）· 强化加成", "Blackthorn (6) · Enhanced bonus", "trait", ["DA_18_Blackthorn"]),
    c("blackthorn-ap-sacrifice", "nerf", "12% Damage Amp + 2 Mana Regen", "10% Damage Amp + 2 Mana Regen", "黑荆棘 · 基础法系献祭", "Blackthorn · Base AP sacrifice", "trait", ["DA_18_Blackthorn"]),
    c("elderwood-nine-health", "nerf", "140%", "125%", "神木精灵（9）· 召唤物额外生命", "Elderwood (9) · Summon bonus Health", "trait", ["DA_18_Elderwood"]),
    c("fae-heal", "buff", "2.5/4%", "3/5%", "妖精（2/4）· 治疗量", "Fae (2/4) · Heal", "trait", ["DA_18_Fae"]),
    c("fae-fourth-pixie", "buff", "30,000", "25,000", "妖精 · 第四个黄金皮克斯门槛", "Fae · Fourth Golden Pixie threshold", "trait", ["DA_18_Fae"]),
    c("fae-fifth-pixie", "buff", "70,000", "60,000", "妖精 · 第五个黄金皮克斯门槛", "Fae · Fifth Golden Pixie threshold", "trait", ["DA_18_Fae"]),
    c("fae-sixth-pixie", "buff", "110,000", "100,000", "妖精 · 第六个黄金皮克斯门槛", "Fae · Sixth Golden Pixie threshold", "trait", ["DA_18_Fae"]),
    c("flora-fatalis-heal", "nerf", "8%", "7%", "绝命花华 · 最大生命值治疗", "Flora Fatalis · Max-Health healing", "trait", ["DA_FloraFatalis18"]),
    c("rapidfire-as", "nerf", "3/5/8/12%", "3/5/7/10%", "速射 · 每次攻击获得攻速", "Rapidfire · Attack Speed per attack", "trait", ["DA_18_Rapidfire"]),
    c("riftbeast-seven-ad-ap", "nerf", "6%", "5%", "峡谷巨兽（7）· 攻击力 / 法强", "Riftbeast (7) · AD / AP", "trait", ["DA_Riftbeast18"])
  ]),
  g("二费弈子", "Tier 2 champions", [
    c("caitlyn-empowered-auto", "buff", "190/285/470 AD", "200/300/490 AD", "凯特琳 · 强化普攻伤害", "Caitlyn · Empowered attack damage", "unit", ["DA_18_Caitlyn"])
  ]),
  g("三费弈子", "Tier 3 champions", [
    c("azir-damage", "nerf", "46/69/110 AP", "43/65/105 AP", "阿兹尔 · 技能伤害", "Azir · Ability damage", "unit", ["DA_18_Azir"]),
    c("khazix-unisolated", "nerf", "255/360/515 AP", "250/345/500 AP", "卡兹克 · 非孤立目标伤害", "Kha'Zix · Unisolated damage", "unit", ["DA_18_KhaZix"]),
    c("khazix-isolated", "nerf", "285/410/605 AP", "280/390/590 AP", "卡兹克 · 孤立目标伤害", "Kha'Zix · Isolated damage", "unit", ["DA_18_KhaZix"]),
    c("mama-beak-damage", "nerf", "22/33/52 AD", "20/30/50 AD", "巨喙鸟妈妈 · 技能攻击力倍率", "Mama Beak · Ability AD ratio", "unit", ["DA_CrimsonRaptor18"]),
    c("master-yi-ad-starting-ad", "buff", "60", "63", "易大师（物理）· 初始攻击力", "Master Yi AD form · Starting AD", "unit", ["DA_18_MasterYi_AD"]),
    c("master-yi-ap-damage", "buff", "125/190/285 AP", "135/200/320 AP", "易大师（法系）· 技能伤害", "Master Yi AP form · Ability damage", "unit", ["DA_18_MasterYi_AP"]),
    c("tristana-mana", "buff", "0/60", "0/50", "崔丝塔娜 · 法力", "Tristana · Mana", "unit", ["DA_18_Tristana"]),
    c("tristana-damage-per-attack", "buff", "10/15/25 AD", "12/18/28 AD", "崔丝塔娜 · 每次攻击技能伤害", "Tristana · Ability damage per attack", "unit", ["DA_18_Tristana"])
  ]),
  g("四费弈子", "Tier 4 champions", [
    c("brambleback-heal", "buff", "4%", "5%", "树精长老 · 首领标记治疗", "Brambleback · Alpha Mark heal", "unit", ["DA_Brambleback18"]),
    c("brambleback-armor-ignore", "buff", "20% + 25% AP", "25% + 25% AP", "树精长老 · 无视护甲", "Brambleback · Armor ignore", "unit", ["DA_Brambleback18"]),
    c("malphite-shield", "buff", "700/850 AP", "735/885 AP", "墨菲特 · 护盾", "Malphite · Shield", "unit", ["DA_18_Malphite"]),
    c("morgana-initial-curse", "buff", "60/90 AP", "70/105 AP", "莫甘娜 · 初始诅咒伤害", "Morgana · Initial curse damage", "unit", ["DA_18_Morgana"]),
    c("morgana-curse-bonus", "buff", "22/33 AP", "25/38 AP", "莫甘娜 · 诅咒额外伤害", "Morgana · Curse bonus damage", "unit", ["DA_18_Morgana"]),
    c("sentinel-stun", "nerf", "1s", "0.5s", "苍蓝雕纹魔像 · 晕眩时间", "Sentinel · Stun duration", "unit", ["DA_Sentinel18"]),
    c("sentinel-shield", "buff", "350/450 AP", "375/475 AP", "苍蓝雕纹魔像 · 护盾", "Sentinel · Shield", "unit", ["DA_Sentinel18"]),
    c("sett-heal", "buff", "225/275 AP", "250/300 AP", "瑟提 · 治疗法强倍率", "Sett · Heal AP ratio", "unit", ["DA_18_Sett"]),
    c("sivir-damage", "buff", "200/300 AD", "220/330 AD", "希维尔 · 技能伤害", "Sivir · Ability damage", "unit", ["DA_18_Sivir"]),
    c("sivir-bounce", "nerf", "20% of initial", "18% of initial", "希维尔 · 弹射伤害", "Sivir · Bounce damage", "unit", ["DA_18_Sivir"]),
    c("soraka-initial-star", "buff", "225/335 AP", "235/355 AP", "索拉卡 · 首颗星体伤害", "Soraka · Initial star damage", "unit", ["DA_18_Soraka"]),
    c("soraka-additional-star", "buff", "100/150 AP", "110/165 AP", "索拉卡 · 额外星体伤害", "Soraka · Additional star damage", "unit", ["DA_18_Soraka"])
  ]),
  g("五费弈子", "Tier 5 champions", [
    c("alune-moonshard", "buff", "55/83 AP", "58/88 AP", "拉露恩 · 月华碎片伤害", "Alune · Moonshard damage", "unit", ["DA_18_Alune"]),
    c("alune-attack-speed", "buff", "0.8", "0.85", "拉露恩 · 攻速", "Alune · Attack Speed", "unit", ["DA_18_Alune"]),
    c("alune-durability", "nerf", "7%", "5%", "拉露恩 · 调和续战力", "Alune · Attuned durability", "unit", ["DA_18_Alune"]),
    c("ashe-dot", "buff", "9/14 AD", "11/16 AD", "艾希 · 持续伤害", "Ashe · Damage over time", "unit", ["DA_18_Ashe"]),
    c("taric-resists", "buff", "65", "70", "塔里克 · 双抗", "Taric · Resists", "unit", ["DA_Taric18"]),
    c("taric-empowered-attacks", "buff", "100/150 AP", "130/200 AP", "塔里克 · 技能强化两次普攻伤害", "Taric · Empowered two-attack damage", "unit", ["DA_Taric18"])
  ]),
  g("光明装备", "Radiant items", [
    c("radiant-adaptive-helm-mana", "nerf", "7", "6", "光明适应性头盔 · 法力回复", "Radiant Adaptive Helm · Mana Regen", "item", ["TFT5_Item_AdaptiveHelmRadiant"]),
    c("radiant-adaptive-helm-offense", "nerf", "40", "35", "光明适应性头盔 · 非坦克 / 战士攻击力与法强", "Radiant Adaptive Helm · Non-tank/fighter AD and AP", "item", ["TFT5_Item_AdaptiveHelmRadiant"]),
    c("radiant-blue-buff-offense", "nerf", "30%", "25%", "光明蓝霸符 · 基础攻击力与法强", "Radiant Blue Buff · Base AD and AP", "item", ["TFT5_Item_BlueBuffRadiant"])
  ]),
  g("强化符文", "Augments", [
    c("bronze-for-life-ii", "nerf", "3%", "2.5%", "铜级之命 II · 每个羁绊提供双抗", "Bronze for Life II · Resists per trait", "augment"),
    c("build-a-bud-gold", "buff", "6g", "9g", "组装伙伴 · 金币", "Build-A-Bud · Gold", "augment"),
    c("challengers-grace-as", "buff", "25%", "30%", "挑战者恩惠 · 攻速增益", "Challenger's Grace · Attack Speed buff", "augment"),
    c("cooking-pot-health", "buff", "60", "70", "烹饪锅 · 每枚徽章提供生命值", "Cooking Pot · Health per Emblem", "augment"),
    c("consuming-flora", "buff", "50%", "70%", "夺命花华 · 额外效益", "Consuming Flora · Bonus effectiveness", "augment"),
    c("cry-me-a-river", "nerf", "4", "3", "泪如泉涌 · 法力回复加成", "Cry Me a River · Mana Regen bonus", "augment"),
    c("dark-ritual-ap", "nerf", "7/12/33/50/100/175/300/400", "5/10/28/45/85/175/300/400", "暗黑仪式 · 获得法强", "Dark Ritual · AP granted", "augment"),
    c("embiggen", "buff", "10%", "18%", "妖精巨化 · 基础攻击力 / 法强加成", "Embiggen · Base AD / AP bonus", "augment"),
    c("expected-unexpectedness-stage-three-gold", "nerf", "18g", "15g", "预料中的意外 · 第三阶段金币", "Expected Unexpectedness · Stage 3 gold", "augment"),
    c("expected-unexpectedness-stage-four-gold", "nerf", "20g", "18g", "预料中的意外 · 第四阶段金币", "Expected Unexpectedness · Stage 4 gold", "augment"),
    c("expected-unexpectedness-five-costs", "nerf", "3", "2", "预料中的意外 · 第四阶段五费弈子数量", "Expected Unexpectedness · Stage 4 five-cost count", "augment"),
    c("flowing-tears-threshold", "nerf", "6500", "7000", "泪光闪闪 · 兑现法力门槛", "Flowing Tears · Mana threshold for cashout", "augment"),
    c("investment-strategy-i-gold", "nerf", "6g", "3g", "投资策略 I · 初始金币", "Investment Strategy I · Initial gold", "augment"),
    c("investment-strategy-ii-gold", "nerf", "10g", "6g", "投资策略 II · 初始金币", "Investment Strategy II · Initial gold", "augment"),
    c("malicious-monetization-gold", "buff", "4g", "6g", "恶性经营 · 初始金币", "Malicious Monetization · Initial gold", "augment"),
    c("nesting-anvils-gold", "buff", "4g", "6g", "套娃铁砧 · 金币", "Nesting Anvils · Gold", "augment"),
    c("omega-riftbeast-health", "nerf", "10%", "8%", "战争机器：峡谷巨兽 · 额外生命值", "Omega Riftbeast · Bonus Health", "augment"),
    c("omega-riftbeast-as", "nerf", "10%", "8%", "战争机器：峡谷巨兽 · 额外攻速", "Omega Riftbeast · Bonus Attack Speed", "augment"),
    c("pandoras-bench-gold", "nerf", "4g", "1g", "潘朵拉的备战区 · 金币", "Pandora's Bench · Gold", "augment"),
    c("pandoras-items-ii-gold", "nerf", "4g", "1g", "潘朵拉的装备 II · 金币", "Pandora's Items II · Gold", "augment"),
    c("patience-is-a-virtue-rerolls", "buff", "4", "5", "耐心是美德 · 初始刷新次数", "Patience is a Virtue · Initial rerolls", "augment"),
    c("prismatic-destiny-gold", "nerf", "4g", "2g", "棱彩命运 · 金币", "Prismatic Destiny · Gold", "augment"),
    c("promised-protection-health", "nerf", "200", "175", "誓言守护 · 生命值", "Promised Protection · Health", "augment"),
    c("seraphims-staff-threshold", "nerf", "90%", "110%", "炽天使之杖 · 法强门槛", "Seraphim's Staff · AP threshold", "augment")
  ]),
  g("灵火", "Wisps", [
    c("abandon-ship-cost", "nerf", "0g", "2g", "弃船 · 价格", "Abandon Ship · Cost", "wisp"),
    c("beggars-wisp-gold", "nerf", "3/5g", "2/3g", "乞求灵火 · 金币", "Beggar's Wisp · Gold", "wisp"),
    c("blood-and-iron-cost", "nerf", "3g (bug)", "4g", "鲜血与钢铁 · 价格", "Blood and Iron · Cost", "wisp"),
    c("hand-of-baron-cost", "buff", "6g", "4g", "巴龙之爪 · 价格", "Hand of Baron · Cost", "wisp"),
    c("hand-of-baron-stats", "nerf", "33/55 HP + 3/5% stats", "22/33 HP + 2/3% stats", "巴龙之爪 · 生命值与综合属性", "Hand of Baron · Health and aggregate stats", "wisp"),
    c("hand-of-baron-crit", "nerf", "10/15%", "6/8%", "巴龙之爪 · 暴击率", "Hand of Baron · Critical Strike Chance", "wisp"),
    c("heroic-sacrifice-health", "nerf", "1200/1500", "1000/1250", "英勇牺牲 · 额外生命值", "Heroic Sacrifice · Bonus Health", "wisp")
  ])
]);

export const PATCH_18_5_REVISION = Object.freeze({
  id: "18.5-release-2026-10-21",
  publishedAt: "2026-10-21",
  kind: "release",
  title: t("18.5 正式版本数值调整", "18.5 release numeric changes"),
  summary: t(
    "共 71 项数值记录。官方还调整了物理 / 法系强化符文的出现倾向，缩短巨喙鸟妈妈约 1 秒的法力锁定；钢铁之心因漏洞再次停用，道具抽取不再给予维迦，新增潘朵拉的装备 II+ / II++；灵火筛选改看备战区与上一场战斗，并包含错误、稳定性修复和 52 款风格装饰回归。上述规则、状态与新增内容没有完整前后数值，未计入数值清单。",
    "71 numeric records. Riot also adjusts AD/AP Augment tailoring, shortens Mama Beak's Mana lock by about one second, re-disables Heart of Steel, removes Veigar from Item Extraction, adds Pandora's Items II+ and II++, revises Wisp filtering, fixes bugs and stability issues, and restores 52 cosmetics. Rules, statuses, and new content without complete endpoints are summarized but excluded from the numeric list."
  ),
  sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-18-5/",
  groups: releaseGroups
});

export const PATCH_18_5_REVISIONS = Object.freeze([PATCH_18_5_REVISION]);
