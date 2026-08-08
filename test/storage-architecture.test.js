import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CapabilityProviderRouter,
  MemoryCacheStore,
  MetaTftLiveProvider,
  RedisStore,
  asAsyncStore,
  createRepositoryViews,
  resolveStorageConfig,
  serializeConclusionPayload
} from "../src/index.js";

test("storage configuration fails closed for invalid production topology", () => {
  assert.throws(() => resolveStorageConfig({}, {
    NODE_ENV: "production",
    TFT_AGENT_PERSISTENT_STORE: "sqlite",
    TFT_AGENT_EPHEMERAL_STORE: "sqlite",
    TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK: "false"
  }), /requires TFT_AGENT_PERSISTENT_STORE=postgres/);
  assert.throws(() => resolveStorageConfig({}, {
    NODE_ENV: "production",
    TFT_AGENT_PERSISTENT_STORE: "postgres",
    TFT_AGENT_EPHEMERAL_STORE: "memory",
    TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK: "false"
  }), /requires TFT_AGENT_EPHEMERAL_STORE=redis/);
  assert.throws(() => resolveStorageConfig({}, {
    NODE_ENV: "production",
    TFT_AGENT_PERSISTENT_STORE: "postgres",
    TFT_AGENT_EPHEMERAL_STORE: "redis",
    TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK: "true"
  }), /MEMORY_FALLBACK=false/);
});

test("legacy stores expose Promise-based repository views", async () => {
  const store = new MemoryCacheStore();
  const repositories = createRepositoryViews(store);
  const pending = repositories.preferences.setUserPreference("visitor:test", { minSamples: 10 });
  assert.equal(pending instanceof Promise, true);
  await pending;
  assert.deepEqual((await repositories.preferences.getUserPreference("visitor:test")).value, { minSamples: 10 });
  assert.equal((await asAsyncStore(store).healthCheck()).ok, true);
});

test("Redis keys hash sensitive inputs and include versioned provider context", () => {
  const store = new RedisStore({ client: {}, prefix: "tft:v1" });
  const raw = "visitor-cookie:secret user query";
  const key = store._key("query", raw, {
    seasonContextId: "set17-live",
    providerVersion: "metatft-live.v1",
    effectivePatch: "17.7"
  });
  assert.match(key, /^tft:v1:query:set17-live:metatft-live\.v1:17\.7:[a-f0-9]{64}$/u);
  assert.equal(key.includes(raw), false);
});

test("Redis conclusion dequeue uses a recoverable processing list", async () => {
  const lists = new Map();
  const list = (key) => lists.get(key) ?? [];
  const client = {
    async lPush(key, value) { const values = list(key); values.unshift(value); lists.set(key, values); return values.length; },
    async lMove(source, destination) { const sourceValues = list(source); const value = sourceValues.pop() ?? null; lists.set(source, sourceValues); if (value !== null) { const destinationValues = list(destination); destinationValues.unshift(value); lists.set(destination, destinationValues); } return value; },
    async lRem(key, count, value) { const values = list(key); const index = values.indexOf(value); if (index < 0) return 0; values.splice(index, count); lists.set(key, values); return 1; }
  };
  const store = new RedisStore({ client, prefix: "tft:v1" });
  await store.enqueueConclusionJob("job-1");
  assert.equal(await store.dequeueConclusionJob(0), "job-1");
  assert.deepEqual(list(store._queueKey()), []);
  assert.deepEqual(list(store._processingKey()), ["job-1"]);
  assert.equal(await store.acknowledgeConclusionJob("job-1"), true);
});

test("capability routing never silently falls back to another provider", async () => {
  const metatft = { getAvailability: () => ({ available: false }) };
  const router = new CapabilityProviderRouter({ providers: { metatft }, capabilities: { unit_builds: "riot" } });
  await assert.rejects(() => router.call("unit_builds", {}, {}), { code: "provider_capability_unavailable" });
});

test("MetaTFT provider returns standardized unit builds with provenance", async () => {
  const provider = new MetaTftLiveProvider({
    explorerClient: {
      getUnitBuilds: async () => [{
        unit_builds: "TFT17_Xayah&TFT_Item_A|TFT_Item_B|TFT_Item_C",
        placement_count: [2, 3, 4, 5, 6, 7, 8, 9]
      }]
    },
    compsClient: {}
  });
  const envelope = await provider.getUnitBuilds({ id: "set17-live", source: { queue: "1100" } }, { unit: "TFT17_Xayah", patch: "17.7" });
  assert.deepEqual(envelope.data[0].itemApiNames, ["TFT_Item_A", "TFT_Item_B", "TFT_Item_C"]);
  assert.equal(envelope.data[0].placement_count, undefined);
  assert.equal(envelope.provenance.providerVersion, "metatft-live.v1");
  assert.equal(envelope.provenance.effectivePatch, "17.7");
});

test("conclusion queue payload is serializable and excludes clients and API keys", () => {
  const payload = serializeConclusionPayload({
    result: {
      type: "recommendation",
      intentEnvelope: {
        warnings: new Set(),
        entities: new Set(["unit"])
      },
      validation: {
        warnings: new Set(["sample_warning"]),
        errors: new Set()
      },
      entityLookup: new Map([["unit", "DA_Nidalee18_AP"]])
    },
    catalog: { items: [], units: [], traits: [] },
    input: "test",
    provider: () => {},
    config: { apiKey: "must-not-leak" }
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("provider"), false);
  assert.doesNotThrow(() => structuredClone(payload));
  const roundTripped = JSON.parse(serialized);
  assert.deepEqual(roundTripped.result.intentEnvelope.warnings, []);
  assert.deepEqual(roundTripped.result.intentEnvelope.entities, ["unit"]);
  assert.deepEqual(roundTripped.result.validation.warnings, ["sample_warning"]);
  assert.deepEqual(roundTripped.result.validation.errors, []);
  assert.deepEqual(roundTripped.result.entityLookup, { unit: "DA_Nidalee18_AP" });
});

test("Redis conclusion jobs keep JSON payloads opaque across Lua cjson rewrites", async () => {
  let stored = null;
  const client = {
    async set(_key, value) { stored = value; return "OK"; },
    async get() { return stored; }
  };
  const store = new RedisStore({ client, prefix: "tft:v1" });
  const payload = {
    result: {
      intentEnvelope: { warnings: [], entities: [] },
      validation: { warnings: [], errors: [] }
    }
  };

  const created = await store.createConclusionJob({ jobId: "job-json", requestPayload: payload });
  const redisValue = JSON.parse(stored);
  assert.equal(redisValue.requestPayload, undefined);
  assert.equal(typeof redisValue.requestPayloadJson, "string");
  assert.deepEqual(created.requestPayload, payload);
  assert.deepEqual((await store.getConclusionJob("job-json")).requestPayload, payload);
});

test("PostgreSQL migrations contain durable business and future provider tables only", async () => {
  const business = await readFile(new URL("../src/storage/postgres/migrations/001_business_schema.sql", import.meta.url), "utf8");
  const future = await readFile(new URL("../src/storage/postgres/migrations/002_provider_and_riot_reservations.sql", import.meta.url), "utf8");
  for (const table of ["user_preferences", "entity_aliases", "item_catalog", "units", "traits", "query_events", "feedback_events", "admin_audit_events", "comp_profiles", "comp_profile_bindings", "comp_trend_history"]) {
    assert.match(business, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(business, /CREATE TABLE IF NOT EXISTS (session_state|query_cache|default_context_cache)/u);
  for (const table of ["data_sources", "ingestion_runs", "raw_payload_objects", "aggregate_versions", "provider_shadow_comparisons"]) {
    assert.match(future, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
