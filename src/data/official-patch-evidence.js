export const OFFICIAL_PATCH_EVIDENCE_VERSION = "riot-patch-evidence.v1";

const PATCHES = Object.freeze({
  "17.8": Object.freeze({
    version: "17.8",
    title: "云顶之弈 17.8 版本更新公告",
    summary: "胖胖龙的传说与神话更新为胖胖龙经典宝藏；太空众神获得一轮轻量平衡调整。",
    publishedAt: "2026-07-28T18:00:00.000Z",
    sourceName: "Riot Games 官方更新公告",
    sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-17-8/",
    changes: Object.freeze([
      {
        id: "17.8-choncc-classic-treasure",
        direction: "new",
        entityType: "mode",
        entityApiNames: ["ChonccsClassicTreasure"],
        summary: "胖胖龙的传说与神话更新为胖胖龙经典宝藏，并在版本上线后不久开放；模式加入英雄联盟经典 PvE 怪物、凯尔的审判和贤者之石等经典内容。"
      },
      {
        id: "17.8-anima-items-loot",
        direction: "nerf",
        entityType: "trait",
        entityApiNames: ["TFT17_AnimaSquad"],
        summary: "幻灵战队的歼灭者、冰爆护甲和雌狮之怨被削弱，5层奖励池同步调整。"
      },
      {
        id: "17.8-conduit-mana-regen",
        direction: "nerf",
        entityType: "trait",
        entityApiNames: ["TFT17_ManaTrait"],
        summary: "5神谕者提供的全队法力回复由 3 降至 2。"
      },
      {
        id: "17.8-psionic-items",
        direction: "buff",
        entityType: "trait",
        entityApiNames: ["TFT17_PsyOps"],
        summary: "4灵能特工的生物质保存器、无人机上行链路、恶意软件矩阵和锁定光学镜获得增强。"
      },
      {
        id: "17.8-briar-ad",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Briar"],
        summary: "贝蕾亚攻击力由 35 提升至 40。"
      },
      {
        id: "17.8-twisted-fate-spell",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_TwistedFate"],
        summary: "崔斯特的最大技能伤害提高。"
      },
      {
        id: "17.8-akali-damage",
        direction: "nerf",
        entityType: "unit",
        entityApiNames: ["TFT17_Akali"],
        summary: "阿卡丽的新星打击每秒伤害下调。"
      },
      {
        id: "17.8-gnar-brawler",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Gnar"],
        relatedTraitApiNames: ["TFT17_HPTank"],
        summary: "纳尔新增斗士羁绊。"
      },
      {
        id: "17.8-miss-fortune-damage",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_MissFortune"],
        summary: "厄运小姐的复制器与神谕者技能伤害提高。"
      },
      {
        id: "17.8-samira-damage-control",
        direction: "nerf",
        entityType: "unit",
        entityApiNames: ["TFT17_Samira"],
        summary: "莎弥拉被动伤害下调，击飞时长由 1 秒降至 0.75 秒。"
      },
      {
        id: "17.8-diana-mana-shield",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Diana"],
        summary: "黛安娜最大法力值由 50 降至 40，同时护盾数值下调。"
      },
      {
        id: "17.8-morgana-conduit",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Morgana"],
        relatedTraitApiNames: ["TFT17_ManaTrait"],
        summary: "莫甘娜新增神谕者羁绊，同时提高法力需求并下调基础治疗。"
      },
      {
        id: "17.8-riven-damage",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Riven"],
        summary: "锐雯的小技能与第三次施法伤害提高。"
      },
      {
        id: "17.8-zed-clone-health",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Zed"],
        summary: "劫的分身生命值惩罚由 33/40% 降至 25/35%。"
      },
      {
        id: "17.8-cosmic-restart",
        direction: "buff",
        entityType: "augment",
        entityApiNames: ["TFT17_Augment_CosmicRestart"],
        summary: "强化符文“宇宙重启”的刷新次数由 8 次提高至 15 次。"
      }
    ])
  }),
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

export function listOfficialPatchEvidence() {
  return Object.values(PATCHES);
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
