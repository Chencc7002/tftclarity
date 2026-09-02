// Conservative presentation fallback only. This never authorizes model finish,
// adds Evidence, refreshes source clocks, or turns historical data into current.
export function currentDeadlineEvidence(entries, now, seasonContextId, options = {}) {
  const time = (value) => typeof value === "number" ? value : Date.parse(value);
  const sourceClockSkewMs = Number.isFinite(options.sourceClockSkewMs)
    ? Math.max(0, options.sourceClockSkewMs) : 0;
  return entries.filter((entry) => {
    const value = entry.value ?? {}, metadata = entry.metadata ?? {};
    if (!entry.validatedAt || [entry.temporalStatus, metadata.temporalStatus,
      metadata.freshnessStatus, metadata.freshness?.status].some((s) => ["historical", "stale", "expired"].includes(s))
      || metadata.stale || metadata.cache?.stale || value.cache?.stale) return false;
    const seasons = [value.seasonContextId, value.query?.seasonContextId, value.scope?.seasonContextId].filter(Boolean);
    if (seasons.some((id) => id !== seasonContextId)) return false;
    const stamps = [entry.updatedAt, metadata.updatedAt, value.updatedAt, value.source?.updatedAt,
      value.formation?.source?.updatedAt].filter((stamp) => stamp != null);
    if (!stamps.length || stamps.some((stamp) => !Number.isFinite(time(stamp)) || time(stamp) > now + sourceClockSkewMs
      || now - time(stamp) > (value.formation ? 5 : 30) * 60 * 1000)) return false;
    const expiresAt = value.cache?.expiresAt ?? metadata.cache?.expiresAt;
    return expiresAt == null || (Number.isFinite(time(expiresAt)) && time(expiresAt) > now);
  });
}
