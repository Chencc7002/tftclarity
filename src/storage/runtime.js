import { resolve } from "node:path";
import { JsonFileCacheStore, MemoryCacheStore } from "../data/cache-store.js";
import { SQLiteCacheStore } from "../data/sqlite-cache-store.js";
import { asAsyncStore } from "./async-store-adapter.js";
import { CompositeStore } from "./composite-store.js";
import { resolveStorageConfig } from "./config.js";
import { createPostgresPool } from "./postgres/client.js";
import { PostgresStore } from "./postgres/postgres-store.js";
import { createRedisClient, RedisStore } from "./redis-store.js";

async function persistentStore(config, options = {}) {
  if (options.persistentStoreInstance) return options.persistentStoreInstance;
  if (config.persistentStore === "postgres") return new PostgresStore({ pool: options.postgresPool ?? createPostgresPool(config) });
  if (config.persistentStore === "sqlite") return asAsyncStore(options.sqliteStore ?? await SQLiteCacheStore.open({
    filePath: resolve(options.cachePath ?? process.env.TFT_AGENT_CACHE_PATH ?? ".cache/tft-agent.sqlite"), ttlMs: options.cacheTtlMs
  }));
  if (config.persistentStore === "json") return asAsyncStore(new JsonFileCacheStore({ filePath: resolve(options.cachePath ?? ".cache/tft-agent.json") }));
  return asAsyncStore(new MemoryCacheStore({ ttlMs: options.cacheTtlMs }));
}

async function ephemeralStore(config, persistent, options = {}) {
  if (options.ephemeralStoreInstance) return options.ephemeralStoreInstance;
  if (config.ephemeralStore === "redis") {
    const client = options.redisClient ?? await createRedisClient({ url: config.redisUrl, connectTimeoutMs: config.redisConnectTimeoutMs, onError: options.onRedisError });
    return new RedisStore({ client, prefix: config.redisPrefix, ttlMs: options.cacheTtlMs, conclusionJobTtlMs: config.conclusionJobTtlMs });
  }
  if (config.ephemeralStore === "sqlite" && config.persistentStore === "sqlite") return persistent;
  if (config.ephemeralStore === "sqlite") return asAsyncStore(await SQLiteCacheStore.open({ filePath: resolve(options.ephemeralPath ?? ".cache/tft-agent-ephemeral.sqlite"), ttlMs: options.cacheTtlMs }));
  return asAsyncStore(new MemoryCacheStore({ ttlMs: options.cacheTtlMs }));
}

export async function createStorageRuntime(options = {}, env = process.env) {
  const config = resolveStorageConfig(options.storageConfig ?? options, env);
  let persistent;
  let ephemeral;
  try {
    persistent = await persistentStore(config, options);
    ephemeral = await ephemeralStore(config, persistent, options);
  } catch (error) {
    if (!config.allowMemoryFallback) throw error;
    await persistent?.close?.().catch?.(() => {});
    persistent = asAsyncStore(new MemoryCacheStore({ ttlMs: options.cacheTtlMs }));
    ephemeral = asAsyncStore(new MemoryCacheStore({ ttlMs: options.cacheTtlMs }));
  }
  const store = persistent === ephemeral ? persistent : new CompositeStore({ persistent, ephemeral });
  return { config, persistent, ephemeral, store };
}
