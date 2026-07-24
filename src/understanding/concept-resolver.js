import { normalizeAlias } from "../core/normalizer.js";

export const GAME_CONCEPT_CATALOG_VERSION = "game-concepts.v1";

export const GAME_CONCEPTS = Object.freeze([
  {
    id: "concept.strategy.fast9_nine_five",
    canonicalName: "九五",
    aliases: ["九五", "95", "九五阵容", "95阵容", "高费九五", "速九"],
    description: "以快速升九并使用高费棋子为目标的阵容构筑方式。"
  },
  {
    id: "concept.strategy.reroll",
    canonicalName: "赌狗",
    aliases: ["赌狗", "赌牌", "低费赌", "D牌", "D卡", "追三", "reroll"],
    description: "在较低等级反复刷新商店并追求低费棋子三星的策略。"
  },
  {
    id: "concept.strategy.economy_operation",
    canonicalName: "运营",
    aliases: ["运营", "运营阵容", "经济运营", "拉人口", "存钱升级"],
    description: "通过经济、等级和阶段节奏管理逐步构筑阵容。"
  },
  {
    id: "concept.economy.loss_streak",
    canonicalName: "连败",
    aliases: ["连败", "连败开", "卖血", "吃连败"],
    description: "主动或被动保持连续失败以获取经济或选秀收益。"
  },
  {
    id: "concept.item.frontline",
    canonicalName: "前排装",
    aliases: ["前排装", "肉装", "坦装", "防装", "主坦装"],
    description: "主要提供生存、抗性或前排功能的装备集合。"
  }
]);

function conceptCandidates(rawText) {
  const normalized = normalizeAlias(rawText);
  if (!normalized) return [];
  const values = [];
  for (const concept of GAME_CONCEPTS) {
    for (const alias of concept.aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalized === normalizedAlias) {
        values.push({
          id: concept.id,
          canonicalName: concept.canonicalName,
          matchedAlias: alias,
          confidence: normalized === normalizeAlias(concept.canonicalName) ? 1 : 0.99,
          source: "curated_game_concept"
        });
        break;
      }
    }
  }
  return values;
}

export function resolveGameConcept(rawText) {
  const candidates = conceptCandidates(rawText);
  const top = candidates[0] ?? null;
  return {
    rawText: String(rawText ?? ""),
    resolvedId: candidates.length === 1 ? top.id : null,
    canonicalName: candidates.length === 1 ? top.canonicalName : null,
    expectedType: "game_concept",
    version: GAME_CONCEPT_CATALOG_VERSION,
    candidates,
    source: candidates.length === 1 ? top.source : "curated_game_concept",
    confidence: candidates.length === 1 ? top.confidence : 0
  };
}
