export const OFFICIAL_PATCH_EVIDENCE_VERSION = "riot-patch-evidence.v1";

const PATCHES = Object.freeze({
  "17.7": Object.freeze({
    version: "17.7",
    publishedAt: "2026-07-14T18:00:00.000Z",
    sourceName: "Riot Games 官方更新公告",
    sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-17-7/",
    changes: Object.freeze([
      {
        id: "17.7-graves-upgrade-cost",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Graves"],
        summary: "格雷福斯所有升级费用降至 1 金币。"
      },
      {
        id: "17.7-shen-timebreaker",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Shen"],
        relatedTraitApiNames: ["TFT17_Timebreaker"],
        summary: "慎新增未来战士羁绊。"
      },
      {
        id: "17.7-vex-stargazer",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Vex"],
        relatedTraitApiNames: ["TFT17_Stargazer"],
        summary: "薇古丝新增观星者羁绊，同时下调技能伤害作为补偿。"
      },
      {
        id: "17.7-zed-clone-health",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Zed"],
        summary: "劫的分身生命值惩罚降低。"
      },
      {
        id: "17.7-anima-breakpoint",
        direction: "mixed",
        entityType: "trait",
        entityApiNames: ["TFT17_AnimaSquad", "TFT17_ASTrait"],
        summary: "幻灵战队最高档位由 6 调整为 5，并同步平衡奖励。"
      },
      {
        id: "17.7-replicator-rogue",
        direction: "buff",
        entityType: "trait",
        entityApiNames: ["TFT17_Replicator", "TFT17_Rogue"],
        summary: "复制器与潜行者的高档位获得增强。"
      },
      {
        id: "17.7-targeted-unit-buffs",
        direction: "buff",
        entityType: "unit",
        entityApiNames: [
          "TFT17_Ezreal", "TFT17_Talon", "TFT17_Zoe", "TFT17_Diana",
          "TFT17_Urgot", "TFT17_MasterYi", "TFT17_Yi"
        ],
        summary: "伊泽瑞尔、塔隆、柔依、黛安娜、厄加特和易大师获得针对性增强。"
      }
    ])
  })
});

function baseTrait(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function normalizedSet(values = []) {
  return new Set(values.map(baseTrait).filter(Boolean));
}

export function getOfficialPatchEvidence(version) {
  return PATCHES[String(version ?? "")] ?? null;
}

export function associateOfficialPatchChanges(comp = {}, version) {
  const patch = getOfficialPatchEvidence(version);
  if (!patch) return [];
  const units = normalizedSet((comp.units ?? []).map((unit) => unit.apiName ?? unit));
  const traits = normalizedSet((comp.traits ?? []).flatMap((trait) => [trait.apiName, trait.filterId]));
  const items = normalizedSet((comp.units ?? []).flatMap((unit) => (
    (unit.items ?? []).map((item) => item.apiName ?? item)
  )));

  return patch.changes.filter((change) => {
    const direct = change.entityType === "unit" ? units
      : change.entityType === "trait" ? traits
        : change.entityType === "item" ? items
          : new Set();
    return (change.entityApiNames ?? []).some((apiName) => direct.has(baseTrait(apiName)))
      || (change.relatedTraitApiNames ?? []).some((apiName) => traits.has(baseTrait(apiName)));
  }).map((change) => ({
    ...change,
    patch: patch.version,
    publishedAt: patch.publishedAt,
    sourceName: patch.sourceName,
    sourceUrl: patch.sourceUrl,
    evidenceVersion: OFFICIAL_PATCH_EVIDENCE_VERSION
  }));
}
