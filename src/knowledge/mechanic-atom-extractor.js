import { createHash } from "node:crypto";

const UNIT_PATTERNS = [
  ["seconds", /秒/u],
  ["hexes", /格/u],
  ["stacks", /层/u],
  ["attacks", /次攻击/u],
  ["casts", /次施法/u],
  ["targets", /个(?:目标|敌人|弈子)/u],
  ["mana", /法力/u],
  ["health", /生命值/u],
  ["armor", /护甲/u],
  ["magic_resist", /魔抗/u],
  ["attack_damage", /攻击力/u],
  ["ability_power", /法术强度/u],
  ["attack_speed", /攻击速度/u]
];

const STAT_UNITS = Object.freeze({
  health: "health",
  healthByStar: "health",
  mana: "mana",
  startingMana: "mana",
  attackDamage: "attack_damage",
  attackDamageByStar: "attack_damage",
  armor: "armor",
  magicResist: "magic_resist",
  attackSpeed: "attacks_per_second",
  attackRange: "hexes",
  critChance: "percentage_point"
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

function sentenceAt(text, index) {
  const start = Math.max(
    text.lastIndexOf("。", index - 1),
    text.lastIndexOf("；", index - 1),
    text.lastIndexOf(";", index - 1),
    text.lastIndexOf("\n", index - 1)
  ) + 1;
  const candidates = ["。", "；", ";", "\n"]
    .map((token) => text.indexOf(token, index))
    .filter((position) => position >= 0);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(start, end).trim();
}

function inferUnit(text, position, suffix) {
  if (suffix === "%") return "percentage_point";
  let best = null;
  for (const [unit, pattern] of UNIT_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gu"))) {
      const distance = Math.abs((match.index ?? 0) - position);
      if (!best || distance < best.distance) best = { unit, distance };
    }
  }
  return best?.unit ?? "count";
}

function conditionFromContext(context) {
  const marker = context.match(
    /(?:每[^，。；;]{0,24}|当[^，。；;]{0,32}|在[^，。；;]{0,24}时|如果[^，。；;]{0,32}|持续[^，。；;]{0,20})/u
  );
  if (marker?.[0]) return { condition: marker[0], confidence: "high" };
  if (/施放|主动/u.test(context)) return { condition: "on_cast", confidence: "medium" };
  if (/普攻|攻击|命中/u.test(context)) return { condition: "on_attack_or_hit", confidence: "medium" };
  if (/^\s*\+|获得|提供|增加|提升/u.test(context)) return { condition: "always", confidence: "medium" };
  return { condition: "on_effect_resolution", confidence: "low" };
}

function starLevelPositions(text) {
  const positions = new Map();
  const seriesPattern = /-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?){2}/gu;
  for (const series of text.matchAll(seriesPattern)) {
    let cursor = series.index ?? 0;
    series[0].split("/").forEach((value, index) => {
      positions.set(cursor, `star_level_${index + 1}`);
      cursor += value.length + 1;
    });
  }
  return positions;
}

export function extractTextNumericAtoms(text, options = {}) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) return [];
  const sourceHash = String(options.sourceHash ?? sha256(normalizedText));
  const sourceRef = options.sourceRef ?? null;
  const atoms = [];
  const pattern = /(?<![\w@])(-?\d+(?:\.\d+)?)(\s*%?)/gu;
  const starPositions = starLevelPositions(normalizedText);

  for (const match of normalizedText.matchAll(pattern)) {
    const context = sentenceAt(normalizedText, match.index ?? 0);
    const suffix = match[2]?.trim() ?? "";
    const parsedCondition = starPositions.has(match.index ?? 0)
      ? { condition: starPositions.get(match.index ?? 0), confidence: "high" }
      : conditionFromContext(context);
    atoms.push({
      atomType: "numeric_text_fact",
      value: Number(match[1]),
      unit: inferUnit(normalizedText, match.index ?? 0, suffix),
      condition: parsedCondition.condition,
      conditionConfidence: parsedCondition.confidence,
      raw: match[0].trim(),
      context,
      source: {
        ref: sourceRef,
        version: options.sourceVersion ?? null,
        hash: sourceHash
      }
    });
  }
  return atoms;
}

export function extractStatAtoms(stats, options = {}) {
  const sourceHash = String(options.sourceHash ?? sha256(stableStringify(stats ?? {})));
  const atoms = [];
  for (const [property, rawValue] of Object.entries(stats ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value, index) => {
      if (!Number.isFinite(Number(value))) return;
      atoms.push({
        atomType: "base_stat",
        property,
        value: Number(value),
        unit: STAT_UNITS[property] ?? "count",
        condition: Array.isArray(rawValue) ? `star_level_${index + 1}` : "base_1_star",
        source: {
          ref: options.sourceRef ? `${options.sourceRef}.stats.${property}` : null,
          version: options.sourceVersion ?? null,
          hash: sourceHash
        }
      });
    });
  }
  return atoms;
}

export function entityContentHash(entity) {
  return sha256(stableStringify(entity));
}
