import { normalizeTraditionalChinese } from "../../core/normalizer.js";
import { normalizeCompsData } from "../../data/metatft-response-adapter.js";
import { normalizeClusterDefinitions } from "../../data/comp-response-adapter.js";

const TYPES = { units: "unit", items: "item", traits: "trait", augments: "augment", compositions: "composition" };
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

function text(value) {
  return normalizeTraditionalChinese(String(value ?? "").replace(/<[^>]*>/gu, ""))
    .normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function list(value) {
  return value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [];
}

function aliases(record) {
  return [...new Set([
    record.preferredDisplayName, record.shortName, record.zhName, record.enName,
    record.displayName, record.name, record.apiName, ...(record.aliases ?? [])
  ].filter(Boolean).map(text).filter((alias) => /\p{L}/u.test(alias)))];
}

// Only supplied, season-scoped records are used. No fuzzy alias promotion,
// static cross-season fallback, network retrieval, or model-generated identities.
function records(resources) {
  const catalog = resources.catalog ?? {};
  const byId = new Map();
  const normalized = normalizeCompsData(resources.compsData ?? {});
  const compositions = [...list(resources.compositions), ...normalized.compOptions.map((row) => ({
    compId: row.cluster ?? row.cluster_id,
    name: row.comp_name ?? row.name_string ?? row.name
  })), ...normalizeClusterDefinitions(normalized.clusterInfo).flatMap((row) => {
    // Metadata already loaded by the registered tool owns these names. Keep
    // opaque aliases, but let named trait/unit combinations resolve separately.
    const name = row.raw.comp_name ?? row.raw.name_string ?? row.raw.name;
    return typeof name === "string" && !/TFT\d*_|DA_/u.test(name)
      ? [{ compId: row.clusterId, name, aliases: row.raw.aliases ?? [] }] : [];
  })];
  for (const [key, type] of Object.entries(TYPES)) {
    const source = [...list(catalog[key]), ...list(resources.entityDetails?.[key]),
      ...(key === "compositions" ? compositions : [])];
    for (const record of source) {
      if (record.current === false) continue;
      const rawId = record.canonicalApiName ?? record.apiName ?? record.compId;
      if (!rawId) continue;
      const id = `${type}:${type === "trait" ? String(rawId).replace(/_\d+$/u, "") : rawId}`;
      const previous = byId.get(id);
      byId.set(id, {
        id, type, name: previous?.name ?? record.zhName ?? record.name ?? record.displayName ?? String(rawId),
        aliases: [...new Set([...(previous?.aliases ?? []), ...aliases(record)])]
      });
    }
  }
  return [...byId.values()];
}

function occurrences(value, alias) {
  const spans = [];
  let start = value.indexOf(alias);
  const singleHan = /^\p{Script=Han}$/u.test(alias);
  const wordSpans = singleHan ? [...segmenter.segment(value)] : [];
  while (start !== -1) {
    const end = start + alias.length;
    // Latin aliases match whole Latin words (Yi must not match playing).
    const boundary = (!/^[a-z0-9]/u.test(alias) || !/[a-z0-9]/u.test(value[start - 1] ?? ""))
      && (!/[a-z0-9]$/u.test(alias) || !/[a-z0-9]/u.test(value[end] ?? ""));
    // A single Han name must be a word: 易 is not the 易 in 轻易/容易.
    const gameContext = /(?:[一二三123]星|主c|副c)$/iu.test(value.slice(0, start))
      || (/^(?:主c|副c)/iu.test(value.slice(end)) && wordSpans.some((entry) => entry.index === start));
    const word = !singleHan || gameContext
      || wordSpans.some((entry) => entry.index === start && entry.segment === alias);
    if (boundary && word) spans.push({ start, end });
    start = value.indexOf(alias, start + 1);
  }
  return spans;
}

function mentions(value, entries, query = false) {
  const hits = entries.flatMap((entity) => entity.aliases.flatMap((alias) => (
    occurrences(value, alias).map((span) => ({ ...span, alias, entity }))
  )));
  // Longest known name wins: 光明羊刀 must not also become ordinary 羊刀;
  // a registered composition name is not reduced to an arbitrary member.
  return hits.filter((hit) => !hits.some((other) => (
    other.start <= hit.start && other.end >= hit.end
      && other.end - other.start > hit.end - hit.start
      && (query || other.entity.type !== "composition")
  )));
}

export function createVideoEntityScope(query, resources = {}) {
  const entries = records(resources);
  const value = text(query);
  const hits = mentions(value, entries, true);
  const selected = [...new Map(hits.map((hit) => [hit.entity.id, hit.entity])).values()];
  const ambiguous = hits.some((hit) => hits.some((other) => (
    hit.start === other.start && hit.end === other.end && hit.entity.id !== other.entity.id
  )));
  // Do not silently turn exclusions or mixed AND/OR expressions into a
  // different request. These remain observable and fail closed in enforce mode.
  const unsupportedRelation = selected.length > 0 && /不要|排除|不含|除了|而非|不是|\bnot\b/iu.test(value);
  const ordered = [...hits].sort((a, b) => a.start - b.start || a.end - b.end);
  const relations = ordered.slice(1).flatMap((hit, index) => {
    const previous = ordered[index];
    if (hit.entity.id === previous.entity.id || hit.start < previous.end) return [];
    const gap = value.slice(previous.end, hit.start);
    return [/或者|或是|或|\bor\b|\//iu.test(gap) ? "any" : "all"];
  });
  const hasOr = relations.includes("any");
  const hasAnd = relations.includes("all");
  const status = ambiguous || unsupportedRelation || (selected.length > 1 && hasOr && hasAnd)
    ? "ambiguous" : selected.length ? "resolved" : entries.length ? "unscoped" : "catalog_unavailable";
  const operator = hasOr ? "any" : "all";
  const scope = {
    schemaVersion: "video-entity-scope.v1", status, operator,
    entities: selected.map(({ id, type, name }) => ({ id, type, name })),
    queryMatches: hits.map(({ alias, entity }) => ({ entityId: entity.id, alias }))
  };
  return {
    scope,
    matchTitle(title) {
      if (status === "catalog_unavailable" || status === "ambiguous") {
        return { accepted: false, reason: status, matches: [] };
      }
      if (status === "unscoped") return { accepted: true, reason: "unscoped", matches: [] };
      const titleHits = mentions(text(title), entries);
      const matches = selected.flatMap((entity) => {
        const hit = titleHits.find((entry) => entry.entity.id === entity.id
          && !titleHits.some((other) => other.start === entry.start && other.end === entry.end
            && other.entity.id !== entry.entity.id));
        return hit ? [{ entityId: entity.id, alias: hit.alias }] : [];
      });
      const accepted = operator === "any" ? matches.length > 0 : matches.length === selected.length;
      return { accepted, reason: accepted ? "title_entity_match" : "title_entity_mismatch", matches };
    }
  };
}
