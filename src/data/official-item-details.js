export const OFFICIAL_TFT_EQUIPMENT_URL = "https://game.gtimg.cn/images/lol/act/img/tft/js/equip.js";

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.equip)) return payload.equip;
  if (payload && typeof payload === "object") return Object.values(payload).filter((value) => value && typeof value === "object");
  return [];
}

export function parseOfficialTftEquipmentPayload(payload) {
  if (typeof payload !== "string") return rowsFromPayload(payload);
  const text = payload.trim().replace(/^\uFEFF/, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Official TFT equipment payload does not contain an item array");
  return rowsFromPayload(JSON.parse(text.slice(start, end + 1)));
}

export function buildOfficialTftItemDetailsCatalog(payload, options = {}) {
  const rows = parseOfficialTftEquipmentPayload(payload)
    .filter((row) => row?.englishName && row?.equipId);
  const sourceUrl = options.sourceUrl ?? OFFICIAL_TFT_EQUIPMENT_URL;
  const byEquipId = new Map(rows.map((row) => [String(row.equipId), row]));
  const byApiName = new Map();

  for (const row of rows) {
    const recipe = String(row.formula ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((equipId) => byEquipId.get(equipId))
      .filter(Boolean)
      .map((component) => ({
        equipId: String(component.equipId),
        apiName: component.englishName ?? null,
        name: component.name ?? component.englishName,
        iconUrl: component.imagePath ?? null
      }));
    const apiName = String(row.englishName);
    byApiName.set(apiName, {
      apiName,
      equipId: String(row.equipId),
      name: row.name ?? apiName,
      effect: decodeHtml(row.effect),
      keywords: compact(String(row.keywords ?? "").split(/[;,，、]/).map((value) => value.trim())),
      recipe,
      craftable: recipe.length > 0,
      iconUrl: row.imagePath ?? null,
      sourceUrl
    });
  }
  return byApiName;
}

export async function fetchOfficialTftItemDetails(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Official item details require fetch");
  const url = options.url ?? OFFICIAL_TFT_EQUIPMENT_URL;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs ?? 10000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Official item details request failed: ${response.status} ${response.statusText}`);
    return buildOfficialTftItemDetailsCatalog(await response.text(), { sourceUrl: url });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Official item details request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
