export const QUICK_TOOL_STORAGE_KEY = "tftagent.quickTools.v1";
const DAY = 86_400_000;

function dayKey(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recentDays(now) {
  return new Set(Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    return dayKey(date);
  }));
}

export function normalizeToolPreferences(value, ids, now = Date.now()) {
  const allowed = new Set(ids);
  const days = recentDays(now);
  const validTime = (time) => Number.isFinite(time) && time >= 0 ? time : 0;
  const tools = Object.fromEntries(ids.map((id) => {
    const record = value?.tools?.[id];
    return [id, {
      days: Object.fromEntries(Object.entries(record?.days ?? {}).filter(([day, count]) =>
        days.has(day) && Number.isSafeInteger(count) && count > 0).map(([day, count]) => [day, Math.min(count, 1000)])),
      snoozeUntil: validTime(record?.snoozeUntil),
      muted: record?.muted === true
    }];
  }));
  return {
    version: 1,
    recommendationsHidden: value?.recommendationsHidden === true,
    favorites: [...new Set(Array.isArray(value?.favorites) ? value.favorites.filter(id => allowed.has(id)) : [])],
    lastPromptAt: validTime(value?.lastPromptAt),
    tools
  };
}

// Local tool IDs and daily counters only; never store query text or model context.
export function createToolPreferences({ ids, storage, now = Date.now }) {
  let current;
  let persistent = true;
  const read = () => {
    try {
      if (persistent) {
        const target = storage();
        if (!target) throw new Error("storage unavailable");
        const raw = target.getItem(QUICK_TOOL_STORAGE_KEY);
        current = raw ? JSON.parse(raw) : undefined;
      }
    } catch { persistent = false; }
    current = normalizeToolPreferences(current, ids, now());
    return current;
  };
  const save = () => {
    try {
      const target = storage();
      if (!target) throw new Error("storage unavailable");
      target.setItem(QUICK_TOOL_STORAGE_KEY, JSON.stringify(current));
      persistent = true;
    } catch { persistent = false; }
    return { ...current, persistent };
  };
  return {
    snapshot: () => ({ ...read(), persistent }),
    setRecommendationsHidden(hidden) {
      read();
      current.recommendationsHidden = hidden === true;
      return save();
    },
    toggleFavorite(id) {
      read();
      if (!ids.includes(id)) return { ...current, persistent };
      current.favorites = current.favorites.includes(id)
        ? current.favorites.filter(value => value !== id) : [...current.favorites, id];
      // Removing a favorite is an explicit choice: don't immediately suggest it again.
      current.tools[id].snoozeUntil = now() + 7 * DAY;
      return save();
    },
    recordUse(id) {
      read();
      if (!ids.includes(id)) return null;
      const record = current.tools[id];
      const today = dayKey(now());
      record.days[today] = Math.min((record.days[today] ?? 0) + 1, 1000);
      save();
      return id;
    },
    claimReminder(id) {
      read();
      const record = current.tools[id];
      if (!record || current.favorites.includes(id) || record.muted || record.snoozeUntil > now()) return false;
      if (current.lastPromptAt && now() - current.lastPromptAt < DAY) return false;
      if (Object.keys(record.days).length < 2 || Object.values(record.days).reduce((sum, count) => sum + count, 0) < 3) return false;
      current.lastPromptAt = now();
      save();
      return true;
    },
    dismissReminder(id, permanently = false) {
      read();
      if (!current.tools[id]) return;
      if (permanently) current.tools[id].muted = true;
      else current.tools[id].snoozeUntil = now() + 7 * DAY;
      save();
    }
  };
}

export function recommendQuickTools(tasks, preferences, { random = Math.random, previous = [], limit = 4 } = {}) {
  const shuffle = (rows) => {
    const result = [...rows];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const unique = [...new Map(tasks.filter(task => task.query || task.queryKey || task.view || task.formFields).map(task => [task.id, task])).values()];
  const fresh = unique.filter(task => !previous.includes(task.id));
  const pool = fresh.length >= limit ? fresh : unique;
  const preferred = pool.filter(task => preferences.favorites.includes(task.id)
    || Object.values(preferences.tools[task.id]?.days ?? {}).reduce((sum, count) => sum + count, 0) >= 3);
  const first = shuffle(preferred).slice(0, 1);
  return [...first, ...shuffle(pool.filter(task => !first.includes(task)))].slice(0, limit).map(task => task.id);
}
