import { getConceptCapabilityDefinition } from "./concept-capability-registry.js";
import { ITEM_CARRIER_REQUEST_PATTERN } from "./intent-patterns.js";

export const TFT_SEMANTIC_CAPABILITY_RULES_VERSION = "tft-semantic-capability-rules.v1";

const RULES = Object.freeze([
  Object.freeze({
    id: "historical_cross_version",
    requirement: "historical_cross_version_statistics",
    pattern: /(?:17\.\d+|历史|歷史|老补丁|上赛季|上个赛季|旧赛季|十个版本前|上个版本|十次更新之前).*(?:现在|現在|今天|当前|差异|差多少|走势|趋势|勝率|胜率|强度|精确)|(?:现在|現在|今天|当前).*(?:17\.\d+|历史|歷史|老补丁|上赛季|上个赛季|十次更新之前)/iu
  }),
  Object.freeze({
    id: "named_head_to_head",
    requirement: "head_to_head_statistics",
    pattern: /霞.*剑圣|霞.*劍聖|剑圣.*霞|劍聖.*霞/iu
  }),
  Object.freeze({
    id: "privileged_data_access",
    requirement: "privileged_data_access",
    pattern: /数据库|資料庫|数剧库|數劇庫|任意sql|执行\s*sql|所有玩家信息|所有玩家資料|玩家信息|玩家资料|隐藏战绩|绕过限制|绕过权限|繞過限制|未授权接口|删除统计库|把库拖出来|把庫拖出來/iu
  })
]);

function entities(frame = {}) {
  return [
    ...(frame.subjects ?? []),
    ...(frame.candidates ?? []),
    ...(frame.concepts ?? [])
  ];
}

export function isRecognizedTftDomainRequest(input) {
  const text = String(input ?? "");
  return RULES.some((rule) => rule.pattern.test(text));
}

export function deriveTftCapabilityRequirements(input, frame = {}) {
  const text = String(input ?? "");
  const requirements = new Set(frame.capabilityRequirements ?? []);
  for (const rule of RULES) {
    if (rule.pattern.test(text)) requirements.add(rule.requirement);
  }
  if (frame.action === "find_video") requirements.add("strategy_video_search");
  if (
    frame.constraints?.targetEntityType
    && (frame.constraints?.cost !== undefined || frame.constraints?.relation === "member_of_trait")
  ) requirements.add("entity_catalog_filtering");
  if (
    requirements.has("entity_catalog_filtering")
    && /(?:出装|出裝|裝備|装备).{0,8}(?:表现|表現|最好|最强|最強)|(?:主流|最好|最强|最強).{0,8}(?:出装|出裝|裝備|装备)|(?:怎么|怎麼|如何|咋|怎样|怎樣).{0,6}(?:出装|出裝|给装|給裝|配装|配裝|带装备|帶裝備)|(?:装备推荐|裝備推薦|推荐装备|推薦裝備|带什么装备|帶什麼裝備)/u.test(text)
  ) requirements.add("unit_build_statistics");
  if (frame.constraints?.externalSupportInterpretation === "non_trait_splash_unit") {
    requirements.add("composition_external_unit_statistics");
  }
  if (frame.constraints?.externalSupportInterpretation === "emblem_carrier") {
    requirements.add("item_carrier_statistics");
  }
  if (
    ITEM_CARRIER_REQUEST_PATTERN.test(text)
    && entities(frame).some((entity) => entity?.expectedType === "item" && entity?.resolvedId)
  ) requirements.add("item_carrier_statistics");
  for (const entity of entities(frame)) {
    if (entity?.expectedType !== "game_concept" || !entity?.resolvedId) continue;
    const definition = getConceptCapabilityDefinition(entity.resolvedId);
    if (definition && !definition.supportedActions.includes(frame.action)) {
      requirements.add(`concept_action:${definition.conceptId}:${frame.action}`);
    }
  }
  return [...requirements];
}
