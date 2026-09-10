// Riot official release, published 2026-09-09T18:00:00.000Z.
// See docs/patch-notes-18-2-20260910.md for source and editorial decisions.
export const PATCH_18_2_REVISION = Object.freeze({
  id: "18.2-release-2026-09-09",
  parentId: null,
  kind: "release",
  publishedAt: "2026-09-09",
  title: {"zh-CN": "18.2 正式版本数值调整", "en-US": "Patch 18.2 release balance changes"},
  summary: {"zh-CN": "共 157 项数值变更：升级经验与灵火价格下调，英雄、羁绊、装备和强化符文同步调整。", "en-US": "157 numeric changes covering leveling XP, Wisp costs, champions, traits, items, and Augments."},
  groups: [
    {
      title: {"zh-CN": "系统", "en-US": "Systems"},
      changes: [
        {"id": "xp-8", "direction": "buff", "before": "60", "after": "56", "text": {"zh-CN": "升至 8 级所需经验", "en-US": "XP to level 8"}},
        {"id": "xp-9", "direction": "buff", "before": "68", "after": "64", "text": {"zh-CN": "升至 9 级所需经验", "en-US": "XP to level 9"}},
        {"id": "xp-10", "direction": "buff", "before": "68", "after": "64", "text": {"zh-CN": "升至 10 级所需经验", "en-US": "XP to level 10"}},
      ]
    },
    {
      title: {"zh-CN": "羁绊", "en-US": "Traits"},
      changes: [
        {"id": "blackthorn-health", "direction": "buff", "before": "175/300/550", "after": "175/350/600", "text": {"zh-CN": "黑荆棘 · 生命值", "en-US": "Blackthorn · Health"}},
        {"id": "blackthorn-tank", "direction": "nerf", "before": "15", "after": "12", "text": {"zh-CN": "黑荆棘 · 坦克献祭双抗", "en-US": "Blackthorn · Tank sacrifice resists"}},
        {"id": "blackthorn-ad", "direction": "buff", "before": "12%", "after": "14%", "text": {"zh-CN": "黑荆棘 · 物理献祭基础攻速", "en-US": "Blackthorn · AD sacrifice base AS"}},
        {"id": "blackthorn-ap", "direction": "buff", "before": "1.7", "after": "2", "text": {"zh-CN": "黑荆棘 · 法系献祭基础法力回复", "en-US": "Blackthorn · AP sacrifice base Mana Regen"}},
        {"id": "coven-185-gold", "direction": "buff", "before": "8", "after": "10", "text": {"zh-CN": "魔女 185 精华 · 成装铁砧奖励金币", "en-US": "Coven 185 Essence · Completed Anvil reward gold"}},
        {"id": "coven-250-anvils", "direction": "buff", "before": "12", "after": "20", "text": {"zh-CN": "魔女 250 精华 · 双成装铁砧奖励金币", "en-US": "Coven 250 Essence · Two Completed Anvils reward gold"}},
        {"id": "coven-250-chests", "direction": "buff", "before": "6", "after": "18", "text": {"zh-CN": "魔女 250 精华 · 双幸运装备宝箱奖励金币", "en-US": "Coven 250 Essence · Two Lucky Item Chests reward gold"}},
        {"id": "coven-250-lux", "direction": "buff", "before": "5", "after": "18", "text": {"zh-CN": "魔女 250 精华 · 拉克丝奖励组金币", "en-US": "Coven 250 Essence · Lux reward gold"}},
        {"id": "coven-250-artifact", "direction": "buff", "before": "5", "after": "18", "text": {"zh-CN": "魔女 250 精华 · 神器铁砧奖励组金币", "en-US": "Coven 250 Essence · Artifact Anvil reward gold"}},
        {"id": "coven-365-gold", "direction": "buff", "before": "0", "after": "12", "text": {"zh-CN": "魔女 365 精华 · 所有奖励额外金币", "en-US": "Coven 365 Essence · Additional gold on all rewards"}},
        {"id": "fae-pixies", "direction": "buff", "before": "200000/250000/330000/420000/510000/610000", "after": "170000/200000/300000/400000/500000/600000", "text": {"zh-CN": "花仙子 · 前六只黄金皮克斯门槛", "en-US": "Fae · First six Golden Pixie thresholds"}},
        {"id": "hunter-duration", "direction": "buff", "before": "4", "after": "3", "text": {"zh-CN": "猎人 · 触发伤害增幅所需锁定时间（秒）", "en-US": "Hunter · Targeting time required for damage amp (seconds)"}},
        {"id": "inferno-burn", "direction": "buff", "before": "1/1/3/3.5%", "after": "1/1/3.5/4.5%", "text": {"zh-CN": "地狱火 · 灼烧伤害", "en-US": "Inferno · Burn damage"}},
        {"id": "rapidfire-as", "direction": "nerf", "before": "3/5/9/15%", "after": "3/5/8/12%", "text": {"zh-CN": "迅捷射手 · 每次攻击获得攻速", "en-US": "Rapidfire · AS per attack"}},
        {"id": "solar-base", "direction": "buff", "before": "7%", "after": "8%", "text": {"zh-CN": "日蚀骑士 · 初始额外魔法伤害", "en-US": "Solar · Initial bonus magic damage"}},
        {"id": "solar-scaling", "direction": "nerf", "before": "1.5%", "after": "1%", "text": {"zh-CN": "日蚀骑士 · 每名三星弈子的伤害加成", "en-US": "Solar · Bonus per three-star"}},
        {"id": "solar-as", "direction": "nerf", "before": "18%", "after": "15%", "text": {"zh-CN": "日蚀骑士 · 三名三星弈子攻速奖励", "en-US": "Solar · Three three-star AS bonus"}},
        {"id": "solar-resists", "direction": "nerf", "before": "15", "after": "12", "text": {"zh-CN": "日蚀骑士 · 三名三星弈子双抗奖励", "en-US": "Solar · Three three-star resists bonus"}},
      ]
    },
    {
      title: {"zh-CN": "一费弈子", "en-US": "Tier 1 champions"},
      changes: [
        {"id": "akali-mana", "direction": "buff", "before": "0/30", "after": "0/25", "text": {"zh-CN": "阿卡丽（物理形态）· 法力值", "en-US": "Akali (AD form) · Mana"}},
        {"id": "leona-mana", "direction": "buff", "before": "40/100", "after": "30/90", "text": {"zh-CN": "蕾欧娜 · 法力值", "en-US": "Leona · Mana"}},
        {"id": "leona-resists", "direction": "buff", "before": "60/70/80/100", "after": "60/80/100/130", "text": {"zh-CN": "蕾欧娜 · 衰减双抗", "en-US": "Leona · Decaying resists"}},
        {"id": "varus-damage", "direction": "buff", "before": "385/580/925/1530%", "after": "415/625/1000/1700%", "text": {"zh-CN": "韦鲁斯 · 技能攻击力倍率", "en-US": "Varus · Ability AD ratio"}},
      ]
    },
    {
      title: {"zh-CN": "二费弈子", "en-US": "Tier 2 champions"},
      changes: [
        {"id": "leblanc-damage", "direction": "buff", "before": "250/375/565/955%", "after": "260/390/615/1045%", "text": {"zh-CN": "乐芙兰 · 技能法强倍率", "en-US": "LeBlanc · Ability AP ratio"}},
        {"id": "leblanc-aoe", "direction": "buff", "before": "85/130/190%", "after": "100/150/230%", "text": {"zh-CN": "乐芙兰 · 一至三星范围伤害法强倍率", "en-US": "LeBlanc · One to three-star AoE AP ratio"}},
        {"id": "kayle-hit", "direction": "buff", "before": "56/84/95%", "after": "62/92/105%", "text": {"zh-CN": "凯尔 · 攻击附带魔法伤害法强倍率", "en-US": "Kayle · On-hit AP ratio"}},
        {"id": "kayle-wave", "direction": "nerf", "before": "40/40/40/50%", "after": "35/35/35/45%", "text": {"zh-CN": "凯尔 · 波浪伤害法强倍率", "en-US": "Kayle · Wave AP ratio"}},
        {"id": "shen-shield", "direction": "buff", "before": "325/400/500/600%", "after": "350/430/550/700%", "text": {"zh-CN": "慎 · 护盾法强倍率", "en-US": "Shen · Shield AP ratio"}},
        {"id": "warwick-ad", "direction": "buff", "before": "40", "after": "45", "text": {"zh-CN": "沃里克 · 攻击力", "en-US": "Warwick · AD"}},
        {"id": "yunara-damage", "direction": "buff", "before": "150/225/335/570%", "after": "160/240/370/630%", "text": {"zh-CN": "芸阿娜 · 技能攻击力倍率", "en-US": "Yunara · Ability AD ratio"}},
      ]
    },
    {
      title: {"zh-CN": "三费弈子", "en-US": "Tier 3 champions"},
      changes: [
        {"id": "azir-damage", "direction": "buff", "before": "40/60/96/165%", "after": "43/65/103/175%", "text": {"zh-CN": "阿兹尔 · 沙兵技能法强倍率", "en-US": "Azir · Soldier ability AP ratio"}},
        {"id": "diana-damage", "direction": "buff", "before": "70/105/170%", "after": "75/115/180%", "text": {"zh-CN": "黛安娜 · 每颗法球法强倍率", "en-US": "Diana · Per-orb AP ratio"}},
        {"id": "diana-shield", "direction": "buff", "before": "150/275/400", "after": "150/275/500", "text": {"zh-CN": "黛安娜 · 护盾", "en-US": "Diana · Shield"}},
        {"id": "khazix-ad", "direction": "buff", "before": "30", "after": "40", "text": {"zh-CN": "卡兹克 · 基础攻击力", "en-US": "Kha'Zix · Base AD"}},
        {"id": "mama-beak-ad", "direction": "buff", "before": "50", "after": "55", "text": {"zh-CN": "深红锋喙鸟 · 基础攻击力", "en-US": "Mama Beak · Base AD"}},
        {"id": "mama-beak-damage", "direction": "buff", "before": "20/30/48%", "after": "22/33/48%", "text": {"zh-CN": "深红锋喙鸟 · 技能攻击力倍率", "en-US": "Mama Beak · Ability AD ratio"}},
        {"id": "master-yi-ad", "direction": "nerf", "before": "65", "after": "60", "text": {"zh-CN": "易（物理形态）· 基础攻击力", "en-US": "Master Yi (AD form) · Base AD"}},
        {"id": "master-yi-ap", "direction": "nerf", "before": "140/210/335%", "after": "125/190/285%", "text": {"zh-CN": "易（法系形态）· 技能法强倍率", "en-US": "Master Yi (AP form) · Ability AP ratio"}},
        {"id": "rengar-as", "direction": "nerf", "before": "0.8", "after": "0.75", "text": {"zh-CN": "雷恩加尔 · 基础攻速", "en-US": "Rengar · Base AS"}},
      ]
    },
    {
      title: {"zh-CN": "四费弈子", "en-US": "Tier 4 champions"},
      changes: [
        {"id": "ahri-damage", "direction": "buff", "before": "425/640%", "after": "455/685%", "text": {"zh-CN": "阿狸 · 技能法强倍率", "en-US": "Ahri · Ability AP ratio"}},
        {"id": "ahri-falloff", "direction": "nerf", "before": "20%", "after": "21%", "text": {"zh-CN": "阿狸 · 每格伤害衰减", "en-US": "Ahri · Damage falloff per hex"}},
        {"id": "brambleback-ad", "direction": "buff", "before": "115", "after": "120", "text": {"zh-CN": "绯红印记树怪 · 基础攻击力", "en-US": "Brambleback · Base AD"}},
        {"id": "brambleback-armor", "direction": "buff", "before": "10%", "after": "15%", "text": {"zh-CN": "绯红印记树怪 · 基础护甲忽略", "en-US": "Brambleback · Base Armor ignore"}},
        {"id": "brambleback-leap", "direction": "nerf", "before": "170/255%", "after": "155/235%", "text": {"zh-CN": "绯红印记树怪 · 跃击攻击力倍率", "en-US": "Brambleback · Leap AD ratio"}},
        {"id": "ezreal-damage", "direction": "buff", "before": "235/355%", "after": "250/375%", "text": {"zh-CN": "伊泽瑞尔 · 主目标技能攻击力倍率", "en-US": "Ezreal · Primary ability AD ratio"}},
        {"id": "sentinel-shield", "direction": "nerf", "before": "400/500%", "after": "350/450%", "text": {"zh-CN": "苍蓝雕纹魔像 · 技能护盾法强倍率", "en-US": "Sentinel · Ability shield AP ratio"}},
        {"id": "nidalee-ap", "direction": "buff", "before": "285/425%", "after": "300/450%", "text": {"zh-CN": "奈德丽（法系形态）· 强化攻击法强倍率", "en-US": "Nidalee (AP form) · Empowered attack AP ratio"}},
        {"id": "zyra-damage", "direction": "nerf", "before": "37/55%", "after": "35/53%", "text": {"zh-CN": "婕拉 · 技能法强倍率", "en-US": "Zyra · Ability AP ratio"}},
      ]
    },
    {
      title: {"zh-CN": "五费弈子", "en-US": "Tier 5 champions"},
      changes: [
        {"id": "ashe-damage", "direction": "buff", "before": "440/660%", "after": "465/700%", "text": {"zh-CN": "艾希 · 箭矢攻击力倍率", "en-US": "Ashe · Arrow AD ratio"}},
        {"id": "ivern-hexes", "direction": "buff", "before": "2", "after": "3", "text": {"zh-CN": "艾翁 · 初始格子数量", "en-US": "Ivern · Starting hexes"}},
        {"id": "ivern-shield", "direction": "buff", "before": "165/300%", "after": "185/350%", "text": {"zh-CN": "艾翁 · 护盾法强倍率", "en-US": "Ivern · Shield AP ratio"}},
        {"id": "ivern-damage", "direction": "buff", "before": "140/210%", "after": "155/235%", "text": {"zh-CN": "艾翁 · 技能法强倍率", "en-US": "Ivern · Ability AP ratio"}},
        {"id": "lux-damage", "direction": "buff", "before": "355/550%", "after": "375/565%", "text": {"zh-CN": "拉克丝 · 技能法强倍率", "en-US": "Lux · Ability AP ratio"}},
        {"id": "maokai-mana", "direction": "buff", "before": "40/100", "after": "30/90", "text": {"zh-CN": "茂凯 · 法力值", "en-US": "Maokai · Mana"}},
        {"id": "taric-shield-base", "direction": "nerf", "before": "175/350", "after": "100/225", "text": {"zh-CN": "塔里克 · 被动护盾基础值", "en-US": "Taric · Passive shield base"}},
        {"id": "taric-shield-hp", "direction": "buff", "before": "10%", "after": "15%", "text": {"zh-CN": "塔里克 · 被动护盾最大生命值倍率", "en-US": "Taric · Passive shield max-Health ratio"}},
        {"id": "taric-heal", "direction": "buff", "before": "200/300%", "after": "250/375%", "text": {"zh-CN": "塔里克 · 主动治疗法强倍率", "en-US": "Taric · Active heal AP ratio"}},
      ]
    },
    {
      title: {"zh-CN": "装备与光明装备", "en-US": "Items and Radiant items"},
      changes: [
        {"id": "bloodthirster-trigger", "direction": "buff", "before": "40%", "after": "50%", "text": {"zh-CN": "饮血剑 · 触发血量", "en-US": "Bloodthirster · Trigger Health"}},
        {"id": "bloodthirster-stats", "direction": "buff", "before": "15%", "after": "18%", "text": {"zh-CN": "饮血剑 · 攻击力 / 法强", "en-US": "Bloodthirster · AD / AP"}},
        {"id": "bloodthirster-shield", "direction": "buff", "before": "25%", "after": "30%", "text": {"zh-CN": "饮血剑 · 最大生命值护盾", "en-US": "Bloodthirster · Max-Health shield"}},
        {"id": "edge-of-night", "direction": "mixed", "before": "60% / 20%", "after": "40% / 15%", "text": {"zh-CN": "夜之锋刃 · 触发血量 / 已损失生命治疗比例", "en-US": "Edge of Night · Trigger Health / missing-Health healing"}},
        {"id": "hand-of-justice-stats", "direction": "buff", "before": "15%", "after": "18%", "text": {"zh-CN": "正义之手 · 基础攻击力 / 法强", "en-US": "Hand of Justice · Base AD / AP"}},
        {"id": "hand-of-justice-vamp", "direction": "buff", "before": "12%", "after": "15%", "text": {"zh-CN": "正义之手 · 基础全能吸血", "en-US": "Hand of Justice · Base Omnivamp"}},
        {"id": "radiant-bloodthirster-trigger", "direction": "buff", "before": "40%", "after": "50%", "text": {"zh-CN": "光明饮血剑 · 触发血量", "en-US": "Radiant Bloodthirster · Trigger Health"}},
        {"id": "radiant-bloodthirster-stats", "direction": "buff", "before": "30%", "after": "40%", "text": {"zh-CN": "光明饮血剑 · 攻击力 / 法强", "en-US": "Radiant Bloodthirster · AD / AP"}},
        {"id": "radiant-bloodthirster-shield", "direction": "buff", "before": "50%", "after": "60%", "text": {"zh-CN": "光明饮血剑 · 最大生命值护盾", "en-US": "Radiant Bloodthirster · Max-Health shield"}},
        {"id": "radiant-edge-trigger", "direction": "mixed", "before": "60%", "after": "40%", "text": {"zh-CN": "光明夜之锋刃 · 触发血量（更晚触发）", "en-US": "Radiant Edge of Night · Trigger Health (later trigger)"}},
        {"id": "radiant-hand-vamp", "direction": "buff", "before": "24%", "after": "30%", "text": {"zh-CN": "光明正义之手 · 基础全能吸血", "en-US": "Radiant Hand of Justice · Base Omnivamp"}},
      ]
    },
    {
      title: {"zh-CN": "神器", "en-US": "Artifacts"},
      changes: [
        {"id": "blighting-jewel", "direction": "nerf", "before": "4", "after": "3", "text": {"zh-CN": "枯萎珠宝 · 魔抗削减", "en-US": "Blighting Jewel · MR reduction"}},
        {"id": "flickerblades", "direction": "nerf", "before": "5%", "after": "4%", "text": {"zh-CN": "烁刃· 每次攻击获得攻速", "en-US": "Flickerblades · AS per attack"}},
        {"id": "forbidden-idol", "direction": "buff", "before": "400", "after": "500", "text": {"zh-CN": "禁忌雕像 · 生命值", "en-US": "Forbidden Idol · Health"}},
        {"id": "ludens-tempest", "direction": "buff", "before": "100", "after": "130", "text": {"zh-CN": "卢登的激荡 · 击杀固定伤害", "en-US": "Luden's Tempest · On-kill flat damage"}},
        {"id": "silvermere-dawn", "direction": "buff", "before": "125%", "after": "150%", "text": {"zh-CN": "银白黎明 · 攻击力", "en-US": "Silvermere Dawn · AD"}},
        {"id": "wits-end", "direction": "nerf", "before": "30/55/75/95/115", "after": "25/45/65/85/100", "text": {"zh-CN": "智慧末刃 · 攻击附带伤害", "en-US": "Wit's End · On-hit damage"}},
      ]
    },
    {
      title: {"zh-CN": "转职纹章", "en-US": "Emblems"},
      changes: [
        {"id": "brawler-emblem", "direction": "nerf", "before": "250", "after": "150", "text": {"zh-CN": "斗士纹章 · 生命值", "en-US": "Brawler Emblem · Health"}},
        {"id": "fae-emblem-health", "direction": "nerf", "before": "250", "after": "200", "text": {"zh-CN": "花仙子纹章 · 生命值", "en-US": "Fae Emblem · Health"}},
        {"id": "fae-emblem-stats", "direction": "nerf", "before": "15%", "after": "10%", "text": {"zh-CN": "花仙子纹章 · 攻击力 / 法强", "en-US": "Fae Emblem · AD / AP"}},
        {"id": "hunter-emblem", "direction": "nerf", "before": "30%", "after": "25%", "text": {"zh-CN": "猎人纹章 · 基础攻击力", "en-US": "Hunter Emblem · Base AD"}},
        {"id": "invoker-emblem", "direction": "nerf", "before": "10%", "after": "8%", "text": {"zh-CN": "神谕纹章 · 消耗法力获得法强", "en-US": "Invoker Emblem · AP per Mana spent"}},
        {"id": "juggernaut-emblem", "direction": "nerf", "before": "350", "after": "250", "text": {"zh-CN": "主宰纹章 · 生命值", "en-US": "Juggernaut Emblem · Health"}},
        {"id": "primal-emblem", "direction": "buff", "before": "25%", "after": "35%", "text": {"zh-CN": "野兽之灵纹章 · 攻速", "en-US": "Primal Emblem · AS"}},
        {"id": "sprykin-emblem-as", "direction": "nerf", "before": "30%", "after": "20%", "text": {"zh-CN": "约德尔人纹章 · 骑乘者额外攻速", "en-US": "Sprykin Emblem · Rider bonus AS"}},
        {"id": "sprykin-emblem-resists", "direction": "nerf", "before": "20", "after": "15", "text": {"zh-CN": "约德尔人纹章 · 基础双抗", "en-US": "Sprykin Emblem · Base resists"}},
        {"id": "sprykin-emblem-rider", "direction": "nerf", "before": "20", "after": "15", "text": {"zh-CN": "约德尔人纹章 · 骑乘者额外双抗", "en-US": "Sprykin Emblem · Additional rider resists"}},
        {"id": "vanguard-emblem", "direction": "nerf", "before": "30", "after": "25", "text": {"zh-CN": "重装战士纹章 · 双抗", "en-US": "Vanguard Emblem · Armor / MR"}},
      ]
    },
    {
      title: {"zh-CN": "强化符文", "en-US": "Augments"},
      changes: [
        {"id": "barons-lair", "direction": "nerf", "before": "5%", "after": "4%", "text": {"zh-CN": "男爵巢穴（Baron's Lair）· 属性加成", "en-US": "Baron's Lair · Stats"}},
        {"id": "capital-gains", "direction": "buff", "before": "2", "after": "3", "text": {"zh-CN": "资本利得 II · 初始金币", "en-US": "Capital Gains II · Starting gold"}},
        {"id": "cursed-crown", "direction": "nerf", "before": "4%", "after": "0%", "text": {"zh-CN": "诅咒冠冕 · 伤害减免", "en-US": "Cursed Crown · Durability"}},
        {"id": "consuming-flora", "direction": "nerf", "before": "200%", "after": "150%", "text": {"zh-CN": "Consuming Flora · 纹章羁绊效果", "en-US": "Consuming Flora · Emblem trait effectiveness"}},
        {"id": "dark-ritual", "direction": "buff", "before": "5/12/40/60/100/175/250", "after": "7/15/50/75/125/200/300", "text": {"zh-CN": "黑暗仪式（Dark Ritual）· 七档收菜法强", "en-US": "Dark Ritual · AP at seven cashout tiers"}},
        {"id": "dummify", "direction": "buff", "before": "1000", "after": "1150", "text": {"zh-CN": "Dummify · 每回合生命值", "en-US": "Dummify · HP per round"}},
        {"id": "gold-destiny", "direction": "nerf", "before": "6", "after": "5", "text": {"zh-CN": "黄金命运+ · 金币", "en-US": "Gold Destiny+ · Gold"}},
        {"id": "golden-dragon", "direction": "nerf", "before": "20%", "after": "15%", "text": {"zh-CN": "Golden Dragon · 伤害减免", "en-US": "Golden Dragon · Durability"}},
        {"id": "hold-line-ap", "direction": "buff", "before": "9%", "after": "10%", "text": {"zh-CN": "Hold The Line · 法强", "en-US": "Hold The Line · AP"}},
        {"id": "hold-line-ad", "direction": "buff", "before": "8%", "after": "9%", "text": {"zh-CN": "Hold The Line · 攻击力", "en-US": "Hold The Line · AD"}},
        {"id": "investment-strategy", "direction": "buff", "before": "9", "after": "10", "text": {"zh-CN": "投资策略 II · 生命值", "en-US": "Investment Strategy II · HP"}},
        {"id": "prismatic-destiny", "direction": "nerf", "before": "10", "after": "7", "text": {"zh-CN": "棱彩命运+ · 金币", "en-US": "Prismatic Destiny+ · Gold"}},
        {"id": "shimmerscale-essence", "direction": "nerf", "before": "7", "after": "8", "text": {"zh-CN": "Shimmerscale Essence · 等待回合", "en-US": "Shimmerscale Essence · Delayed rounds"}},
        {"id": "unrivaled-mana", "direction": "nerf", "before": "70%", "after": "50%", "text": {"zh-CN": "无与伦比 · 卡兹克给予雷恩加尔的法力", "en-US": "Unrivaled · Mana from Kha'Zix to Rengar"}},
        {"id": "unrivaled-heal", "direction": "nerf", "before": "50%", "after": "25%", "text": {"zh-CN": "无与伦比 · 雷恩加尔给予卡兹克的治疗", "en-US": "Unrivaled · Healing from Rengar to Kha'Zix"}},
      ]
    },
    {
      title: {"zh-CN": "战斗灵火", "en-US": "Combat Wisps"},
      changes: [
        {"id": "barrier", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "光盾（Barrier）· 价格", "en-US": "Barrier · Cost"}},
        {"id": "backrow-star", "direction": "buff", "before": "3g", "after": "1g", "text": {"zh-CN": "后排巨星（Backrow Star）· 价格", "en-US": "Backrow Star · Cost"}},
        {"id": "bunch-o-belts", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "腰带多多（Bunch-o-Belts）· 价格", "en-US": "Bunch-o-Belts · Cost"}},
        {"id": "combust-cost", "direction": "buff", "before": "5g", "after": "3g", "text": {"zh-CN": "爆发四散（Combust）· 价格", "en-US": "Combust · Cost"}},
        {"id": "combust-damage", "direction": "nerf", "before": "15%", "after": "12%", "text": {"zh-CN": "爆发四散（Combust）· 最大生命值伤害", "en-US": "Combust · Max-Health damage"}},
        {"id": "downpour", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "倾盆大雨（Downpour）· 价格", "en-US": "Downpour · Cost"}},
        {"id": "infliction", "direction": "buff", "before": "6g", "after": "4g", "text": {"zh-CN": "施加痛苦（Infliction）· 价格", "en-US": "Infliction · Cost"}},
        {"id": "ironwood", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "铁木（Ironwood）· 价格", "en-US": "Ironwood · Cost"}},
        {"id": "late-bloomer", "direction": "buff", "before": "6g", "after": "4g", "text": {"zh-CN": "大器晚成（Late Bloomer）· 价格", "en-US": "Late Bloomer · Cost"}},
        {"id": "lightning-storm", "direction": "buff", "before": "5g", "after": "3g", "text": {"zh-CN": "闪电风暴（Lightning Storm）· 价格", "en-US": "Lightning Storm · Cost"}},
        {"id": "lightning-strike", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "天降雷霆（Lightning Strike）· 价格", "en-US": "Lightning Strike · Cost"}},
        {"id": "blaze", "direction": "buff", "before": "5g", "after": "3g", "text": {"zh-CN": "烈焰（Blaze）· 价格", "en-US": "Blaze · Cost"}},
        {"id": "fellowship", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "团契（Fellowship）· 价格", "en-US": "Fellowship · Cost"}},
        {"id": "giants-aura", "direction": "buff", "before": "5g", "after": "3g", "text": {"zh-CN": "巨人灵气（Giant's Aura）· 价格", "en-US": "Giant's Aura · Cost"}},
        {"id": "heros-entrance", "direction": "buff", "before": "4g", "after": "2g", "text": {"zh-CN": "英灵之门（Hero's Entrance）· 价格", "en-US": "Hero's Entrance · Cost"}},
        {"id": "hireling", "direction": "buff", "before": "5g", "after": "2g", "text": {"zh-CN": "佣兵（Hireling）· 价格", "en-US": "Hireling · Cost"}},
        {"id": "iron-core", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "铁核心（Iron Core）· 价格", "en-US": "Iron Core · Cost"}},
        {"id": "killing-frenzy", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "杀戮狂热（Killing Frenzy）· 价格", "en-US": "Killing Frenzy · Cost"}},
        {"id": "killers-regret", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "杀手的悔恨（Killer's Regret）· 价格", "en-US": "Killer's Regret · Cost"}},
        {"id": "mana-rich-soil", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "法力土壤（Mana-Rich Soil）· 价格", "en-US": "Mana-Rich Soil · Cost"}},
        {"id": "petrify-shields", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "石化护盾（Petrify Shields）· 价格", "en-US": "Petrify Shields · Cost"}},
        {"id": "potted-stonebark", "direction": "buff", "before": "2g/1g", "after": "1g/0g", "text": {"zh-CN": "石皮树盆栽（Potted Stonebark）· 价格", "en-US": "Potted Stonebark · Cost"}},
        {"id": "potted-lifebloom", "direction": "buff", "before": "2g/1g", "after": "1g/0g", "text": {"zh-CN": "生命花盆栽（Potted Lifebloom）· 价格", "en-US": "Potted Lifebloom · Cost"}},
        {"id": "phantom-emblem", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "鬼魅纹章（Phantom Emblem）· 价格", "en-US": "Phantom Emblem · Cost"}},
        {"id": "radiantize", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "光芒万丈（Radiantize）· 价格", "en-US": "Radiantize · Cost"}},
        {"id": "revenge", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "复仇（Revenge）· 价格", "en-US": "Revenge · Cost"}},
        {"id": "solitudes-cloak", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "孤寂斗篷（Solitude's Cloak）· 价格", "en-US": "Solitude's Cloak · Cost"}},
        {"id": "stand-alone", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "一夫当关（Stand Alone）· 价格", "en-US": "Stand Alone · Cost"}},
        {"id": "supercritical", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "超级暴击（Supercritical）· 价格", "en-US": "Supercritical · Cost"}},
        {"id": "treetop-archers", "direction": "buff", "before": "5g", "after": "3g", "text": {"zh-CN": "树梢射手（Treetop Archers）· 价格", "en-US": "Treetop Archers · Cost"}},
        {"id": "tremors", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "地动山摇（Tremors）· 价格", "en-US": "Tremors · Cost"}},
        {"id": "yordle-spirit", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "约德尔之魂（Yordle Spirit）· 价格", "en-US": "Yordle Spirit · Cost"}},
      ]
    },
    {
      title: {"zh-CN": "经济、商店与其他灵火", "en-US": "Economy, shop, and other Wisps"},
      changes: [
        {"id": "cutpurse-cost", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "窃贼（Cutpurse）· 价格", "en-US": "Cutpurse · Cost"}},
        {"id": "cutpurse-chance", "direction": "buff", "before": "15%", "after": "20%", "text": {"zh-CN": "窃贼（Cutpurse）· 金币概率", "en-US": "Cutpurse · Gold chance"}},
        {"id": "good-loss", "direction": "buff", "before": "5g", "after": "4g", "text": {"zh-CN": "策略性损失（Good Loss）· 价格", "en-US": "Good Loss · Cost"}},
        {"id": "payday", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "发薪日（Payday）· 价格", "en-US": "Payday · Cost"}},
        {"id": "slow-study", "direction": "buff", "before": "4g", "after": "2g", "text": {"zh-CN": "慢速学习（Slow Study）· 价格", "en-US": "Slow Study · Cost"}},
        {"id": "all-fives", "direction": "buff", "before": "10g", "after": "8g", "text": {"zh-CN": "全是五费（All Fives）· 价格", "en-US": "All Fives · Cost"}},
        {"id": "all-fours", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "全是四费（All Fours）· 价格", "en-US": "All Fours · Cost"}},
        {"id": "border-village", "direction": "buff", "before": "6g/4g", "after": "3g/2g", "text": {"zh-CN": "边境村庄（Border Village）· 价格", "en-US": "Border Village · Cost"}},
        {"id": "flash-fire", "direction": "buff", "before": "2g", "after": "1g", "text": {"zh-CN": "闪光火焰（Flash Fire）· 价格", "en-US": "Flash Fire · Cost"}},
        {"id": "middle-path", "direction": "buff", "before": "6g/4g", "after": "4g/3g", "text": {"zh-CN": "中路（Middle Path）· 价格", "en-US": "Middle Path · Cost"}},
        {"id": "roly-polys", "direction": "buff", "before": "4g", "after": "3g", "text": {"zh-CN": "不倒翁（Roly-Polys）· 价格", "en-US": "Roly-Polys · Cost"}},
        {"id": "search-party", "direction": "buff", "before": "3g/1g", "after": "1g/0g", "text": {"zh-CN": "搜索队（Search Party）· 价格", "en-US": "Search Party · Cost"}},
        {"id": "starting-town", "direction": "buff", "before": "3g/2g", "after": "2g/1g", "text": {"zh-CN": "起始城镇（Starting Town）· 价格", "en-US": "Starting Town · Cost"}},
        {"id": "potioncraft", "direction": "buff", "before": "3g", "after": "2g", "text": {"zh-CN": "药水制作（Potioncraft）· 价格", "en-US": "Potioncraft · Cost"}},
        {"id": "smurfing", "direction": "buff", "before": "7g/6g", "after": "6g/5g", "text": {"zh-CN": "开小号（Smurfing）· 价格", "en-US": "Smurfing · Cost"}},
      ]
    },
    {
      title: {"zh-CN": "三星高费弈子", "en-US": "Three-star high-cost champions"},
      changes: [
        {"id": "brambleback-three-armor", "direction": "buff", "before": "10 + 50% AP", "after": "10 + 70% AP", "text": {"zh-CN": "三星绯红印记树怪 · 护甲忽略", "en-US": "Three-star Brambleback · Armor ignore"}},
        {"id": "brambleback-three-leap", "direction": "buff", "before": "600%", "after": "1000%", "text": {"zh-CN": "三星绯红印记树怪 · 跃击攻击力倍率", "en-US": "Three-star Brambleback · Leap AD ratio"}},
        {"id": "brambleback-three-ad", "direction": "buff", "before": "280%", "after": "300%", "text": {"zh-CN": "三星绯红印记树怪 · 技能额外攻击力", "en-US": "Three-star Brambleback · Bonus ability AD"}},
        {"id": "nidalee-three-ad", "direction": "buff", "before": "2500%", "after": "3000%", "text": {"zh-CN": "三星奈德丽（物理形态）· 技能攻击力倍率", "en-US": "Three-star Nidalee (AD form) · Ability AD ratio"}},
        {"id": "gnar-three-rage", "direction": "buff", "before": "5", "after": "20", "text": {"zh-CN": "三星纳尔 · 每次攻击获得怒气", "en-US": "Three-star Gnar · Rage per attack"}},
        {"id": "gnar-three-resists", "direction": "buff", "before": "100", "after": "250", "text": {"zh-CN": "三星纳尔 · 双抗削减", "en-US": "Three-star Gnar · Resist reduction"}},
        {"id": "gnar-three-health", "direction": "buff", "before": "10000", "after": "15000", "text": {"zh-CN": "三星纳尔 · 额外生命值", "en-US": "Three-star Gnar · Bonus Health"}},
        {"id": "lux-three-damage", "direction": "buff", "before": "5000%", "after": "6500%", "text": {"zh-CN": "三星拉克丝 · 激光法强倍率", "en-US": "Three-star Lux · Laser AP ratio"}},
      ]
    },
  ]
});
