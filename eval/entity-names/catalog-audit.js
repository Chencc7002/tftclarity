import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pinyin } from "pinyin-pro";
import { queryEntityCatalog } from "../../src/domain/tft/entity-catalog-query.js";
import { normalizeAlias } from "../../src/core/normalizer.js";

const TYPES = { unit: "units", item: "items", trait: "traits" };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const FIELDS = ["apiName", "filterId", "canonicalApiName", "zhName", "enName", "name", "displayName", "preferredDisplayName",
  "shortName", "aliases", "fuzzyAliases", "current", "obtainable", "cost", "category", "traits", "traitNames", "patch"];

// Import only entity metadata. Never copy query text, identities, credentials or raw provider payloads into a snapshot.
export function snapshotFromCache(cache, seasonContextId) {
  if (!seasonContextId) throw new TypeError("seasonContextId is required");
  const scoped = field => Object.values(cache[field] ?? {}).filter(entry => entry?.value?.seasonContextId === seasonContextId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const domain = scoped("domainCatalogs"), items = scoped("itemCatalogs");
  if (!domain || !items) throw new TypeError("No matching season domain and item catalogs; cross-season fallback forbidden");
  const project = rows => {
    if (!Array.isArray(rows) || !rows.length) throw new TypeError("Catalog section is missing or empty");
    return rows.map(row => Object.fromEntries(FIELDS.filter(field => row[field] !== undefined).map(field => [field, structuredClone(row[field])])));
  };
  const catalog = { units: project(domain.value.units), traits: project(domain.value.traits), items: project(items.value.items) };
  return { schemaVersion: "entity-name-catalog-snapshot.v1", seasonContextId,
    domainUpdatedAt: domain.updatedAt ?? null, itemsUpdatedAt: items.updatedAt ?? null,
    patch: domain.value.patch ?? null, catalogHash: hash(catalog), catalog,
    provenance: "persisted_catalog_snapshot", freshness: "historical_not_verified_current" };
}

export function validateSnapshot(snapshot) {
  if (snapshot.schemaVersion !== "entity-name-catalog-snapshot.v1" || !snapshot.seasonContextId
    || hash(snapshot.catalog) !== snapshot.catalogHash) throw new TypeError("Invalid snapshot or catalog hash mismatch");
  for (const field of Object.values(TYPES)) if (!Array.isArray(snapshot.catalog[field]) || !snapshot.catalog[field].length) {
    throw new TypeError(`Missing catalog section: ${field}`);
  }
}

function aliases(row) {
  return [...new Set([row.zhName, row.name, row.shortName, row.preferredDisplayName, row.displayName, ...(row.aliases ?? [])]
    .filter(value => typeof value === "string").map(normalizeAlias).filter(value => /^\p{Script=Han}{2,12}$/u.test(value)))];
}
const idFor = (row, type) => type === "trait" ? String(row.apiName).replace(/_\d+$/u, "") : row.apiName;

export function generateCatalogStressCases(catalog) {
  const sounds = new Map();
  for (const field of Object.values(TYPES)) for (const row of catalog[field]) for (const name of aliases(row)) {
    for (const char of name) {
      const sound = pinyin(char, { toneType: "none" });
      if (!sounds.has(sound)) sounds.set(sound, new Set());
      sounds.get(sound).add(char);
    }
  }
  const cases = new Map();
  for (const [type, field] of Object.entries(TYPES)) for (const row of catalog[field]) {
    if (row.current === false) continue;
    for (const name of aliases(row)) {
      const middle = Math.floor(name.length / 2);
      const variants = [
        ["deletion", name.slice(0, middle) + name.slice(middle + 1)],
        ["insertion", name.slice(0, middle) + name[middle] + name.slice(middle)],
        ["transposition", name[1] + name[0] + name.slice(2)]
      ];
      const replacement = [...(sounds.get(pinyin(name[middle], { toneType: "none" })) ?? [])].sort().find(char => char !== name[middle]);
      if (replacement) variants.push(["homophone", name.slice(0, middle) + replacement + name.slice(middle + 1)]);
      for (const [group, inputName] of variants) {
        if (inputName === name) continue;
        const key = `${type}:${group}:${inputName}`;
        const entry = cases.get(key) ?? { origin: "generated_stress", type, group, inputName, expectedIds: [] };
        entry.expectedIds = [...new Set([...entry.expectedIds, idFor(row, type)])].sort();
        cases.set(key, entry);
      }
    }
  }
  return [...cases.values()];
}

// Replays retain the tool's original extracted name, not a guessed entity span from the whole sentence.
// Historical tool output is NOT a correctness label. Local QA and production exports stay distinct.
export function extractObservedNames(cache, seasonContextId, sourceKind = "local_qa") {
  if (!["local_qa", "production_export"].includes(sourceKind)) throw new TypeError("Invalid source kind");
  const names = new Map();
  let queryCount = 0, noCatalogEvidence = 0, unresolvedOccurrences = 0;
  for (const query of Object.values(cache.queryEvents ?? {})) {
    if (query.seasonContextId !== seasonContextId) continue;
    queryCount += 1;
    let found = false;
    for (const evidence of query.response?.evidence ?? []) {
      if (evidence.toolName !== "entity_catalog_query" || !TYPES[evidence.value?.entityType]) continue;
      for (const request of evidence.value.resolution?.requests ?? []) {
        if (typeof request.inputName !== "string" || request.inputName.length > 80) continue;
        found = true;
        if (request.status !== "resolved") unresolvedOccurrences += 1;
        const type = evidence.value.entityType;
        const key = `${type}:${request.inputName}`;
        const entry = names.get(key) ?? { origin: sourceKind, type, inputName: request.inputName,
          expectedIds: null, labelStatus: "unreviewed", occurrences: 0, historicalStatuses: [] };
        entry.occurrences += 1;
        entry.historicalStatuses = [...new Set([...entry.historicalStatuses, request.status])];
        names.set(key, entry);
      }
    }
    if (!found) noCatalogEvidence += 1;
  }
  return { queryCount, noCatalogEvidence, unresolvedOccurrences, cases: [...names.values()] };
}

export function runCatalogAudit(snapshot, cases) {
  validateSnapshot(snapshot);
  const rows = [];
  for (const entry of cases) {
    if (!TYPES[entry.type] || typeof entry.inputName !== "string" || !entry.inputName.trim() || entry.inputName.length > 80
      || !["generated_stress", "local_qa", "production_export"].includes(entry.origin)) {
      throw new TypeError("Invalid audit case");
    }
    if (entry.origin === "generated_stress") {
      const validIds = new Set(snapshot.catalog[TYPES[entry.type]].map(row => idFor(row, entry.type)));
      if (!Array.isArray(entry.expectedIds) || !entry.expectedIds.length || entry.expectedIds.some(id => !validIds.has(id))) {
        throw new TypeError("Stress labels must refer to entities in the frozen catalog");
      }
    }
    const args = { catalog: snapshot.catalog, input: { entityType: entry.type, filters: { names: [entry.inputName] } },
      updatedAt: snapshot.domainUpdatedAt ?? "snapshot" };
    const observations = [];
    const legacy = queryEntityCatalog(args);
    const shadow = queryEntityCatalog({ ...args, nameResolution: { mode: "shadow", seasonContextId: snapshot.seasonContextId,
      onObservation: event => observations.push(event) } });
    const suggested = queryEntityCatalog({ ...args, nameResolution: { mode: "suggest" } });
    const before = legacy.resolution.requests[0], after = suggested.resolution.requests[0];
    const ids = after.candidates.map(candidate => candidate.apiName);
    const generated = entry.origin === "generated_stress";
    // A mutation may spell a different valid name. Report that collision, not a false correction.
    const evaluable = generated && before.status === "not_found" && entry.inputName.length >= 2;
    const auto = observations[0]?.autoAcceptEligible === true;
    rows.push({ ...entry, legacyStatus: before.status, status: after.status, candidates: after.candidates,
      shadowEquivalent: isDeepStrictEqual(legacy, shadow), exactPreserved: before.status === "not_found" || isDeepStrictEqual(legacy, suggested),
      evaluable, top1Correct: evaluable ? entry.expectedIds.includes(ids[0]) : null,
      expectedInTop5: evaluable ? entry.expectedIds.every(id => ids.includes(id)) : null,
      autoAcceptEligible: auto, autoHypothesisWrong: evaluable && auto ? !entry.expectedIds.includes(ids[0]) : null,
      generatedNameCollision: generated && before.status !== "not_found",
      durationMs: observations[0]?.durationMs ?? null });
  }
  const stress = rows.filter(row => row.evaluable);
  const observed = rows.filter(row => row.origin !== "generated_stress");
  const durations = rows.map(row => row.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const invariantsPass = rows.every(row => row.shadowEquivalent && row.exactPreserved)
    && rows.every(row => row.legacyStatus !== "not_found" || row.status !== "resolved");
  const byGroup = Object.fromEntries([...new Set(stress.map(row => row.group))].sort().map(group => {
    const values = stress.filter(row => row.group === group);
    return [group, { total: values.length, top1Correct: values.filter(row => row.top1Correct).length,
      allExpectedInTop5: values.filter(row => row.expectedInTop5).length }];
  }));
  return { schemaVersion: "entity-name-catalog-audit.v1", catalogHash: snapshot.catalogHash,
    seasonContextId: snapshot.seasonContextId, freshness: snapshot.freshness,
    catalogCounts: Object.fromEntries(Object.values(TYPES).map(field => [field, snapshot.catalog[field].length])),
    total: rows.length, invariantsPass,
    generatedStress: { count: rows.length - observed.length, evaluable: stress.length,
      exactCollisionsExcluded: rows.filter(row => row.generatedNameCollision).length,
      top1Correct: stress.filter(row => row.top1Correct).length, allExpectedInTop5: stress.filter(row => row.expectedInTop5).length,
      autoHypotheses: stress.filter(row => row.autoAcceptEligible).length,
      autoHypothesisWrong: stress.filter(row => row.autoHypothesisWrong).length, byGroup },
    observed: { count: observed.length, labeledCount: 0, accuracy: null,
      previouslyUnresolved: observed.filter(row => row.legacyStatus === "not_found").length,
      newCandidates: observed.filter(row => row.legacyStatus === "not_found" && row.status === "ambiguous").length },
    latencyMs: { samples: durations.length, p50: durations[Math.floor(durations.length * 0.5)] ?? null,
      p95: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? null, max: durations.at(-1) ?? null },
    automaticCorrectionEnabled: false, productionAccuracy: null,
    releaseGate: "hold_requires_current_catalog_and_independent_labeled_user_samples",
    rows };
}
