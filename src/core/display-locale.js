const SUPPORTED_DISPLAY_LOCALES = new Set(["zh-CN", "en-US"]);

export function normalizeDisplayLocale(value, fallback = "zh-CN") {
  const normalized = String(value ?? "").trim().replace("_", "-");
  if (/^en(?:-US)?$/iu.test(normalized)) return "en-US";
  if (/^zh(?:-CN)?$/iu.test(normalized)) return "zh-CN";
  return SUPPORTED_DISPLAY_LOCALES.has(fallback) ? fallback : "zh-CN";
}

export function containsHan(value) {
  return /\p{Script=Han}/u.test(String(value ?? ""));
}

function titleCaseEnglish(value) {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .split(" ")
    .map((part) => {
      if (/^[A-Z0-9]{2,4}$/u.test(part)) return part;
      return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
    })
    .join(" ");
}

function apiNameToken(apiName) {
  return String(apiName ?? "")
    .replace(/^TFT\d*_/iu, "")
    .replace(/^DA_(?:18_)?/iu, "")
    .replace(/(?:UniqueTrait)?18$/iu, "")
    .replace(/_(?:AD|AP|Base|Small)$/iu, "")
    .replace(/Trait$/iu, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2");
}

function englishAliasScore(value) {
  const text = String(value ?? "").trim();
  if (!text || containsHan(text) || !/[A-Za-z]/u.test(text)) return -1;
  if (/^(?:TFT|DA)_/iu.test(text) || /_/u.test(text)) return -1;
  const words = text.split(/\s+/u).length;
  return (words > 1 ? 100 : 0)
    + (/[’']/u.test(text) ? 30 : 0)
    + Math.min(text.length, 40)
    - (/^[a-z]{1,3}$/u.test(text) ? 50 : 0);
}

export function deriveEnglishEntityName(entity = {}, apiName = entity?.apiName) {
  const explicit = [entity.enName, entity.nameEn, entity.displayNameEn]
    .map((value) => String(value ?? "").trim())
    .find((value) => value && !containsHan(value));
  if (explicit) return explicit;

  const alias = [...(entity.aliases ?? [])]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => englishAliasScore(right) - englishAliasScore(left))[0];
  if (englishAliasScore(alias) >= 0) return titleCaseEnglish(alias).replace(/18$/u, "");

  const token = titleCaseEnglish(apiNameToken(apiName));
  return token || String(apiName ?? "");
}

export function localizedEntityName(entity = {}, locale = "zh-CN", fallback = "") {
  return normalizeDisplayLocale(locale) === "en-US"
    ? deriveEnglishEntityName(entity, entity.apiName) || String(fallback || "")
    : String(
      entity.zhName
      ?? entity.nameZh
      ?? entity.displayName
      ?? entity.name
      ?? fallback
      ?? entity.apiName
      ?? ""
    );
}

const ROLE_LABELS = new Map([
  ["物理刺客", ["物理刺客", "AD Assassin"]],
  ["魔法刺客", ["法系刺客", "AP Assassin"]],
  ["法系刺客", ["法系刺客", "AP Assassin"]],
  ["物理战士", ["物理战士", "AD Fighter"]],
  ["魔法战士", ["法系战士", "AP Fighter"]],
  ["法系战士", ["法系战士", "AP Fighter"]],
  ["物理坦克", ["物理坦克", "AD Tank"]],
  ["魔法坦克", ["法系坦克", "AP Tank"]],
  ["法系坦克", ["法系坦克", "AP Tank"]],
  ["物理术师", ["物理施法者", "AD Caster"]],
  ["物理施法者", ["物理施法者", "AD Caster"]],
  ["魔法术师", ["法系施法者", "AP Caster"]],
  ["法系施法者", ["法系施法者", "AP Caster"]],
  ["物理专家", ["物理专家", "AD Specialist"]],
  ["魔法专家", ["法系专家", "AP Specialist"]],
  ["法系专家", ["法系专家", "AP Specialist"]],
  ["物理输出", ["物理输出", "AD Carry"]]
]);

function roleKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (ROLE_LABELS.has(text)) return text;
  const normalized = text.toLowerCase();
  const damage = /attack|physical|\bad\b/u.test(normalized) ? "物理" : "魔法";
  if (/assassin/u.test(normalized)) return `${damage}刺客`;
  if (/tank/u.test(normalized)) return `${damage}坦克`;
  if (/fighter/u.test(normalized)) return `${damage}战士`;
  if (/marksman/u.test(normalized)) return `${damage}专家`;
  if (/caster/u.test(normalized)) return `${damage}术师`;
  if (/specialist/u.test(normalized)) return `${damage}专家`;
  return text;
}

export function localizedRoleLabel(value, locale = "zh-CN") {
  const key = roleKey(value);
  const labels = ROLE_LABELS.get(key);
  if (!labels) return String(value ?? "");
  return labels[normalizeDisplayLocale(locale) === "en-US" ? 1 : 0];
}
