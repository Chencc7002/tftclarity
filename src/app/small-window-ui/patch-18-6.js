const t = (zh, en) => Object.freeze({ "zh-CN": zh, "en-US": en });
const c = (id, direction, before, after, zh, en, entityType, entityApiNames = []) => Object.freeze({
  id, direction, before, after, text: t(zh, en), entityType, entityApiNames: Object.freeze(entityApiNames), stat: id
});
const g = (zh, en, changes) => Object.freeze({ title: t(zh, en), changes: Object.freeze(changes) });

export const PATCH_18_6_REVISION = Object.freeze({
  id: "18.6-release-2026-11-05",
  publishedAt: "2026-11-05",
  kind: "release",
  title: t("18.6 正式版本数值调整（国服）", "18.6 release numeric changes (China)"),
  summary: t(
    "按国服 11 月 4 日公告、11 月 5 日维护收录 21 项数值调整。暗影狼采用国服与英文一致的 65/100/160 → 65/100/180 物理加成。国服明确注明：约德尔人和朋友的毛茸茸大朋友远程物理/法术加成 15/28/33% → 15/30/38% 暂未生效，将于后续版本修复；该项只作待生效说明，不计入已生效数值清单。独立客户端、错误修复和个性化内容见官方原文。英文页 11 月 6 日/10 日说明包含分批客户端修复，不能视为全部已上线，也未追加战斗数值调整。",
    "21 numeric adjustments from the China announcement posted November 4 for the November 5 maintenance. Murkwolf uses the China/English endpoints 65/100/160 to 65/100/180 AD. China explicitly marks Sprykin ranged BFF AD/AP 15/28/33% to 15/30/38% as not yet effective; it is disclosed as pending and excluded from the effective numeric list. Client, bug fixes and cosmetics remain in the source. The English November 6/10 client fixes roll out in stages and are not all live; they add no combat balance numbers."
  ),
  sourceUrl: "https://lol.qq.com/gicp/news/662/37101298.html",
  groups: Object.freeze([
    g("羁绊", "Traits", [
      c("blossom-ad-ap", "buff", "12/30/50/55%", "12/30/55/65%", "灵魂莲华 · 物理 / 法术加成", "Blossom · AD / AP", "trait", ["DA_18_Blossom"]),
      c("elderwood-nine-health", "nerf", "25%", "10%", "永恒之森（9）· 生命值加成", "Elderwood (9) · Health bonus", "trait", ["DA_18_Elderwood"])
    ]),
    g("一费弈子", "Tier 1 champions", [
      c("kobuko-heal", "buff", "285/335/480 AP", "300/350/550 AP", "可酷伯 · 技能治疗量", "Kobuko · Spell healing", "unit", ["DA_18_Kobuko"]),
      c("reksai-heal", "buff", "10/14/20 AP", "10/16/24 AP", "雷克塞 · 技能治疗量", "Rek'Sai · Spell healing", "unit", ["DA_18_RekSai"])
    ]),
    g("二费弈子", "Tier 2 champions", [
      c("murkwolf-empowered-attack", "buff", "65/100/160 AD", "65/100/180 AD", "暗影狼 · 强化攻击伤害", "Murkwolf · Empowered attack damage", "unit", ["DA_Murkwolf18"])
    ]),
    g("四费弈子", "Tier 4 champions", [
      c("malphite-shield", "buff", "735/885/2000 AP", "750/925/2000 AP", "墨菲特 · 护盾值", "Malphite · Shield", "unit", ["DA_18_Malphite"]),
      c("malphite-damage", "buff", "40/60/2000 AP", "100/150/2000 AP", "墨菲特 · 技能伤害", "Malphite · Spell damage", "unit", ["DA_18_Malphite"]),
      c("nidalee-ad-heal", "buff", "300/450/2000 AP", "325/550/2000 AP", "奈德丽（物理形态）· 治疗量", "Nidalee AD form · Heal", "unit", ["DA_Nidalee18_AD"]),
      c("nidalee-ad-third-cast", "buff", "125%", "140%", "奈德丽（物理形态）· 第三次施放额外伤害", "Nidalee AD form · Third cast bonus damage", "unit", ["DA_Nidalee18_AD"]),
      c("nidalee-ap-empowered-attack", "buff", "185/275/2000 AP", "195/295/2000 AP", "奈德丽（魔法形态）· 强化攻击伤害", "Nidalee AP form · Empowered attack damage", "unit", ["DA_Nidalee18_AP"]),
      c("nidalee-ap-third-attack", "buff", "330/500/3000 AP", "350/525/3000 AP", "奈德丽（魔法形态）· 第三次攻击伤害", "Nidalee AP form · Third attack damage", "unit", ["DA_Nidalee18_AP"]),
      c("sentinel-health-ratio", "buff", "10%", "12%", "苍蓝雕纹魔像 · 护盾值生命值收益率", "Sentinel · Shield Health ratio", "unit", ["DA_Sentinel18"])
    ]),
    g("强化符文", "Augments", [
      c("clockwork-accelerator-as", "buff", "10%", "12%", "发条增速器 · 每次触发攻击速度", "Clockwork Accelerator · Attack Speed per proc", "augment"),
      c("embiggen-pixie-ad-ap", "nerf", "50%", "35%", "巨化术 · 额外皮克斯仙灵物理 / 法术加成", "Embiggen · Bonus Pixie AD / AP", "augment"),
      c("plot-armor-resists", "buff", "8", "10", "应急护盾 · 基础抗性", "Plot Armor · Base resists", "augment"),
      c("shopping-spree-gold", "buff", "6g", "7g", "大买特买 · 初始金币", "Shopping Spree · Initial gold", "augment"),
      c("unrivaled-rengar-heal", "buff", "25%", "50%", "世纪和解 · 雷恩加尔共享治疗量", "Unrivaled · Rengar heal share", "augment"),
      c("unrivaled-khazix-mana", "buff", "50%", "70%", "世纪和解 · 卡兹克共享法力值", "Unrivaled · Kha'Zix Mana share", "augment")
    ]),
    g("自然仙灵", "Wisps", [
      c("curio-cart-emblem-cost", "nerf", "15g", "17g", "珍品摆摊车 · 纹章费用", "Curio Cart · Emblem cost", "wisp"),
      c("middle-path-cost", "nerf", "4g", "5g", "中央大道 · 费用", "Middle Path · Cost", "wisp"),
      c("middle-path-upgrade-cost", "nerf", "3g", "4g", "中央大道 · 灵魂莲华强化版费用", "Middle Path · Blossom upgrade cost", "wisp")
    ])
  ])
});

export const PATCH_18_6_REVISIONS = Object.freeze([PATCH_18_6_REVISION]);
