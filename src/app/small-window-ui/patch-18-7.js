const t = (zh, en) => Object.freeze({ "zh-CN": zh, "en-US": en });
const c = (id, direction, before, after, zh, en, entityType, entityApiNames = []) => Object.freeze({
  id, direction, before, after, text: t(zh, en), entityType, entityApiNames: Object.freeze(entityApiNames), stat: id
});
const g = (zh, en, changes) => Object.freeze({ title: t(zh, en), changes: Object.freeze(changes) });
export const PATCH_18_7_REVISION = Object.freeze({
  id: "18.7-release-2026-11-19", publishedAt: "2026-11-19", kind: "release",
  title: t("18.7 正式版本数值调整（国服）", "18.7 release numeric changes (China)"),
  sourceUrl: "https://lol.qq.com/gicp/news/662/37102796.html",
  summary: t(
    "国服 11 月 19 日版本共 38 项数值调整，原文重复出现的地狱火灼烧只计一次。可酷伯法术加成末档采用国服 300，英文页写作 30；电火花 II 采用国服区间 50–140 → 35–120。腐蚀的新数值已生效，但描述文本有 BUG。远古石甲虫新增召唤师，小型石甲虫召唤时新增 15% 最大生命值；凯南新增约德尔人和朋友，艾翁新增永恒之森。峡谷迅捷蟹现在地下也会攻击，乐芙兰复制能力提升，提莫蘑菇变大；这些新增身份、机制和无完整前后数值的变化不计入数值清单。重铸器增加防重复队列，投资策略修复百分比生命值交互。国服注明 Esc 取消未确认武器库选择暂未生效。墨菲特、奈德丽的数值增强属于 18.6，本公告没有列出这两名弈子新的数值调整。",
    "38 numeric adjustments for China's November 19 release; the repeated Inferno line is counted once. Kobuko's final AP endpoint follows China (300; the English page says 30). Electrocharge II uses China's 50–140 to 35–120 ranges. Corrosion is effective despite a tooltip bug. Krug gains Summoner and summoned Kruglettes gain 15% max Health; Kennen gains Sprykin and Ivern gains Elderwood. Scuttlecrab attacks while burrowed, LeBlanc prints units more effectively, and Teemo has larger mushrooms. These new identities/mechanics and changes without complete numeric endpoints are summarized rather than counted. Reforgers gain an anti-repeat queue; Investment Strategy's percentage-Health interaction is fixed. China marks Escape cancelling unconfirmed armory choices as not yet effective. Malphite and Nidalee's numeric buffs belong to 18.6; this release lists no new numeric changes for them."
  ),
  groups: Object.freeze([
    g("羁绊", "Traits", [
      c("coven-essence-loss", "buff", "22/28/35/60", "22/28/35/70", "魔女 · 每次失败获得精粹", "Coven · Essence per loss", "trait", ["DA_18_Coven"]),
      c("eclipse-delay", "nerf", "8s", "9s", "日月双蚀 · 处决开始时间", "Eclipse · Initial delay", "trait", ["DA_18_Eclipse"]),
      c("eclipse-repeat", "buff", "3.5s", "3s", "日月双蚀 · 重复处决间隔", "Eclipse · Repeating execute interval", "trait", ["DA_18_Eclipse"]),
      c("elderwood-five-health", "nerf", "200", "125", "永恒之森（5）· 石皮树额外生命值", "Elderwood (5) · Bonus tree Health", "trait", ["DA_18_Elderwood"]),
      c("elderwood-protector-health", "nerf", "450", "375", "永恒之森 · 深林守卫基础生命值", "Elderwood · Deepwood Protector base Health", "trait", ["DA_18_Elderwood"]),
      c("fae-final-threshold", "buff", "888888", "720000", "花仙子 · 最终阈值", "Fae · Final threshold", "trait", ["DA_18_Fae"]),
      c("inferno-burn", "buff", "1/1/3/4", "1/1/4/5", "地狱火 · 灼烧效果", "Inferno · Burn", "trait", ["DA_18_Inferno"]),
      c("primal-components", "buff", "4", "6", "野兽之灵 · 凤凰赐福最多基础装备", "Primal Phoenix · Maximum components", "trait", ["DA_Primal18"]),
      c("primal-kills", "buff", "14", "12", "野兽之灵 · 每件基础装备所需击杀数", "Primal Phoenix · Kills per component", "trait", ["DA_Primal18"]),
      c("riftbeast-seven-ad-ap", "nerf", "5%", "4%", "峡谷野怪（7）· 物理 / 法术加成", "Riftbeast (7) · AD / AP", "trait", ["DA_Riftbeast18"]),
      c("sprykin-health", "nerf", "15/40/55%", "15/40/45%", "约德尔人和朋友 · 额外生命值", "Sprykin · Bonus Health", "trait", ["DA_18_Sprykin"]),
      c("sprykin-speed", "nerf", "15/35/55%", "15/35/45%", "约德尔人和朋友 · 额外攻击速度", "Sprykin · Bonus Attack Speed", "trait", ["DA_18_Sprykin"]),
      c("sprykin-seven-bonus", "nerf", "100%", "75%", "约德尔人和朋友（7）· 加成", "Sprykin (7) · Bonus", "trait", ["DA_18_Sprykin"])
    ]),
    g("一费弈子", "Tier 1 champions", [
      c("cinderling-damage", "buff", "310/465/700/1200 AD", "330/495/745/1265 AD", "绯红树怪 · 技能伤害", "Cinderling · Spell damage", "unit", ["DA_Cinderling18"]),
      c("kobuko-damage", "buff", "70/105/150/255 AP", "80/120/180/300 AP", "可酷伯 · 技能伤害法术加成", "Kobuko · Spell AP damage", "unit", ["DA_18_Kobuko"]),
      c("kobuko-health-ratio", "buff", "10%", "15%", "可酷伯 · 技能伤害生命值收益率", "Kobuko · Spell Health ratio", "unit", ["DA_18_Kobuko"]),
      c("leona-armor-ratio", "buff", "1.5/2.7/4.06", "1.8/3/4.36", "蕾欧娜 · 技能伤害护甲收益率", "Leona · Spell Armor ratio", "unit", ["DA_18_Leona"]),
      c("ornn-artifact-threshold", "buff", "90000/230000/410000", "90000/210000/370000", "奥恩 · 神器阈值", "Ornn · Artifact threshold", "unit", ["DA_18_Ornn"]),
      c("pebbles-damage", "buff", "160/240/360/615 AP", "170/255/385/655 AP", "苍蓝哨戒 · 技能伤害", "Pebbles · Spell damage", "unit", ["DA_18_Sentry"])
    ]),
    g("二费弈子", "Tier 2 champions", [
      c("elise-damage", "buff", "35/50/80/110 AP", "40/60/90/130 AP", "伊莉丝 · 技能伤害", "Elise · Spell damage", "unit", ["DA_18_Elise"]),
      c("kayle-onhit", "buff", "65/97/110/115 AP", "68/102/115/120 AP", "凯尔 · 普攻附带技能伤害", "Kayle · On-hit spell damage", "unit", ["DA_18_Kayle"]),
      c("teemo-shroom-chance", "buff", "10/12/15%", "12/15/18%", "提莫 · 找到蘑菇几率", "Teemo · Mushroom chance", "unit", ["DA_18_Teemo"]),
      c("scuttlecrab-ad", "buff", "50/75/112.5/168.75", "60/90/135/202.5", "峡谷迅捷蟹 · 攻击力", "Scuttlecrab · Attack Damage", "unit", ["DA_Scuttlecrab18"]),
      c("warwick-bite", "buff", "230/345/535/910", "230/345/560/950", "沃里克 · 撕咬伤害", "Warwick · Bite damage", "unit", ["DA_18_Warwick"])
    ]),
    g("三费弈子", "Tier 3 champions", [
      c("khazix-base", "buff", "230/310/450 AP", "240/325/480 AP", "卡兹克 · 基础伤害", "Kha'Zix · Base damage", "unit", ["DA_18_KhaZix"]),
      c("khazix-isolated", "buff", "250/350/530 AP", "260/360/540 AP", "卡兹克 · 孤立无援伤害", "Kha'Zix · Isolated damage", "unit", ["DA_18_KhaZix"]),
      c("kruglettes-health", "nerf", "50/100/180", "50/75/150", "远古石甲虫 · 小型石甲虫基础生命值", "Krug · Kruglettes base Health", "unit", ["DA_Krug18"])
    ]),
    g("四费弈子", "Tier 4 champions", [
      c("aphelios-lunar-blast", "buff", "450/675", "500/750", "厄斐琉斯 · 月光爆炸伤害", "Aphelios · Lunar Blast damage", "unit", ["DA_18_Aphelios"])
    ]),
    g("强化符文", "Augments", [
      c("advanced-loan-gold", "buff", "20g", "22g", "高级贷款 · 金币", "Advanced Loan · Gold", "augment"),
      c("comeback-story-speed", "buff", "0.3%", "0.4%", "绝境反击 · 每损失生命值获得攻速", "Comeback Story · AS per missing Health", "augment"),
      c("corrosion-resists", "nerf", "4", "3", "腐蚀 · 每 2 秒损失抗性（已生效，描述文本待修复）", "Corrosion · Resist loss per 2 seconds (effective; tooltip bug)", "augment"),
      c("electrocharge-two-damage", "nerf", "50–140", "35–120", "电火花 II · 每阶段伤害（国服区间）", "Electrocharge II · Stage damage (China range)", "augment"),
      c("focused-fire-ad", "nerf", "5%", "4%", "集中火力 · 每 5 秒物理加成", "Focused Fire · AD per 5 seconds", "augment"),
      c("forged-in-strength-components", "buff", "2", "3", "神力天铸 · 基础装备数量", "Forged In Strength · Components", "augment"),
      c("investment-one-health", "nerf", "9", "8", "投资策略 I · 每利息生命值", "Investment Strategy I · Health per interest", "augment"),
      c("investment-two-health", "nerf", "12", "10", "投资策略 II · 每利息生命值", "Investment Strategy II · Health per interest", "augment"),
      c("pandoras-items-gold", "buff", "6g", "7g", "潘朵拉的装备 II++ · 初始金币", "Pandora's Items II++ · Initial gold", "augment"),
      c("we-stick-together-speed", "nerf", "30%", "25%", "水乳交融 · 攻击速度", "We Stick Together · Attack Speed", "augment")
    ])
  ])
});
export const PATCH_18_7_REVISIONS = Object.freeze([PATCH_18_7_REVISION]);
