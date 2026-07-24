import { resolveEntities } from "../core/entity-resolver.js";
import { normalizeText } from "../core/normalizer.js";
import { GAME_CONCEPTS } from "./concept-resolver.js";

const ENTITY_TYPE_MAP = Object.freeze({
  unit: "champion",
  item: "item",
  trait: "trait"
});

const FALLBACK_MENTIONS = Object.freeze([
  ["霞", "champion"], ["逆羽", "champion"],
  ["剑圣", "champion"], ["劍聖", "champion"], ["剑生", "champion"],
  ["卡莎", "champion"], ["卡沙", "champion"],
  ["羊刀", "item"], ["杨刀", "item"], ["羊到", "item"], ["炼刀", "item"], ["练刀", "item"],
  ["巨九", "item"], ["巨9", "item"], ["无尽", "item"], ["月光刀", "item"], ["转职", "item"],
  ["观星者", "trait"], ["觀星者", "trait"], ["观星", "trait"], ["觀星", "trait"],
  ["阵容", "composition"], ["陣容", "composition"], ["阵荣", "composition"],
  ["这套", "composition"], ["這套", "composition"],
  ["攻略视频", "video"], ["攻略視訊", "video"], ["教学视频", "video"], ["教學視訊", "video"],
  ["当前版本", "patch"], ["當前版本", "patch"], ["这版本", "patch"], ["這版本", "patch"],
  ["所有玩家信息", "player_context"], ["所有玩家資料", "player_context"], ["玩家信息", "player_context"]
]);

function pushUnique(values, rawText, expectedType, source) {
  const normalizedRaw = normalizeText(rawText);
  if (!normalizedRaw) return;
  if (values.some((value) => (
    normalizeText(value.rawText) === normalizedRaw && value.expectedType === expectedType
  ))) return;
  values.push({ rawText: String(rawText), expectedType, source });
}

export function extractEntityMentions(input, options = {}) {
  const text = String(input ?? "");
  const values = [];
  if (options.catalog) {
    const resolved = resolveEntities(text, { catalog: options.catalog });
    for (const match of resolved.all ?? []) {
      pushUnique(values, match.alias, ENTITY_TYPE_MAP[match.entityType], "catalog_span");
    }
  }
  for (const [rawText, expectedType] of FALLBACK_MENTIONS) {
    if (text.includes(rawText)) pushUnique(values, rawText, expectedType, "reusable_mention_pattern");
  }
  for (const concept of GAME_CONCEPTS) {
    for (const alias of concept.aliases) {
      if (normalizeText(text).includes(normalizeText(alias))) {
        pushUnique(values, alias, "game_concept", "game_concept_alias");
        break;
      }
    }
  }
  const patch = text.match(/\b\d{1,2}\.\d{1,2}\b/u)?.[0];
  if (patch) pushUnique(values, patch, "patch", "patch_pattern");
  return values;
}
