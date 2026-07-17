export const OFFICIAL_TFT_CHESS_URL = "https://game.gtimg.cn/images/lol/act/img/tft/js/chess.js";
export const OFFICIAL_TFT_RACE_URL = "https://game.gtimg.cn/images/lol/act/img/tft/js/race.js";
export const OFFICIAL_TFT_JOB_URL = "https://game.gtimg.cn/images/lol/act/img/tft/js/job.js";

const SCALE_LABELS = new Map([
  ["scaleAD", "攻击力"],
  ["scaleAP", "法术强度"],
  ["scaleAS", "攻击速度"],
  ["scaleArmor", "护甲"],
  ["scaleMR", "魔抗"],
  ["scaleHealth", "生命值"]
]);

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

export function decodeOfficialTftHtml(value) {
  return String(value ?? "")
    // Static encyclopedia pages represent the default game state. Runtime-only
    // ShowIf branches can contain unresolved TFTUnitProperty tokens, while the
    // paired ShowIfNot branch contains the official default value.
    .replace(
      /<ShowIfNot(?:\.[^>]*)?>([\s\S]*?)<\/ShowIfNot(?:\.[^>]*)?>/gi,
      "$1"
    )
    .replace(
      /<ShowIf(?:\.[^>]*)?>[\s\S]*?<\/ShowIf(?:\.[^>]*)?>/gi,
      ""
    )
    .replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/%i:([a-z0-9_]+)%/gi, (_match, token) => SCALE_LABELS.get(token) ?? token)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, " ")
    .replace(/攻击力法术强度/g, "攻击力/法术强度")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === "object") return Object.values(payload).filter((value) => value && typeof value === "object");
  return [];
}

export function parseOfficialTftEntityPayload(payload) {
  if (typeof payload !== "string") return rowsFromPayload(payload);
  const text = payload.trim().replace(/^\uFEFF/, "");
  try {
    return rowsFromPayload(JSON.parse(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Official TFT entity payload does not contain JSON");
    return rowsFromPayload(JSON.parse(text.slice(start, end + 1)));
  }
}

function payloadMeta(payload, sourceUrl) {
  const source = typeof payload === "string" ? null : payload;
  return {
    version: source?.version ?? source?.gameVersion ?? null,
    season: source?.season ?? null,
    updatedAt: source?.time ?? source?.updatedAt ?? null,
    url: sourceUrl
  };
}

function starValues(value) {
  const values = String(value ?? "").split("/").map(numberOrNull).filter((entry) => entry !== null);
  return values.length ? values : null;
}

function traitLevels(level = {}) {
  return Object.entries(level)
    .map(([units, effect]) => ({ units: numberOrNull(units), effect: decodeOfficialTftHtml(effect) }))
    .filter((entry) => entry.units !== null && entry.effect)
    .sort((a, b) => a.units - b.units);
}

export function buildOfficialTftEntityDetails(payloads, options = {}) {
  const chessPayload = payloads?.chess ?? {};
  const racePayload = payloads?.race ?? {};
  const jobPayload = payloads?.job ?? {};
  const chessUrl = options.chessUrl ?? OFFICIAL_TFT_CHESS_URL;
  const raceUrl = options.raceUrl ?? OFFICIAL_TFT_RACE_URL;
  const jobUrl = options.jobUrl ?? OFFICIAL_TFT_JOB_URL;
  const units = new Map();
  const traits = new Map();

  for (const row of parseOfficialTftEntityPayload(chessPayload)) {
    const apiName = String(row.hero_EN_name ?? row.apiName ?? row.characterid ?? "").trim();
    if (!apiName) continue;
    units.set(apiName, {
      apiName,
      chessId: row.chessId ? String(row.chessId) : null,
      name: row.displayName ?? row.name ?? apiName,
      cost: numberOrNull(row.price ?? row.cost),
      role: row.chessRole ?? row.role ?? null,
      traitNames: compact([...(String(row.races ?? "").split(/[;,，]/)), ...(String(row.jobs ?? "").split(/[;,，]/))].map((value) => value.trim())),
      stats: {
        health: numberOrNull(row.life),
        healthByStar: starValues(row.lifeData),
        mana: numberOrNull(row.magic),
        startingMana: numberOrNull(row.startMagic),
        attackDamage: numberOrNull(row.attack),
        attackDamageByStar: starValues(row.attackData),
        armor: numberOrNull(row.armor),
        magicResist: numberOrNull(row.spellBlock),
        attackSpeed: numberOrNull(row.attackSpeed),
        attackRange: numberOrNull(row.attackRange),
        critChance: numberOrNull(row.crit)
      },
      ability: {
        name: row.skillName ?? null,
        type: row.skillType ?? null,
        description: decodeOfficialTftHtml(row.skillIntroduce),
        iconUrl: row.skillImage ?? null
      },
      source: payloadMeta(chessPayload, chessUrl)
    });
  }

  for (const [type, payload, sourceUrl] of [["race", racePayload, raceUrl], ["job", jobPayload, jobUrl]]) {
    for (const row of parseOfficialTftEntityPayload(payload)) {
      const apiName = String(row.characterid ?? row.apiName ?? "").trim();
      if (!apiName) continue;
      traits.set(apiName, {
        apiName,
        traitId: row.traitId ? String(row.traitId) : row.raceId ? String(row.raceId) : row.jobId ? String(row.jobId) : null,
        name: row.name ?? apiName,
        type,
        description: decodeOfficialTftHtml(row.introduce),
        levels: traitLevels(row.level),
        iconUrl: row.imagePath ?? null,
        source: payloadMeta(payload, sourceUrl)
      });
    }
  }

  return {
    units,
    traits,
    meta: {
      version: payloadMeta(chessPayload, chessUrl).version,
      season: payloadMeta(chessPayload, chessUrl).season,
      updatedAt: payloadMeta(chessPayload, chessUrl).updatedAt,
      sources: [chessUrl, raceUrl, jobUrl]
    }
  };
}

export async function fetchOfficialTftEntityDetails(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Official TFT entity details require fetch");
  const chessUrl = options.chessUrl ?? OFFICIAL_TFT_CHESS_URL;
  const raceUrl = options.raceUrl ?? OFFICIAL_TFT_RACE_URL;
  const jobUrl = options.jobUrl ?? OFFICIAL_TFT_JOB_URL;
  const timeoutMs = Number(options.timeoutMs ?? 10000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const urls = [chessUrl, raceUrl, jobUrl];
    const responses = await Promise.all(urls.map((url) => fetchImpl(url, { signal: controller.signal })));
    for (const response of responses) {
      if (!response.ok) throw new Error(`Official TFT entity details request failed: ${response.status} ${response.statusText}`);
    }
    const payloads = await Promise.all(responses.map(async (response) => {
      const text = await response.text();
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    }));
    return buildOfficialTftEntityDetails({ chess: payloads[0], race: payloads[1], job: payloads[2] }, { chessUrl, raceUrl, jobUrl });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Official TFT entity details request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
