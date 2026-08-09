import {
  createKnowledgeDocument,
  knowledgeDocumentToSemanticDocument
} from "./knowledge-document-schema.js";

export const USER_STRATEGY_KNOWLEDGE_VERSION = "user_strategy_knowledge.v1";

export const USER_STRATEGY_RULES = Object.freeze([
  Object.freeze({
    id: "repeat-deathcap-possible-augment",
    itemApiName: "TFT_Item_RabadonsDeathcap",
    itemName: "帽子",
    minimumCopies: 2,
    possibleCauses: Object.freeze(["大棒溢流", "更要命的帽子"]),
    statement: "同一套出装出现两个或以上帽子时，可能与“大棒溢流”或“更要命的帽子”强化符文有关；这只能作为可能性提示，不能据此确认玩家拥有该强化。"
  }),
  Object.freeze({
    id: "repeat-deathblade-possible-augment",
    itemApiName: "TFT_Item_Deathblade",
    itemName: "杀人剑",
    minimumCopies: 2,
    possibleCauses: Object.freeze(["大剑溢流", "更要命的战刃"]),
    statement: "同一套出装出现两个或以上杀人剑时，可能与“大剑溢流”或“更要命的战刃”强化符文有关；这只能作为可能性提示，不能据此确认玩家拥有该强化。"
  })
]);

function itemApiName(value) {
  return String(typeof value === "string" ? value : value?.apiName ?? "");
}

export function evaluateBuildKnowledgeSignals(items = []) {
  const counts = new Map();
  for (const item of items ?? []) {
    const apiName = itemApiName(item);
    if (apiName) counts.set(apiName, (counts.get(apiName) ?? 0) + 1);
  }
  return USER_STRATEGY_RULES.flatMap((rule) => {
    const copies = counts.get(rule.itemApiName) ?? 0;
    if (copies < rule.minimumCopies) return [];
    return [{
      schemaVersion: USER_STRATEGY_KNOWLEDGE_VERSION,
      ruleId: rule.id,
      kind: "possible_augment_explanation",
      certainty: "hypothesis",
      itemApiName: rule.itemApiName,
      itemName: rule.itemName,
      copies,
      possibleCauses: [...rule.possibleCauses],
      text: `该方案包含 ${copies} 个${rule.itemName}，可能与“${rule.possibleCauses.join("”或“")}”强化符文有关；不能据此确认玩家一定拥有该强化。`,
      evidenceId: `user-knowledge:${rule.id}`
    }];
  });
}

export function buildUserStrategyKnowledgeDocuments(options = {}) {
  const seasonContextId = String(options.seasonContextId ?? "set17-live");
  const locale = String(options.locale ?? "zh-CN");
  return USER_STRATEGY_RULES.map((rule) => createKnowledgeDocument({
    id: `${seasonContextId}:user_strategy:${rule.id}`,
    documentType: "static_game_knowledge",
    title: `${rule.itemName}重复出装的可能强化原因`,
    text: `${rule.statement}\nmay indicate a related augment, but does not prove that the augment was selected.`,
    metadata: {
      source: "user_maintained_knowledge",
      sourceId: rule.id,
      author: "workspace_user",
      generatedAt: "2026-08-09T00:00:00.000Z",
      season: seasonContextId,
      locale,
      topics: [rule.itemName, rule.itemApiName, ...rule.possibleCauses, "重复装备", "强化符文"],
      claimType: "speculation",
      conditions: [`${rule.itemApiName} copies >= ${rule.minimumCopies}`],
      namespace: "static_knowledge",
      reviewStatus: "user_provided",
      rawData: {
        knowledgeVersion: USER_STRATEGY_KNOWLEDGE_VERSION,
        trigger: {
          itemApiName: rule.itemApiName,
          minimumCopies: rule.minimumCopies
        },
        possibleCauses: rule.possibleCauses
      }
    }
  }));
}

export function buildUserStrategySemanticDocuments(options = {}) {
  const seasonContextId = String(options.seasonContextId ?? "set17-live");
  return buildUserStrategyKnowledgeDocuments(options).map((document) => (
    knowledgeDocumentToSemanticDocument(document, { seasonContextId })
  ));
}
