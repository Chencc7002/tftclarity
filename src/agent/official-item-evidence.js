export const OFFICIAL_ITEM_RETRIEVAL_VERSION = "official-item-retrieval.v1";
export const OFFICIAL_ITEM_MAX_AGE_MS = 30 * 60 * 1000;

export function currentOfficialItemRetrieval(receipt, now = Date.now(), maxAgeMs = OFFICIAL_ITEM_MAX_AGE_MS) {
  const fetched = Date.parse(receipt?.fetchedAt);
  return receipt?.schemaVersion === OFFICIAL_ITEM_RETRIEVAL_VERSION
    && receipt.transport === "http_success"
    && /^https:\/\//u.test(receipt.sourceId ?? "")
    && /^[a-f0-9]{64}$/u.test(receipt.contentHash ?? "")
    && Number.isFinite(fetched) && fetched <= now && now - fetched < maxAgeMs;
}

// A current official catalog's publication date is not its retrieval age.
// Only the network loader creates this receipt; reading a cached Map or adding
// an entry to the Ledger must not refresh it. Original source clocks stay intact.
export function officialItemEvidenceFailure(entry, { now = Date.now(), maxAgeMs = OFFICIAL_ITEM_MAX_AGE_MS,
  seasonContextId } = {}) {
  const value = entry?.value, metadata = entry?.metadata ?? {};
  if ([entry?.temporalStatus, metadata.temporalStatus].includes("historical")) return "historical_evidence";
  if ([metadata.freshnessStatus, metadata.freshness?.status].some(s => ["stale", "expired"].includes(s))
    || metadata.stale || metadata.cache?.stale || value?.cache?.stale) return "stale_evidence";
  const receipt = value?.source?.retrieval;
  if (!currentOfficialItemRetrieval(receipt, now, maxAgeMs)) return "official_item_retrieval_unverified_or_expired";
  if (entry.toolName !== "item_details" || entry.source !== "official_catalog"
    || value?.schemaVersion !== "official-entity-detail.v1" || value.entityType !== "item"
    || value.type !== "item_details" || value.source?.sourceType !== "official_tft_catalog"
    || value.source.sourceId !== receipt.sourceId || !value.apiName || value.entityRef?.apiName !== value.apiName) return "invalid_official_item_identity";
  const season = /^set(\d+)-live$/u.exec(seasonContextId ?? value.scope?.seasonContextId ?? "")?.[1];
  // Both forms are emitted by the official equipment catalog (including the
  // observed 2026.S18 payload); no substring or inferred set-number match.
  const catalogSeason = /^(?:TFT|20\d{2}\.S)(\d+)$/u.exec(receipt.catalogSeason ?? "")?.[1];
  if (!season || catalogSeason !== season || value.scope?.seasonContextId !== `set${season}-live`) return "official_item_season_unverified";
  const published = value.source.updatedAt;
  if (published !== receipt.publishedAt || value.updatedAt !== published || entry.updatedAt !== published
    || (metadata.updatedAt != null && metadata.updatedAt !== published)
    || (published != null && (!Number.isFinite(Date.parse(published)) || Date.parse(published) > Date.parse(receipt.fetchedAt)))) return "official_item_source_clock_mismatch";
  const expiry = value.cache?.expiresAt ?? metadata.cache?.expiresAt;
  if (expiry != null && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now)) return "stale_evidence";
  return null;
}

export function officialItemBatchEvidenceFailure(entry, options = {}) {
  const value = entry?.value;
  const apiNames = value?.selection?.apiNames;
  const items = value?.items;
  if (entry?.toolName !== "item_details_batch" || entry?.source !== "official_catalog"
    || value?.schemaVersion !== "official-item-detail-batch.v1" || value?.type !== "item_details_batch"
    || !Array.isArray(apiNames) || apiNames.length < 1 || apiNames.length > 4
    || !Array.isArray(items) || items.length !== apiNames.length
    || new Set(apiNames).size !== apiNames.length
    || items.some((item, index) => item?.apiName !== apiNames[index])) return "invalid_official_item_batch_identity";
  for (const item of items) {
    const reason = officialItemEvidenceFailure({
      ...entry,
      toolName: "item_details",
      value: item,
      updatedAt: item.updatedAt,
      metadata: { ...(entry.metadata ?? {}), updatedAt: item.updatedAt }
    }, options);
    if (reason) return reason;
  }
  return null;
}
