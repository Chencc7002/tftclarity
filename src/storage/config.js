function choice(value, allowed, fallback, name) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  return normalized;
}

function positiveInteger(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

export function resolveStorageConfig(options = {}, env = process.env) {
  const production = (env.NODE_ENV ?? options.nodeEnv) === "production";
  const persistentStore = choice(
    options.persistentStore ?? env.TFT_AGENT_PERSISTENT_STORE ?? env.TFT_AGENT_CACHE_STORE,
    ["memory", "json", "sqlite", "postgres"],
    production ? "sqlite" : "sqlite",
    "TFT_AGENT_PERSISTENT_STORE"
  );
  const ephemeralStore = choice(
    options.ephemeralStore ?? env.TFT_AGENT_EPHEMERAL_STORE,
    ["memory", "sqlite", "redis"],
    persistentStore === "postgres" ? "redis" : persistentStore === "sqlite" ? "sqlite" : "memory",
    "TFT_AGENT_EPHEMERAL_STORE"
  );
  const allowMemoryFallback = booleanValue(
    options.allowMemoryFallback ?? env.TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK,
    !production
  );
  if (production && persistentStore !== "postgres") {
    throw new Error("Production requires TFT_AGENT_PERSISTENT_STORE=postgres");
  }
  if (production && persistentStore === "postgres" && ephemeralStore !== "redis") {
    throw new Error("Production PostgreSQL mode requires TFT_AGENT_EPHEMERAL_STORE=redis");
  }
  if (production && allowMemoryFallback) {
    throw new Error("Production requires TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK=false");
  }
  return {
    persistentStore,
    ephemeralStore,
    allowMemoryFallback,
    processRole: choice(options.processRole ?? env.TFT_AGENT_PROCESS_ROLE, ["web", "worker", "all"], "all", "TFT_AGENT_PROCESS_ROLE"),
    databaseUrl: options.databaseUrl ?? env.DATABASE_URL ?? null,
    databaseSsl: choice(options.databaseSsl ?? env.TFT_AGENT_DATABASE_SSL, ["disable", "require"], "disable", "TFT_AGENT_DATABASE_SSL"),
    databasePoolMax: positiveInteger(options.databasePoolMax ?? env.TFT_AGENT_DATABASE_POOL_MAX, 10, "TFT_AGENT_DATABASE_POOL_MAX"),
    databaseIdleTimeoutMs: positiveInteger(options.databaseIdleTimeoutMs ?? env.TFT_AGENT_DATABASE_IDLE_TIMEOUT_MS, 30_000, "TFT_AGENT_DATABASE_IDLE_TIMEOUT_MS"),
    databaseConnectTimeoutMs: positiveInteger(options.databaseConnectTimeoutMs ?? env.TFT_AGENT_DATABASE_CONNECT_TIMEOUT_MS, 5_000, "TFT_AGENT_DATABASE_CONNECT_TIMEOUT_MS"),
    databaseStatementTimeoutMs: positiveInteger(options.databaseStatementTimeoutMs ?? env.TFT_AGENT_DATABASE_STATEMENT_TIMEOUT_MS, 10_000, "TFT_AGENT_DATABASE_STATEMENT_TIMEOUT_MS"),
    redisUrl: options.redisUrl ?? env.REDIS_URL ?? null,
    redisPrefix: String(options.redisPrefix ?? env.TFT_AGENT_REDIS_PREFIX ?? "tft:v1").replace(/:+$/u, ""),
    redisConnectTimeoutMs: positiveInteger(options.redisConnectTimeoutMs ?? env.TFT_AGENT_REDIS_CONNECT_TIMEOUT_MS, 5_000, "TFT_AGENT_REDIS_CONNECT_TIMEOUT_MS"),
    workerConcurrency: positiveInteger(options.workerConcurrency ?? env.TFT_AGENT_WORKER_CONCURRENCY, 2, "TFT_AGENT_WORKER_CONCURRENCY"),
    conclusionJobTtlMs: positiveInteger(options.conclusionJobTtlMs ?? env.TFT_AGENT_CONCLUSION_JOB_TTL_MS, 1_800_000, "TFT_AGENT_CONCLUSION_JOB_TTL_MS"),
    conclusionJobAttempts: positiveInteger(options.conclusionJobAttempts ?? env.TFT_AGENT_CONCLUSION_JOB_ATTEMPTS, 2, "TFT_AGENT_CONCLUSION_JOB_ATTEMPTS"),
    conclusionJobBackoffMs: positiveInteger(options.conclusionJobBackoffMs ?? env.TFT_AGENT_CONCLUSION_JOB_BACKOFF_MS, 1_000, "TFT_AGENT_CONCLUSION_JOB_BACKOFF_MS")
  };
}
