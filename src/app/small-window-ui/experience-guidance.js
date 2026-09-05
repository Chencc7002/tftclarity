export const GUIDANCE_STORAGE_KEY = "tftagent.experienceGuidance.v1";
const DAY = 86_400_000;
const EVENTS = new Set(["shown", "accepted", "later", "never", "completed"]);
const FAMILIES = new Set(["voice", "favorite", "followup"]);

// A presentation coordinator only: candidates cannot query data or execute tools.
// Persist bounded counters and preferences, never input text, answers, or action payloads.
export function createExperienceGuidance({ storage, now = Date.now, blocked = () => false,
  onEvent = () => {}, mode = "active" } = {}) {
  let state = { version: 1, enabled: true, lastShownAt: 0, records: {}, counts: {} };
  let active = null;
  let persistent = true;
  const pending = new Map();
  const seenContextual = new Set();
  const validId = id => typeof id === "string" && /^(voice|favorite:[a-z0-9-]{1,80})$/.test(id);
  function read() {
    if (!persistent) return;
    try {
      const raw = storage?.()?.getItem(GUIDANCE_STORAGE_KEY);
      if (!raw) return;
      const value = JSON.parse(raw);
      if (value.version !== 1) return;
      const records = {};
      for (const [id, record] of Object.entries(value.records ?? {}).slice(0, 200)) {
        if (!validId(id) || !record || typeof record !== "object") continue;
        records[id] = {
          muted: record.muted === true, completed: record.completed === true,
          until: Number.isFinite(record.until) ? Math.max(0, record.until) : 0
        };
      }
      const counts = {};
      for (const family of FAMILIES) {
        counts[family] = {};
        for (const event of EVENTS) {
          const count = value.counts?.[family]?.[event];
          counts[family][event] = Number.isSafeInteger(count) ? Math.max(0, Math.min(1000000, count)) : 0;
        }
      }
      state = { version: 1, enabled: value.enabled !== false,
        lastShownAt: Number.isFinite(value.lastShownAt) ? Math.max(0, value.lastShownAt) : 0, records, counts };
    } catch { persistent = false; }
  }
  function save() {
    if (!persistent) return;
    try { storage?.()?.setItem(GUIDANCE_STORAGE_KEY, JSON.stringify(state)); } catch { persistent = false; }
  }
  function record(family, event) {
    if (!FAMILIES.has(family) || !EVENTS.has(event)) return;
    state.counts[family] ??= {};
    state.counts[family][event] = Math.min(1000000, (state.counts[family][event] ?? 0) + 1);
    save();
    try { onEvent({ family, event }); } catch { /* Observability must not affect UI. */ }
  }
  function hide() {
    const previous = active;
    active = null;
    previous?.hide();
  }
  function refresh() {
    read();
    if (active && (!state.enabled || blocked() || state.records[active.id]?.muted
      || state.records[active.id]?.completed || now() >= active.expiresAt || !active.eligible())) hide();
    if (active || !state.enabled || blocked()) return;
    const candidates = [...pending.values()].sort((a, b) => b.priority - a.priority);
    for (const candidate of candidates) {
      const pref = state.records[candidate.id];
      if (now() >= candidate.expiresAt || pref?.muted || pref?.completed || pref?.until > now()) {
        pending.delete(candidate.id);
        continue;
      }
      if (!candidate.eligible()) continue;
      // Shared interruption budget, independent of persistent answer navigation.
      if (state.lastShownAt && now() - state.lastShownAt < 30 * 60_000) return;
      pending.delete(candidate.id);
      if (mode !== "active") {
        try { onEvent({ family: candidate.family, event: "shadow_candidate" }); } catch {}
        continue;
      }
      if (candidate.show() === false) continue;
      active = candidate;
      state.lastShownAt = now();
      state.records[candidate.id] = { ...pref, until: now() + DAY };
      record(candidate.family, "shown");
      break;
    }
  }
  read();
  return {
    offer(candidate) {
      if (!validId(candidate.id) || !FAMILIES.has(candidate.family) || candidate.family === "followup") return;
      pending.set(candidate.id, { priority: 0, expiresAt: now() + 120_000, ...candidate });
      // Batch simultaneous offers so the highest priority wins.
      queueMicrotask(refresh);
    },
    cancel(id) {
      pending.delete(id);
      if (active?.id === id) hide();
    },
    respond(id, event) {
      if (active?.id !== id || !["accepted", "later", "never"].includes(event)) return;
      read();
      const family = active.family;
      state.records[id] = { ...state.records[id],
        ...(event === "never" ? { muted: true } : {}), until: now() + 7 * DAY };
      hide();
      record(family, event);
    },
    complete(id, family) {
      if (!validId(id) || !FAMILIES.has(family)) return;
      read();
      if (state.records[id]?.completed) return;
      // Favorites can be removed and suggested later by their domain policy.
      state.records[id] = { ...state.records[id], completed: family === "voice", until: now() + 7 * DAY };
      pending.delete(id);
      if (active?.id === id) hide();
      record(family, "completed");
    },
    contextual(event, key) {
      if (!["shown", "accepted"].includes(event) || typeof key !== "string") return;
      const identity = `${event}:${key}`;
      if (seenContextual.has(identity)) return;
      if (seenContextual.size >= 500) seenContextual.delete(seenContextual.values().next().value);
      seenContextual.add(identity);
      read();
      record("followup", event);
    },
    setEnabled(enabled) {
      read(); state.enabled = enabled === true; save();
      if (!state.enabled) { pending.clear(); hide(); }
    },
    refresh,
    snapshot() { read(); return structuredClone(state); },
    get activeId() { return active?.id ?? null; }
  };
}

export const VOICE_HINT_THRESHOLD = 20;
export const VOICE_HINT_IDLE_MS = 2000;

// Count native manual edits, including IME edits. Paste, drop, autofill and synthetic
// transcript events reset eligibility; text content is never persisted.
export function createManualInputTracker() {
  let previousLength = 0;
  let previousValue = "";
  let manualLength = 0;
  function reset(value = "") {
    previousValue = String(value);
    previousLength = [...previousValue.trim()].length;
    manualLength = 0;
  }
  return {
    beforeEdit(value) { if (String(value) !== previousValue) reset(value); },
    edit({ value, isTrusted, inputType = "" }) {
      const length = [...String(value).trim()].length;
      const manual = isTrusted && /^(insertText|insertCompositionText|insertFromComposition|deleteContentBackward|deleteContentForward|deleteCompositionText)$/.test(inputType);
      manualLength = manual ? Math.max(0, manualLength + length - previousLength) : 0;
      previousLength = length;
      previousValue = String(value);
      return manual && length > VOICE_HINT_THRESHOLD && manualLength > VOICE_HINT_THRESHOLD;
    },
    reset
  };
}
