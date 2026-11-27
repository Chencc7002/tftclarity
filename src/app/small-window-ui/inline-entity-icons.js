import { catalogEntries } from "./answer-comparison.js";

const OPAQUE_KEY_PATTERN = /^(?:DA_|TFT\d*_Item_|TFT\d+_|Artifact_|Item_|Trait_|cluster:)/iu;
const ASCII_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '.-]*$/u;
const ASCII_WORD_CHAR = /[A-Za-z0-9]/u;
const ASCII_STOPWORDS = new Set([
  "all", "and", "avg", "best", "comp", "comps", "for", "high", "item", "items",
  "low", "max", "min", "new", "one", "pan", "pbe", "rank", "set", "the", "top",
  "two", "unit", "units", "win"
]);
const SKIP_ANCESTOR_SELECTOR = [
  "script", "style", "code", "pre", "textarea", "input", "select", "option", "svg",
  "button", "a", ".asset-thumb", ".item", ".entity-inline", ".answer-comparison__name",
  ".chat-core-item", ".chat-comp-cores", ".chat-build-preview header", ".comp-unit",
  ".emblem-card-head", ".emblem-recipe", ".emblem-carrier", ".card-title-group",
  ".entity-confirmation-choices", ".emblem-unit-filter-icon"
].join(",");

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function cleanLabel(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function isUsableLabel(label) {
  if (!label || OPAQUE_KEY_PATTERN.test(label)) return false;
  if (ASCII_LABEL_PATTERN.test(label)) {
    const lower = label.toLowerCase();
    if (ASCII_STOPWORDS.has(lower)) return false;
    return label.length >= 3 || label.toUpperCase() === "EZ";
  }
  return label.length >= 2;
}

function candidateLabels(entry) {
  const raw = [
    entry.name,
    entry.zhName,
    entry.preferredDisplayName,
    entry.shortName,
    entry.enName,
    entry.enName ? String(entry.enName).replace(/\d+$/u, "") : "",
    ...(Array.isArray(entry.aliases) ? entry.aliases : [])
  ];
  const labels = [];
  const seen = new Set();
  for (const item of raw) {
    const label = cleanLabel(item);
    if (!isUsableLabel(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function collectScopedEntries(data) {
  if (!data || typeof data !== "object") return [];
  const entries = [];
  const pushEntity = (entity, entityType) => {
    if (!entity || typeof entity !== "object" || !entity.iconUrl) return;
    entries.push({ ...entity, entityType: entity.entityType ?? entityType });
  };
  pushEntity(data.unit, "unit");
  pushEntity(data.item, "item");
  pushEntity(data.itemPerformance?.item, "item");
  for (const item of data.itemRankings ?? []) pushEntity(item, "item");
  for (const item of data.itemPerformance?.topRankings ?? []) pushEntity(item, "item");
  for (const item of data.coreItemSummary?.items ?? []) pushEntity(item, "item");
  for (const card of data.cards ?? []) {
    for (const item of card.items ?? []) pushEntity(item, "item");
  }
  for (const row of data.rows ?? []) {
    pushEntity(row.item, "item");
    for (const part of row.recipe ?? []) pushEntity(part, "item");
  }
  for (const carrier of data.carriers ?? []) {
    pushEntity(carrier.unit, "unit");
    for (const build of carrier.builds ?? []) {
      for (const item of build.displayItems ?? []) pushEntity(item, "item");
    }
  }
  const groups = [data, ...(data.compositionResultGroups ?? []).map((group) => group?.result).filter(Boolean)];
  for (const group of groups) {
    const comps = [
      ...Object.values(group.rankings ?? {}).flat(),
      ...(group.rising ?? []),
      ...(group.falling ?? []),
      ...(group.improving ?? [])
    ];
    for (const comp of comps) {
      for (const unit of comp?.units ?? []) {
        pushEntity(unit, "unit");
        for (const item of unit.items ?? []) pushEntity(item, "item");
      }
      for (const trait of comp?.traits ?? []) pushEntity(trait, "trait");
    }
  }
  return entries;
}

export function buildInlineEntityMatcher(catalogPool = [], scopedPool = []) {
  const byKey = new Map();
  const register = (entry, priority) => {
    if (!entry?.iconUrl) return;
    const identity = `${entry.entityType ?? "entity"}:${entry.apiName ?? entry.name ?? ""}`;
    for (const label of candidateLabels(entry)) {
      const key = label.toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { label, entry, identity, priority, ambiguous: false });
        continue;
      }
      if (existing.identity === identity && priority <= existing.priority) continue;
      if (priority > existing.priority) {
        byKey.set(key, { label, entry, identity, priority, ambiguous: false });
      } else if (priority === existing.priority) {
        existing.ambiguous = true;
      }
    }
  };
  for (const entry of catalogPool) register(entry, 1);
  for (const entry of scopedPool) register(entry, 2);

  const resolved = [...byKey.values()].filter((record) => !record.ambiguous);
  if (!resolved.length) return null;
  resolved.sort((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));
  const lookup = new Map(resolved.map((record) => [record.label.toLowerCase(), record.entry]));
  const pattern = new RegExp(resolved.map((record) => escapeRegex(record.label)).join("|"), "giu");
  return { pattern, lookup };
}

function createInlineEntitySpan(matchedText, entry, doc) {
  const span = doc.createElement("span");
  span.className = "entity-inline";
  span.dataset.entityType = entry.entityType ?? "entity";
  if (entry.apiName) span.dataset.entityId = entry.apiName;

  const img = doc.createElement("img");
  img.className = "entity-inline__icon";
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  img.loading = "lazy";
  img.decoding = "async";
  let fallback = entry.fallbackIconUrl ?? null;
  img.addEventListener("error", () => {
    if (fallback && img.src !== fallback) {
      img.src = fallback;
      fallback = null;
    } else {
      img.remove();
    }
  });
  img.src = entry.iconUrl;
  span.append(img, doc.createTextNode(matchedText));
  return span;
}

function shouldSkipTextNode(textNode) {
  const parent = textNode?.parentElement;
  if (!parent) return true;
  if (!textNode.nodeValue || textNode.nodeValue.trim().length < 2) return true;
  if (typeof parent.closest === "function" && parent.closest(SKIP_ANCESTOR_SELECTOR)) {
    return true;
  }
  return false;
}

export function decorateInlineEntityIcons(root, matcher) {
  if (!root || !matcher?.pattern || !matcher?.lookup) return 0;
  const doc = root.ownerDocument ?? document;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) {
    if (!shouldSkipTextNode(node)) textNodes.push(node);
    node = walker.nextNode();
  }

  let decoratedCount = 0;
  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    matcher.pattern.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    let changed = false;
    for (const match of text.matchAll(matcher.pattern)) {
      const matched = match[0];
      const start = match.index;
      const end = start + matched.length;
      if (ASCII_LABEL_PATTERN.test(matched)) {
        const before = start > 0 ? text[start - 1] : "";
        const after = end < text.length ? text[end] : "";
        if (ASCII_WORD_CHAR.test(before) || ASCII_WORD_CHAR.test(after)) continue;
      }
      const entry = matcher.lookup.get(matched.toLowerCase());
      if (!entry?.iconUrl) continue;
      if (start > cursor) fragment.append(doc.createTextNode(text.slice(cursor, start)));
      fragment.append(createInlineEntitySpan(matched, entry, doc));
      cursor = end;
      changed = true;
      decoratedCount += 1;
    }
    if (!changed) continue;
    if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
  return decoratedCount;
}

async function seasonCatalogPool(seasonContextId) {
  if (!seasonContextId) return [];
  return Promise.all([
      catalogEntries(seasonContextId, "unit"),
      catalogEntries(seasonContextId, "item"),
      catalogEntries(seasonContextId, "trait")
    ]).then(([units, items, traits]) => [
      ...units.map((entry) => ({ ...entry, entityType: "unit" })),
      ...items.map((entry) => ({ ...entry, entityType: "item" })),
      ...traits.map((entry) => ({ ...entry, entityType: "trait" }))
    ]);
}

const pendingHydrations = new WeakMap();

export async function hydrateInlineEntityIcons({ target, data = null, seasonContextId = null } = {}) {
  if (!target || !seasonContextId) return 0;
  const pending = {};
  pendingHydrations.set(target, pending);
  const catalogPool = await seasonCatalogPool(seasonContextId);
  if (pendingHydrations.get(target) !== pending || target.isConnected === false) return 0;
  const scopedPool = collectScopedEntries(data);
  const matcher = buildInlineEntityMatcher(catalogPool, scopedPool);
  return decorateInlineEntityIcons(target, matcher);
}
