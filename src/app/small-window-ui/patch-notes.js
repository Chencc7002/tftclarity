import { buildPatchHistory } from "./patch-history.js";

export const CURRENT_PATCH_VERSION = "18.1";

const PATCH_NOTES = {
  "18.1": {
    version: "18.1",
    publishedAt: "2026-08-25T18:00:00.000Z",
    locales: {
      "zh-CN": {
        title: "18.1 版本更新",
        summary: "S18“魔法森林”正式上线：灵火成为全新赛季机制，选秀回归，目标选择、PvE 战利品、开局奇遇、强化符文与神器系统同步更新。",
        sourceName: "Riot Games 官方更新公告",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-18-1/",
        highlights: [
          {
            title: "S18 正式上线",
            body: "“魔法森林”随 18.1 版本正式开放，并完成从 Hextech 到 Unreal 引擎的迁移。官方同时说明，S17“星穹神话”还会继续开放数个版本。"
          },
          {
            title: "全新灵火机制",
            body: "灵火分为英雄、战斗、其他、商店、金币/经验、风险和装备七类，只能在备战阶段购买，每隔一个商店出现一次；第 5 阶段后每隔一个灵火必为战斗类。"
          },
          {
            title: "选秀与战斗规则",
            body: "选秀正式回归，并可能出现更多或更高费用的英雄。单位从控制效果恢复后不再强制切换目标；4-7 及之后 PvE 回合漏捡的战利品会延续到下一次 PvE。"
          },
          {
            title: "奇遇与强化符文轮换",
            body: "新增成装铁砧开局、刷新订阅和装备锻造场，移除三种高波动开局奇遇；大量强化符文被移除、回归或重做。"
          },
          {
            title: "装备与 S17 并行更新",
            body: "禁忌雕像与魔蕴两件神器回归，死亡之蔑、破舰者和狙击手的专注被移除，多件光明装备和神器调整；S17 崔斯特与米利欧获得小幅平衡改动。"
          }
        ]
      },
      "en-US": {
        title: "Patch 18.1",
        summary: "Enchanted Wilds launches with the new Wisp mechanic, the return of Carousel, targeting and PvE loot updates, and major Augment and Artifact rotations.",
        sourceName: "Official Riot Games patch notes",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/",
        highlights: [
          {
            title: "Set 18 launches",
            body: "Enchanted Wilds goes live in Patch 18.1 alongside TFT's move from Hextech to Unreal. Riot also confirms that Set 17 Space Gods remains playable for several more patches."
          },
          {
            title: "New Wisp mechanic",
            body: "Wisps come in seven categories, can only be purchased during planning, appear in every other shop, and become increasingly combat-focused after Stage 5."
          },
          {
            title: "Carousel and combat rules",
            body: "Carousel returns and may offer more or higher-cost champions. Units no longer retarget after crowd control, and missed late-game PvE loot can carry into the next PvE round."
          },
          {
            title: "Encounter and Augment rotation",
            body: "Three lower-variance Opening Encounters are added while three high-impact ones are removed. A large group of Augments is removed, returned, or adjusted."
          },
          {
            title: "Items and parallel Set 17 update",
            body: "Forbidden Idol and Manazane return, three Artifacts are removed, and many Radiant and Artifact items are tuned. Set 17 Twisted Fate and Milio receive small balance changes."
          }
        ]
      }
    }
  },
  "17.9": {
    version: "17.9",
    publishedAt: "2026-08-11T18:00:00.000Z",
    locales: {
      "zh-CN": {
        title: "17.9 版本更新",
        summary: "这是“星穹神话”的最后一个专属版本：牧羊人、崔斯特、格温、米利欧等英雄获得调整，并为 8 月 26 日上线的 Set 18“魔法森林”做准备。",
        sourceName: "Riot Games 官方更新公告",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-17-9/",
        highlights: [
          {
            title: "Set 18 上线时间",
            body: "Set 18“魔法森林”将在 8 月 26 日、17.9 版本结束时上线；17.9 是“星穹神话”的最后一个专属版本。"
          },
          {
            title: "牧羊人调整",
            body: "牧羊人法力值由 0/50 调整为 0/40，每次施法获得的法强由 15 降至 10，召唤物护盾持续时间缩短；横扫与 7 牧羊人波次伤害提高。"
          },
          {
            title: "低费英雄调整",
            body: "崔斯特的骰子机制更极端：掷出 9 必定获得金币，掷出 1 会损失最大生命值；格温触发律动所需阈值提高，但主目标伤害增强；米利欧改为概率追加施法并下调基础伤害。"
          },
          {
            title: "中高费英雄增强",
            body: "璐璐的徽章金币提高，茂凯获得攻速与最大生命值伤害增强，拉亚斯特施法更快且技能伤害大幅提高，塔姆奇幻旅程的每回合金币增加。"
          },
          {
            title: "劫进入基础卡池",
            body: "“入侵者劫”强化符文被移除，劫加入基础英雄池；作为平衡，基础生命值由 1300 下调至 1100。"
          }
        ]
      },
      "en-US": {
        title: "Patch 17.9",
        summary: "The final dedicated Space Gods patch adjusts Shepherd, Twisted Fate, Gwen, Milio, and several late-game champions ahead of Enchanted Wilds on August 26.",
        sourceName: "Official Riot Games patch notes",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-17-9/",
        highlights: [
          {
            title: "Set 18 release",
            body: "Enchanted Wilds goes live on August 26 at the end of Patch 17.9, making this the final dedicated Space Gods patch."
          },
          {
            title: "Shepherd adjustments",
            body: "Shepherd Mana changes from 0/50 to 0/40, AP per cast drops from 15 to 10, and summon shields expire sooner, while tail-sweep and seven-Shepherd wave damage increase."
          },
          {
            title: "Low-cost champion changes",
            body: "Twisted Fate's rolls gain sharper highs and lows, Gwen needs more groove but deals more primary-target damage, and Milio gains a chance to cast again at reduced base damage."
          },
          {
            title: "Mid and high-cost buffs",
            body: "Lulu grants more Medallion gold, Maokai gains Attack Speed and max-Health damage, Rhaast casts faster and hits harder, and Tahm Kench generates more Oracle gold each round."
          },
          {
            title: "Zed joins the base roster",
            body: "The Invader Zed Augment is removed and Zed joins the base champion pool, with base Health reduced from 1300 to 1100."
          }
        ]
      }
    }
  },
  "17.8": {
    version: "17.8",
    publishedAt: "2026-07-28T18:00:00.000Z",
    locales: {
      "zh-CN": {
        title: "17.8 版本更新",
        summary: "星神赛季迎来小型平衡调整：幻灵战队强势奖励被收紧，灵能特工装备获得增强，多名英雄的强度与羁绊得到微调。",
        sourceName: "Riot Games 官方更新公告",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-17-8/",
        highlights: [
          {
            title: "胖胖龙经典宝藏",
            body: "S16「英雄棋谭」的胖胖龙宝藏加入经典英雄联盟元素，包括经典野怪、凯尔的审判及黄金之心等怀旧装备，并将在版本上线后不久开放。"
          },
          {
            title: "羁绊与专属装备",
            body: "幻灵战队的歼灭者、冰爆护甲和雌狮之怨被削弱，5层奖励池同步调整；5神谕者的全队法力回复由 3 降至 2，4灵能特工的四件专属装备全面增强。"
          },
          {
            title: "低费英雄调整",
            body: "贝蕾亚攻击力由 35 提升至 40，崔斯特技能伤害提高；阿卡丽持续伤害下调，纳尔新增斗士羁绊。"
          },
          {
            title: "中高费英雄调整",
            body: "厄运小姐与锐雯获得增强，莎弥拉被削弱；黛安娜更快施法但护盾降低，莫甘娜新增神谕者并调整法力与治疗，劫的分身生命值惩罚进一步降低。"
          },
          {
            title: "强化符文增强",
            body: "「宇宙重启」提供的刷新次数由 8 次提高至 15 次。"
          }
        ]
      },
      "en-US": {
        title: "Patch 17.8",
        summary: "A light Space Gods balance patch that trims Anima Squad's strongest rewards, buffs Psionic items, and adjusts several champions and trait pairings.",
        sourceName: "Official Riot Games patch notes",
        sourceUrl: "https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-17-8/",
        highlights: [
          {
            title: "Choncc's Classic Treasure",
            body: "Set 16 Lore & Legends gets a classic League twist with classic PvE monsters, Kayle's tribunal, nostalgic items such as Heart of Gold, and more."
          },
          {
            title: "Traits and special items",
            body: "Anima Squad's Annihilator, Iceblast Armor, and Lioness' Lament are nerfed and the (5) loot table is adjusted. Conduit (5) ally Mana Regen drops from 3 to 2, while all four Psionic (4) items are buffed."
          },
          {
            title: "Low-cost champions",
            body: "Briar gains Attack Damage and Twisted Fate gains spell damage. Akali's damage over time is reduced, while Gnar also becomes a Brawler."
          },
          {
            title: "Mid and high-cost champions",
            body: "Miss Fortune and Riven are buffed, while Samira is nerfed. Diana casts sooner with a smaller shield, Morgana gains Conduit with Mana and healing adjustments, and Zed's clone Health penalty is reduced."
          },
          {
            title: "Augment buff",
            body: "Cosmic Restart now grants 15 rerolls, up from 8."
          }
        ]
      }
    }
  },
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
  const history = buildPatchHistory(patch, localized, locale);
  return {
    version: patch.version,
    publishedAt: patch.publishedAt,
    updatedAt: history.at(-1)?.publishedAt ?? patch.publishedAt,
    history,
    ...localized
  };
}

export function getCurrentPatchNote(locale = "zh-CN") {
  return getPatchNote(CURRENT_PATCH_VERSION, locale);
}
