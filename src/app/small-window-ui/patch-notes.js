export const CURRENT_PATCH_VERSION = "17.7";

const PATCH_NOTES = {
  "17.7": {
    version: "17.7",
    publishedAt: "2026-07-14T18:00:00.000Z",
    locales: {
      "zh-CN": {
        title: "17.7 版本更新",
        summary: "这是一个以增强和阵容扩展为主的版本：薇古丝加入观星者，慎获得未来战士，同时多名弱势英雄与羁绊获得加强。",
        sourceName: "Riot Games 官方更新公告",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-17-7/",
        highlights: [
          {
            title: "五费英雄焕新",
            body: "格雷福斯所有升级费用降至 1 金币；慎新增未来战士羁绊；薇古丝新增观星者羁绊并相应下调技能伤害；劫的分身生命值惩罚降低。"
          },
          {
            title: "羁绊阵容扩展",
            body: "Anima Squad 的最高档位由 6 调整为 5，同时平衡奖励；Replicator 与 Rogue 的高档位获得增强，让更多后期阵容具备成型空间。"
          },
          {
            title: "英雄整体增强",
            body: "伊泽瑞尔更快获得无人机；塔隆、柔依、黛安娜、厄加特和易大师均得到针对性增强，低费重抽与四费主核选择更加丰富。"
          },
          {
            title: "强化符文调整",
            body: "Birthday Reunion 是本次少数明确削弱项，其初始金币由 3 降至 1；Bonk!、Heart of the Swarm、Stellar Combo 等多项符文获得增强。"
          },
          {
            title: "S16 限时回归",
            body: "S16「Lore & Legends」以 Choncc’s Treasure 玩法限时回归，保留原赛季阵容，并加入高娱乐性的额外战利品。"
          }
        ]
      },
      "en-US": {
        title: "Patch 17.7",
        summary: "A buff-focused patch that expands late-game boards: Vex joins Stargazer, Shen gains Timebreaker, and several underperforming champions and traits receive help.",
        sourceName: "Official Riot Games patch notes",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-17-7/",
        highlights: [
          {
            title: "Legendary refresh",
            body: "All Graves upgrades now cost 1 gold. Shen gains Timebreaker, Vex gains Stargazer with a compensation damage adjustment, and Zed's clone Health penalty is reduced."
          },
          {
            title: "More trait options",
            body: "Anima Squad's top breakpoint moves from 6 to 5 with adjusted rewards, while the higher Replicator and Rogue breakpoints receive buffs."
          },
          {
            title: "Champion buffs",
            body: "Ezreal earns drones faster, with targeted buffs for Talon, Zoe, Diana, Urgot, and Master Yi to open more reroll and four-cost carry lines."
          },
          {
            title: "Augment adjustments",
            body: "Birthday Reunion is one of the patch's few clear nerfs, dropping from 3 initial gold to 1. Bonk!, Heart of the Swarm, Stellar Combo, and other Augments are buffed."
          },
          {
            title: "Set 16 limited return",
            body: "Set 16 Lore & Legends returns for a limited time in Choncc's Treasure form, combining its roster with extra loot and high-roll moments."
          }
        ]
      }
    }
  }
};

export function getPatchNote(version, locale = "zh-CN") {
  const patch = PATCH_NOTES[String(version ?? "")];
  if (!patch) return null;
  const localized = patch.locales[locale] ?? patch.locales["zh-CN"];
  return {
    version: patch.version,
    publishedAt: patch.publishedAt,
    ...localized
  };
}

export function getCurrentPatchNote(locale = "zh-CN") {
  return getPatchNote(CURRENT_PATCH_VERSION, locale);
}
