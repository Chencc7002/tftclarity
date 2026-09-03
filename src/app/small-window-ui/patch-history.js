const NUMERIC_REVISIONS = Object.freeze({
  "18.1": Object.freeze([
    Object.freeze({
      id: "18.1-balance-2026-08-31",
      publishedAt: "2026-08-31",
      kind: "balance",
      title: { "zh-CN": "热补丁平衡调整", "en-US": "Mid-patch balance update" },
      summary: {
        "zh-CN": "压低裂隙野兽与强势重抽核心，同时增强阿木木、索拉卡、德莱文、远古巨龙等弱势选择。",
        "en-US": "Trims Riftbeast and dominant reroll carries while helping Amumu, Soraka, Draven, Elder Dragon, and other weaker options."
      },
      groupTitle: { "zh-CN": "羁绊与弈子数值", "en-US": "Trait and champion tuning" },
      changes: Object.freeze([
        { id: "riftbeast-seven-stats", direction: "nerf", before: "6%", after: "5%", text: { "zh-CN": "7 裂隙野兽 · 攻击力 / 法强 / 攻速加成", "en-US": "Riftbeast (7) · AD / AP / AS bonus" } },
        { id: "cinderling-base-ad", direction: "nerf", before: "45", after: "40", text: { "zh-CN": "绯红树怪 · 基础攻击力", "en-US": "Cinderling · Base AD" } },
        { id: "cinderling-ability-damage", direction: "nerf", before: "340/510/765/1300%", after: "310/465/700/1200%", text: { "zh-CN": "绯红树怪 · 技能攻击力倍率", "en-US": "Cinderling · Ability AD ratio" } },
        { id: "cassiopeia-ability-damage", direction: "nerf", before: "440/660/1050%", after: "400/600/950%", text: { "zh-CN": "卡西奥佩娅 · 技能法强倍率", "en-US": "Cassiopeia · Ability AP ratio" } },
        { id: "master-yi-resists", direction: "nerf", before: "60", after: "55", text: { "zh-CN": "易 · 护甲与魔抗", "en-US": "Master Yi · Armor and Magic Resist" } },
        { id: "ahri-ability-damage", direction: "nerf", before: "450/675%", after: "425/640%", text: { "zh-CN": "阿狸 · 技能法强倍率", "en-US": "Ahri · Ability AP ratio" } },
        { id: "amumu-mana", direction: "buff", before: "30/140", after: "30/125", text: { "zh-CN": "阿木木 · 法力值", "en-US": "Amumu · Mana" } },
        { id: "amumu-heal", direction: "buff", before: "2.2%", after: "2.5%", text: { "zh-CN": "阿木木 · 最大生命值治疗", "en-US": "Amumu · Max-Health healing" } },
        { id: "morgana-mana", direction: "nerf", before: "0/60", after: "0/65", text: { "zh-CN": "莫甘娜 · 法力值", "en-US": "Morgana · Mana" } },
        { id: "soraka-initial-star-damage", direction: "buff", before: "190/285%", after: "225/335%", text: { "zh-CN": "索拉卡 · 初始星体法强倍率", "en-US": "Soraka · Initial-star AP ratio" } },
        { id: "draven-mana", direction: "buff", before: "0/120", after: "0/110", text: { "zh-CN": "德莱文 · 法力值", "en-US": "Draven · Mana" } },
        { id: "draven-attack-speed", direction: "buff", before: "0.8", after: "0.85", text: { "zh-CN": "德莱文 · 基础攻速", "en-US": "Draven · Base Attack Speed" } },
        { id: "elder-dragon-base-ad", direction: "buff", before: "115", after: "125", text: { "zh-CN": "远古巨龙 · 基础攻击力", "en-US": "Elder Dragon · Base AD" } },
        { id: "lux-ability-damage", direction: "buff", before: "330/520%", after: "355/550%", text: { "zh-CN": "拉克丝 · 技能法强倍率", "en-US": "Lux · Ability AP ratio" } },
        { id: "lux-lunar-amp", direction: "nerf", before: "10%", after: "8%", text: { "zh-CN": "拉克丝 · 月相伤害增幅", "en-US": "Lux · Lunar damage amplification" } }
      ])
    })
  ])
});

function localized(value, locale) {
  return value?.[locale] ?? value?.["zh-CN"] ?? "";
}

export function buildPatchHistory(patch, localizedPatch, locale = "zh-CN") {
  const revisions = NUMERIC_REVISIONS[patch.version] ?? [];
  return revisions.map((revision, index) => ({
    id: revision.id,
    parentId: revisions[index - 1]?.id ?? null,
    kind: revision.kind,
    publishedAt: revision.publishedAt,
    title: localized(revision.title, locale),
    summary: localized(revision.summary, locale),
    sourceName: localizedPatch.sourceName,
    sourceUrl: localizedPatch.sourceUrl,
    groups: [{
      title: localized(revision.groupTitle, locale),
      changes: revision.changes.map((change) => ({
        id: `${revision.id}-${change.id}`,
        body: localized(change.text, locale),
        direction: change.direction,
        before: change.before,
        after: change.after
      }))
    }]
  }));
}
