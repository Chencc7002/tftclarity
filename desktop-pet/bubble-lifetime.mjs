export function readingDuration(text) {
  const length = Array.from(String(text).replace(/\s/g, '')).length;
  return Math.min(15000, Math.max(4000, 2500 + length * 130));
}
export function createBubbleLifetime({ now = Date.now } = {}) {
  const deadlines = new Map();
  return {
    visible(text, key, persistent = false) {
      const id = `${key}\n${text}`;
      if (!deadlines.has(id)) {
        deadlines.set(id, now() + readingDuration(text));
        if (deadlines.size > 100) deadlines.delete(deadlines.keys().next().value);
      }
      return Boolean(text) && (persistent || now() < deadlines.get(id));
    }
  };
}
