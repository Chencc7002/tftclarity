export const OFFICIAL_PATCH_EVIDENCE_VERSION = "riot-patch-evidence.v1";

const PATCHES = Object.freeze({
  "18.1": Object.freeze({
    version: "18.1",
    title: "云顶之弈 18.1 版本更新公告",
    summary: "Set 18“魔法森林”正式上线，带来灵火机制、选秀回归、目标选择与 PvE 战利品规则更新，并完成大规模强化符文和神器轮换；S17 将继续并行开放数个版本。",
    publishedAt: "2026-08-25T18:00:00.000Z",
    sourceName: "Riot Games 官方更新公告",
    sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-18-1/",
    changes: Object.freeze([
      {
        id: "18.1-enchanted-wilds-release",
        direction: "new",
        entityType: "mode",
        entityApiNames: ["TFTSet18"],
        summary: "Set 18“魔法森林”随 18.1 版本正式上线，并从 Hextech 引擎迁移至 Unreal 引擎。"
      },
      {
        id: "18.1-wisps",
        direction: "new",
        entityType: "system",
        entityApiNames: ["TFTSet18_Wisps"],
        summary: "新增灵火机制：灵火分为英雄、战斗、其他、商店、金币/经验、风险和装备七类，只能在备战阶段购买，每隔一个商店出现一次；第 5 阶段后每隔一个灵火必为战斗类。"
      },
      {
        id: "18.1-carousel-targeting-loot",
        direction: "mixed",
        entityType: "system",
        entityApiNames: ["TFT_Carousel", "TFT_Targeting", "TFT_PveLoot"],
        summary: "选秀回归且可能出现更多或更高费用的英雄；单位从控制效果恢复后不再强制切换目标，4-7 及之后 PvE 回合漏捡的战利品可延续到下一次 PvE。"
      },
      {
        id: "18.1-opening-encounters",
        direction: "mixed",
        entityType: "system",
        entityApiNames: ["TFT_OpeningEncounter"],
        summary: "新增成装铁砧开局、刷新订阅和装备锻造场三种开局奇遇，并移除战利品订阅、神器铁砧和刷新开局。"
      },
      {
        id: "18.1-augment-rotation",
        direction: "mixed",
        entityType: "augment",
        entityApiNames: [],
        summary: "强化符文完成大规模轮换，并调整潘朵拉的备战席、生日团聚、顶级配置、治疗法球等多项效果与数值。"
      },
      {
        id: "18.1-artifact-rotation",
        direction: "mixed",
        entityType: "item",
        entityApiNames: ["DA_Artifact_ForbiddenIdol", "DA_Artifact_Manazane"],
        summary: "禁忌雕像与魔蕴回归；死亡之蔑、破舰者和狙击手的专注被移除，多件神器获得数值或机制调整。"
      },
      {
        id: "18.1-twisted-fate-pve",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_TwistedFate"],
        summary: "S17 崔斯特在 1-2 回合的最低骰点改为 5，降低输给 PvE 的极端情况。"
      },
      {
        id: "18.1-milio-mana",
        direction: "nerf",
        entityType: "unit",
        entityApiNames: ["TFT17_Milio"],
        summary: "S17 米利欧最大法力值由 30 提高至 40。"
      }
    ])
  }),
  "17.9": Object.freeze({
    version: "17.9",
    title: "云顶之弈 17.9 版本更新公告",
    summary: "“星穹神话”的最后一个专属版本，集中调整牧羊人、崔斯特、格温、米利欧及多名中高费英雄；Set 18“魔法森林”将在 8 月 26 日上线。",
    publishedAt: "2026-08-11T18:00:00.000Z",
    sourceName: "Riot Games 官方更新公告",
    sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-17-9/",
    changes: Object.freeze([
      {
        id: "17.9-shepherd-cadence-damage",
        direction: "mixed",
        entityType: "trait",
        entityApiNames: ["TFT17_SummonTrait"],
        summary: "牧羊人法力值由 0/50 调整为 0/40，每次施法获得的法强由 15 降至 10，召唤物护盾持续时间由 4 秒降至 3 秒；横扫和 7 牧羊人波次伤害提高。"
      },
      {
        id: "17.9-twisted-fate-dice",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_TwistedFate"],
        summary: "崔斯特掷出 9 时必定获得金币，掷出 1 时会受到 15% 最大生命值真实伤害；技能最低伤害下调、最高伤害提高。"
      },
      {
        id: "17.9-gwen-primary-damage",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Gwen"],
        summary: "格温触发律动所需阈值由 40% 提高至 50%，主目标伤害由 145/220/410 提高至 155/235/440 法强。"
      },
      {
        id: "17.9-milio-extra-cast",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Milio"],
        summary: "米利欧获得 40% 概率对额外目标再次施法，同时主技能与弹射伤害下调。"
      },
      {
        id: "17.9-lulu-medallion-gold",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Lulu"],
        summary: "璐璐的徽章金币由 1/3/5 提高至 1/4/7。"
      },
      {
        id: "17.9-maokai-attack-speed-nova",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Maokai"],
        summary: "茂凯攻击速度由 0.6 提高至 0.7，NOVA 选择器的最大生命值伤害由 8% 提高至 12%。"
      },
      {
        id: "17.9-rhaast-cast-damage",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_Rhaast"],
        summary: "拉亚斯特持续时间由 2 秒降至 1 秒，技能伤害由 120/180/300 攻击力提高至 400/600/1000 攻击力。"
      },
      {
        id: "17.9-tahm-kench-oracle-gold",
        direction: "buff",
        entityType: "unit",
        entityApiNames: ["TFT17_TahmKench"],
        summary: "塔姆奇幻旅程的每回合金币提高。"
      },
      {
        id: "17.9-zed-base-roster",
        direction: "mixed",
        entityType: "unit",
        entityApiNames: ["TFT17_Zed"],
        summary: "“入侵者劫”强化符文被移除，劫加入基础英雄池；基础生命值由 1300 下调至 1100。"
      },
      {
        id: "17.9-set-18-release",
        direction: "new",
        entityType: "mode",
        entityApiNames: ["TFTSet18"],
        summary: "Set 18“魔法森林”将在 8 月 26 日、17.9 版本结束时上线。"
      }
    ])
  }),
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
