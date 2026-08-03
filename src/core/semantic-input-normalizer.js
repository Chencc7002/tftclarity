import { normalizeText } from "./normalizer.js";

const EMBLEM_TYPO_SUFFIXES = Object.freeze(["文章"]);
const ITEM_CARRIER_CONTEXT = /(?:最适合|适合|推荐|应该|优先|最好|携带者|适配).{0,12}(?:谁|哪个|哪些|英雄|棋子|携带|带|装备)|(?:谁|哪个|哪些|英雄|棋子).{0,12}(?:携带|带|装备|适合|推荐)/u;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function emblemNames(catalog) {
  const names = new Set();
  for (const item of array(catalog?.items)) {
    if (item?.current === false || item?.category !== "emblem") continue;
    for (const value of [
      item.preferredDisplayName,
      item.zhName,
      item.displayName,
      item.shortName,
      ...array(item.aliases)
    ]) {
      const name = String(value ?? "").trim();
      if (name.endsWith("纹章") && name.length > 2) names.add(name);
    }
  }
  return [...names].sort((left, right) => right.length - left.length);
}

export function normalizeTftSemanticInput(input, options = {}) {
  const originalInput = String(input ?? "");
  if (!ITEM_CARRIER_CONTEXT.test(normalizeText(originalInput))) {
    return { originalInput, normalizedInput: originalInput, corrections: [] };
  }

  let normalizedInput = originalInput;
  const corrections = [];
  for (const emblemName of emblemNames(options.catalog)) {
    const baseName = emblemName.slice(0, -2);
    for (const typoSuffix of EMBLEM_TYPO_SUFFIXES) {
      const typo = `${baseName}${typoSuffix}`;
      if (!normalizedInput.includes(typo)) continue;
      normalizedInput = normalizedInput.replaceAll(typo, emblemName);
      corrections.push({
        type: "catalog_backed_emblem_typo",
        from: typo,
        to: emblemName
      });
    }
  }

  return { originalInput, normalizedInput, corrections };
}
