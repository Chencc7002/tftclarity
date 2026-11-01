import { MemorySemanticDocumentStore, normalizeSemanticDocument } from "../retrieval/semantic-document-store.js";
import { auditSemanticIndex, buildSemanticIndex } from "../retrieval/semantic-index-builder.js";

const owned = (document) => (document.documentType === "patch_note" && document.source === "riot_games")
  || (document.documentType === "static_game_knowledge" && document.source === "user_maintained_knowledge");
const identity = (document) => `${document.seasonContextId}\u0000${document.id}`;
const signature = (documents) => JSON.stringify(documents.map((d) => [identity(d), d.recordHash, d.embeddingModel,
  d.embedding]).sort((a, b) => a[0].localeCompare(b[0])));

export async function inspectStaticKnowledge(store, { seasonContextId, locale = "zh-CN", model, dimensions, documents = null }) {
  const rows = (await store.list({ seasonContextId, locale, includeGlobalLocale: false })).filter(owned);
  const missing = rows.filter((d) => !d.embedding?.length).length;
  const incompatible = rows.filter((d) => d.embedding?.length && (d.embeddingModel !== model
    || (dimensions && d.embedding.length !== dimensions)
    || d.embedding.some((v) => !Number.isFinite(v))
    || !d.embedding.some((v) => v !== 0))).length;
  const expected = documents?.map(normalizeSemanticDocument);
  const byId = new Map(rows.map((d) => [identity(d), d]));
  const expectedIds = new Set(expected?.map(identity));
  const stale = expected ? expected.filter((d) => byId.get(identity(d))?.recordHash !== d.recordHash).length
    + rows.filter((d) => !expectedIds.has(identity(d))).length : null;
  return { schemaVersion: "static_knowledge_health.v1", seasonContextId, locale, model,
    dimensions, documents: rows.length, missingEmbeddings: missing, incompatibleEmbeddings: incompatible,
    sourceMismatches: stale, healthy: rows.length > 0 && missing === 0 && incompatible === 0 && (stale === null || stale === 0),
    checkedAt: new Date().toISOString() };
}

// Prepare and audit without touching the active DB. Only the final, short SQLite
// transaction publishes content and vectors together. Other ingestion owners are untouched.
export async function publishStaticKnowledge({ store, provider, documents, seasonContextId,
  locale = "zh-CN", dimensions = 1024, batchSize = 4, shadow = false, onProgress = null, vectorCache = [] }) {
  if (!store.database?.exec) throw new TypeError("Static publication requires a SQLite store");
  if (!seasonContextId || !Number.isInteger(dimensions) || dimensions < 1) throw new Error("Explicit season and dimensions are required");
  const desired = documents.map(normalizeSemanticDocument);
  if (!desired.length || desired.some((d) => !owned(d) || d.seasonContextId !== seasonContextId || d.locale !== locale)) {
    throw new Error("Static release contains empty, foreign-owner or out-of-scope documents");
  }
  const readOwned = async () => (await store.list({ seasonContextId, locale, includeGlobalLocale: false })).filter(owned);
  const before = await readOwned();
  const desiredById = new Map(desired.map((d) => [identity(d), d]));
  const cached = vectorCache.map(normalizeSemanticDocument).filter((d) => {
    const expected = desiredById.get(identity(d));
    return expected && d.contentHash === expected.contentHash && d.content === expected.content
      && d.embeddingModel === provider?.model && d.embedding?.length === dimensions
      && d.embedding.every(Number.isFinite) && d.embedding.some((v) => v !== 0);
  });
  const candidate = new MemorySemanticDocumentStore(before.map((d) => d.embedding?.length === dimensions
    && d.embedding.every(Number.isFinite) && d.embedding.some((v) => v !== 0)
    ? d : { ...d, embedding: null, embeddingModel: null }));
  // A locally prepared candidate is only a vector cache; source text/metadata
  // still comes from the current release bundle and is audited again below.
  await candidate.upsert(cached);
  const build = await buildSemanticIndex({ store: candidate, provider, documents: desired,
    batchSize, prune: false, requireEmbeddings: true, onProgress });
  const ids = new Set(desired.map(identity));
  const prepared = (await candidate.list({ seasonContextId, locale })).filter((d) => ids.has(identity(d)))
    .map((d) => ({ ...d, embedding: d.embedding ? Array.from(new Float32Array(d.embedding)) : null }));
  const audit = await auditSemanticIndex(new MemorySemanticDocumentStore(prepared), { embeddingModel: provider.model });
  for (const d of prepared) {
    if (d.embedding?.length !== dimensions) audit.issues.push({ code: "unexpected_dimensions", documentId: d.id });
    if (!d.embedding?.some((v) => v !== 0)) audit.issues.push({ code: "zero_vector", documentId: d.id });
  }
  audit.healthy = audit.issues.length === 0 && prepared.length === desired.length;
  if (!audit.healthy) throw Object.assign(new Error("Static knowledge candidate failed audit; active index unchanged"), { audit });
  const removedIds = before.filter((d) => !ids.has(identity(d))).map((d) => d.id);
  const report = { schemaVersion: "static_knowledge_release.v1", seasonContextId, locale,
    shadow, published: false, cachedVectorsReused: cached.length, build, audit, removed: removedIds.length };
  if (shadow) return report;
  store.database.exec("BEGIN IMMEDIATE");
  try {
    if (signature(await readOwned()) !== signature(before)) throw new Error("Static index changed during build; retry publication");
    await store.upsert(prepared);
    await store.remove(removedIds, { seasonContextId });
    store.setMeta(`staticRelease:${seasonContextId}:${locale}`, JSON.stringify({ model: provider.model, dimensions,
      documents: prepared.length, publishedAt: new Date().toISOString() }));
    store.database.exec("COMMIT");
    report.published = true;
  } catch (error) {
    store.database.exec("ROLLBACK");
    throw error;
  }
  return report;
}
