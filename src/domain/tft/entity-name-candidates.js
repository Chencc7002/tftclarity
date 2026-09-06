import { createHash } from "node:crypto";
import { pinyin, polyphonic } from "pinyin-pro";
import { normalizeAlias } from "../../core/normalizer.js";

export const ENTITY_NAME_CANDIDATES_VERSION = "entity-name-candidates.v1";
const INDEX_CACHE = new WeakMap();
const MAX_NAME_LENGTH = 32;
const MAX_CANDIDATES = 5;

export function normalizeEntityNameResolutionMode(value) {
  const mode = String(value ?? "off").trim().toLowerCase();
  return ["shadow", "suggest"].includes(mode) ? mode : "off";
}

export function createEntityNameResolutionTelemetry(observer) {
  const counters = { completed: 0, failed: 0, withCandidates: 0, autoAcceptEligible: 0, totalDurationMs: 0 };
  return {
    snapshot: () => ({ ...counters }),
    record(event) {
      if (event.status === "completed") counters.completed += 1;
      if (event.status === "failed") counters.failed += 1;
      if (event.candidateCount > 0) counters.withCandidates += 1;
      if (event.autoAcceptEligible) counters.autoAcceptEligible += 1;
      if (Number.isFinite(event.durationMs)) counters.totalDurationMs += event.durationMs;
      observe(observer, event);
    }
  };
}

function nameKey(value) {
  // Preserve ID syntax before normalization strips separators. Official IDs still
  // work in the existing exact path, but misspelled IDs must never be repaired.
  if (/[_\d]/u.test(String(value ?? ""))) return null;
  const key = normalizeAlias(value);
  // Callers supply an extracted name, not the full user question.
  return key.length >= 2 && key.length <= MAX_NAME_LENGTH
    && (/^\p{Script=Han}+$/u.test(key) || /^[a-zü]{4,}$/u.test(key)) ? key : null;
}

function pronunciation(key) {
  if (!/^\p{Script=Han}+$/u.test(key)) return null;
  return {
    primary: pinyin(key, { toneType: "none", type: "array" }),
    alternatives: polyphonic(key, { toneType: "none", type: "array" })
  };
}

// Optimal string alignment handles insertions, deletions, replacements and adjacent swaps.
function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

function nearSound(value) {
  return value.replace(/^(zh|ch|sh)/u, (initial) => initial[0]).replace(/ng$/u, "n");
}

function scoreName(key, sounds, alias) {
  const distance = editDistance(key, alias.key);
  if (key === alias.key) return { matchType: "normalized_name", score: 1, editDistance: 0 };
  if (/^[a-zü]+$/u.test(key) && alias.sounds?.primary.join("") === key) {
    return { matchType: "pinyin_input", score: 0.95, editDistance: distance };
  }
  if (sounds && alias.sounds && sounds.primary.length === alias.sounds.primary.length) {
    if (sounds.primary.every((sound, i) => sound === alias.sounds.primary[i])) {
      return { matchType: "pinyin_exact", score: 0.96, editDistance: distance };
    }
    if (sounds.alternatives.every((values, i) => values.some(sound => alias.sounds.alternatives[i].includes(sound)))) {
      return { matchType: "pinyin_polyphonic", score: 0.92, editDistance: distance };
    }
    const differences = sounds.primary.filter((sound, i) => sound !== alias.sounds.primary[i]).length;
    if (differences === 1 && sounds.primary.every((sound, i) => nearSound(sound) === nearSound(alias.sounds.primary[i]))) {
      return { matchType: "pinyin_near", score: 0.84, editDistance: distance };
    }
  }
  // Short Chinese names still produce candidates; they never gain automatic authority.
  if (distance === 1 && /^\p{Script=Han}+$/u.test(key) && /^\p{Script=Han}+$/u.test(alias.key)) {
    return { matchType: "character_edit", score: Math.min(0.88, 0.7 + Math.min(key.length, alias.key.length) * 0.03), editDistance: distance };
  }
  if (distance === 1 && /^[a-zü]{4,}$/u.test(key) && /^[a-zü]{4,}$/u.test(alias.key)) {
    return { matchType: "latin_edit", score: 0.85, editDistance: distance };
  }
  return null;
}

function indexFor(catalog, entityType, entries) {
  // Catalogs can be mutated by alias overlays. Identity-only caching would retain stale aliases.
  const signature = JSON.stringify(entries);
  let cache = INDEX_CACHE.get(catalog);
  if (!cache) { cache = new Map(); INDEX_CACHE.set(catalog, cache); }
  if (cache.get(entityType)?.signature === signature) return cache.get(entityType).aliases;
  const aliases = entries.flatMap(entry => [...new Set(entry.aliases)].flatMap(value => {
    const key = nameKey(value);
    return key ? [{ apiName: entry.apiName, name: entry.name, alias: value, key, sounds: pronunciation(key) }] : [];
  }));
  cache.set(entityType, { signature, aliases });
  return aliases;
}

export function retrieveEntityNameCandidates({ catalog, entityType, entries, inputName }) {
  const key = nameKey(inputName);
  if (!key) return { candidates: [], candidateCount: 0, autoAcceptEligible: false, reasonCode: "ineligible_name" };
  const sounds = pronunciation(key);
  const byId = new Map();
  for (const alias of indexFor(catalog, entityType, entries)) {
    const score = scoreName(key, sounds, alias);
    if (!score) continue;
    const candidate = { apiName: alias.apiName, name: alias.name, matchedAlias: alias.alias, ...score };
    const previous = byId.get(candidate.apiName);
    if (!previous || candidate.score > previous.score
      || (candidate.score === previous.score && candidate.matchedAlias.localeCompare(previous.matchedAlias) < 0)) {
      byId.set(candidate.apiName, candidate);
    }
  }
  const all = [...byId.values()].sort((a, b) => b.score - a.score || a.apiName.localeCompare(b.apiName));
  const top = all[0];
  // This is a shadow hypothesis, NOT a calibrated probability or an execution decision.
  const autoAcceptEligible = key.length >= 3 && top?.matchType === "pinyin_exact"
    && top.editDistance === 1 && (!all[1] || top.score - all[1].score >= 0.08);
  return {
    candidates: all.slice(0, MAX_CANDIDATES),
    candidateCount: all.length,
    autoAcceptEligible: Boolean(autoAcceptEligible),
    reasonCode: !top ? "no_candidate" : autoAcceptEligible ? "shadow_unique_phonetic_match" : "confirmation_required"
  };
}

function observe(observer, event) {
  if (typeof observer !== "function") return;
  try { Promise.resolve(observer(event)).catch(() => {}); } catch { /* Telemetry cannot change a tool result. */ }
}

export function applyEntityNameCandidates({ catalog, entityType, entries, resolution, options = {} }) {
  const mode = normalizeEntityNameResolutionMode(options.mode);
  if (mode === "off") return resolution;
  let changed = false;
  const requests = resolution.requests.map(request => {
    if (request.status !== "not_found") return request;
    const started = performance.now();
    const event = {
      schemaVersion: ENTITY_NAME_CANDIDATES_VERSION,
      mode,
      entityType,
      seasonContextId: options.seasonContextId ?? null,
      // No raw user text, entity IDs or candidate names in operational telemetry.
      catalogFingerprint: createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16),
      legacyStatus: request.status,
      llmCallsAdded: 0
    };
    try {
      const result = retrieveEntityNameCandidates({ catalog, entityType, entries, inputName: request.inputName });
      observe(options.onObservation, { ...event, status: "completed", candidateCount: result.candidateCount,
        matchTypes: [...new Set(result.candidates.map(candidate => candidate.matchType))],
        autoAcceptEligible: result.autoAcceptEligible, reasonCode: result.reasonCode,
        durationMs: performance.now() - started });
      if (mode !== "suggest" || result.candidates.length === 0) return request;
      changed = true;
      return { ...request, status: "ambiguous", candidates: result.candidates,
        candidateCount: result.candidateCount, candidatesTruncated: result.candidateCount > result.candidates.length };
    } catch {
      observe(options.onObservation, { ...event, status: "failed", reasonCode: "candidate_generation_failed",
        durationMs: performance.now() - started });
      return request;
    }
  });
  return changed ? { mode: "name_candidates", requests } : resolution;
}
