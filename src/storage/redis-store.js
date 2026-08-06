import { createHash } from "node:crypto";
import { createClient } from "redis";
import { DEFAULT_CACHE_TTL_MS } from "../data/cache-store.js";
import { normalizeSeasonContextId } from "../season/season-context.js";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(value);
}

function entry(value, ttlMs = null) {
  const updatedAt = new Date().toISOString();
  return {
    value,
    updatedAt,
    expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null,
    expired: false
  };
}

function positiveTtl(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export async function createRedisClient(options = {}) {
  if (!options.url) throw new Error("REDIS_URL is required for Redis storage");
  const client = createClient({
    url: options.url,
    socket: { connectTimeout: positiveTtl(options.connectTimeoutMs, 5_000) }
  });
  client.on("error", (error) => options.onError?.(error));
  await client.connect();
  return client;
}

export class RedisStore {
  constructor(options = {}) {
    if (!options.client) throw new Error("RedisStore requires a connected client");
    this.client = options.client;
    this.prefix = String(options.prefix ?? "tft:v1").replace(/:+$/u, "");
    this.ttlMs = { ...DEFAULT_CACHE_TTL_MS, ...(options.ttlMs ?? {}) };
    this.conclusionJobTtlMs = positiveTtl(options.conclusionJobTtlMs, 1_800_000);
  }

  _context(options = {}) {
    return {
      season: normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id),
      providerVersion: String(options.providerVersion ?? options.provider_version ?? "metatft-live.v1"),
      effectivePatch: String(options.effectivePatch ?? options.effective_patch ?? options.patch ?? "current")
    };
  }

  _key(kind, key, options = {}) {
    const context = this._context(options);
    const fingerprint = sha256(key);
    if (kind === "session") return `${this.prefix}:session:${context.season}:${fingerprint}`;
    if (kind === "query") return `${this.prefix}:query:${context.season}:${context.providerVersion}:${context.effectivePatch}:${fingerprint}`;
    if (kind === "default-context") return `${this.prefix}:default-context:${context.season}:${context.providerVersion}:${context.effectivePatch}:${fingerprint}`;
    return `${this.prefix}:${kind}:${fingerprint}`;
  }

  async _get(kind, key, options = {}) {
    const value = parseJson(await this.client.get(this._key(kind, key, options)));
    return value;
  }

  async _set(kind, key, value, ttlMs, options = {}) {
    const stored = entry(value, ttlMs);
    await this.client.set(this._key(kind, key, options), JSON.stringify(stored), { PX: ttlMs });
    return stored;
  }

  async _delete(kind, key, options = {}) {
    return (await this.client.del(this._key(kind, key, options))) > 0;
  }

  async _clear(kind, options = {}) {
    const context = this._context(options);
    const pattern = kind === "session"
      ? `${this.prefix}:session:${context.season}:*`
      : `${this.prefix}:${kind}:${context.season}:*`;
    let removed = 0;
    for await (const keys of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      const batch = Array.isArray(keys) ? keys : [keys];
      if (batch.length) removed += await this.client.del(batch);
    }
    return removed;
  }

  getQuery(key, options = {}) { return this._get("query", key, options); }
  setQuery(key, value, options = {}) { return this._set("query", key, value, positiveTtl(options.ttlMs, this.ttlMs.query), options); }
  clearQueryCache(options = {}) { return this._clear("query", options); }
  getDefaultContext(key, options = {}) { return this._get("default-context", key, options); }
  setDefaultContext(key, value, options = {}) { return this._set("default-context", key, value, positiveTtl(options.ttlMs, this.ttlMs.defaultContext), options); }
  clearDefaultContextCache(options = {}) { return this._clear("default-context", options); }
  getSessionState(key, options = {}) { return this._get("session", key, options); }
  setSessionState(key, value, options = {}) { return this._set("session", key, value, positiveTtl(options.ttlMs, this.ttlMs.session), options); }
  deleteSessionState(key, options = {}) { return this._delete("session", key, options); }
  clearSessionState(options = {}) { return this._clear("session", options); }

  _jobKey(jobId) { return `${this.prefix}:conclusion:${String(jobId)}`; }
  _chunkKey(jobId) { return `${this.prefix}:conclusion-chunks:${String(jobId)}`; }
  _queueKey() { return `${this.prefix}:queue:conclusion`; }
  _processingKey() { return `${this.prefix}:queue:conclusion:processing`; }

  async createConclusionJob(job, options = {}) {
    const ttlMs = positiveTtl(options.ttlMs, this.conclusionJobTtlMs);
    const now = new Date().toISOString();
    const value = {
      ...job,
      status: job.status ?? "queued",
      attempts: Number(job.attempts ?? 0),
      createdAt: job.createdAt ?? now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString()
    };
    const created = await this.client.set(this._jobKey(value.jobId), JSON.stringify(value), { NX: true, PX: ttlMs });
    if (!created) return parseJson(await this.client.get(this._jobKey(value.jobId)));
    return value;
  }

  async enqueueConclusionJob(jobId) {
    await this.client.lPush(this._queueKey(), String(jobId));
    return jobId;
  }

  async dequeueConclusionJob(timeoutSeconds = 1, client = this.client) {
    if (Number(timeoutSeconds) > 0) {
      return client.blMove(this._queueKey(), this._processingKey(), "RIGHT", "LEFT", Number(timeoutSeconds));
    }
    return client.lMove(this._queueKey(), this._processingKey(), "RIGHT", "LEFT");
  }

  async acknowledgeConclusionJob(jobId) {
    return (await this.client.lRem(this._processingKey(), 1, String(jobId))) > 0;
  }

  async recoverStalledConclusionJobs() {
    const ids = await this.client.lRange(this._processingKey(), 0, -1);
    let recovered = 0;
    for (const jobId of ids) {
      const job = await this.getConclusionJob(jobId);
      await this.client.lRem(this._processingKey(), 1, jobId);
      if (!job || ["complete", "fallback", "failed"].includes(job.status)) continue;
      await this.completeConclusionJob(jobId, "queued", {
        workerId: null,
        recoveredAt: new Date().toISOString()
      });
      await this.enqueueConclusionJob(jobId);
      recovered += 1;
    }
    return recovered;
  }

  async getConclusionJob(jobId) {
    return parseJson(await this.client.get(this._jobKey(jobId)));
  }

  async claimConclusionJob(jobId, workerId) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local job = cjson.decode(raw)
      if job.status ~= 'queued' and job.status ~= 'retrying' then return nil end
      job.status = 'running'
      job.workerId = ARGV[1]
      job.attempts = (job.attempts or 0) + 1
      job.startedAt = job.startedAt or ARGV[2]
      job.updatedAt = ARGV[2]
      redis.call('SET', KEYS[1], cjson.encode(job), 'KEEPTTL')
      return cjson.encode(job)
    `;
    const now = new Date().toISOString();
    const result = await this.client.eval(script, { keys: [this._jobKey(jobId)], arguments: [String(workerId), now] });
    return parseJson(result);
  }

  async completeConclusionJob(jobId, status, fields = {}) {
    const allowed = new Set(["complete", "fallback", "failed", "queued", "running", "retrying"]);
    if (!allowed.has(status)) throw new Error(`Unsupported conclusion status: ${status}`);
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local job = cjson.decode(raw)
      local patch = cjson.decode(ARGV[2])
      for key, value in pairs(patch) do job[key] = value end
      job.status = ARGV[1]
      job.updatedAt = ARGV[3]
      redis.call('SET', KEYS[1], cjson.encode(job), 'KEEPTTL')
      return cjson.encode(job)
    `;
    return parseJson(await this.client.eval(script, {
      keys: [this._jobKey(jobId)],
      arguments: [status, JSON.stringify(fields), new Date().toISOString()]
    }));
  }

  async updateConclusionJob(jobId, fields = {}) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local job = cjson.decode(raw)
      local patch = cjson.decode(ARGV[1])
      for key, value in pairs(patch) do job[key] = value end
      job.updatedAt = ARGV[2]
      redis.call('SET', KEYS[1], cjson.encode(job), 'KEEPTTL')
      return cjson.encode(job)
    `;
    return parseJson(await this.client.eval(script, {
      keys: [this._jobKey(jobId)],
      arguments: [JSON.stringify(fields), new Date().toISOString()]
    }));
  }

  async appendConclusionChunk(jobId, chunk) {
    const key = this._chunkKey(jobId);
    const transaction = this.client.multi();
    transaction.rPush(key, JSON.stringify(chunk));
    transaction.pExpire(key, this.conclusionJobTtlMs);
    await transaction.exec();
  }

  async getConclusionChunks(jobId, offset = 0) {
    const rows = await this.client.lRange(this._chunkKey(jobId), Math.max(0, Number(offset) || 0), -1);
    return rows.map(parseJson);
  }

  async incrementRateLimit(subject, limit, windowMs) {
    const key = `${this.prefix}:rate:${subject}`;
    const script = `
      local value = redis.call('INCR', KEYS[1])
      if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      return value
    `;
    const count = Number(await this.client.eval(script, { keys: [key], arguments: [String(windowMs)] }));
    return { allowed: Number(limit) === 0 ? false : count <= Number(limit), count, limit: Number(limit) };
  }

  async reserveQuota(subjects, ttlMs) {
    const keys = subjects.map(({ type, hash, date }) => `${this.prefix}:quota:llm:${type}:${hash}:${date}`);
    const limits = subjects.map(({ limit }) => String(limit));
    const script = `
      for i, key in ipairs(KEYS) do
        local current = tonumber(redis.call('GET', key) or '0')
        if tonumber(ARGV[i]) == 0 or current >= tonumber(ARGV[i]) then return 0 end
      end
      for i, key in ipairs(KEYS) do
        local value = redis.call('INCR', key)
        if value == 1 then redis.call('PEXPIRE', key, ARGV[#KEYS + 1]) end
      end
      return 1
    `;
    const reserved = Number(await this.client.eval(script, { keys, arguments: [...limits, String(ttlMs)] })) === 1;
    return reserved;
  }

  async getQuotaCount(type, hash, date) {
    return Number(await this.client.get(`${this.prefix}:quota:llm:${type}:${hash}:${date}`) ?? 0);
  }

  async acquireLock(name, owner, ttlMs = 30_000) {
    return (await this.client.set(`${this.prefix}:lock:${name}`, String(owner), { NX: true, PX: ttlMs })) === "OK";
  }

  async releaseLock(name, owner) {
    const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
    return Number(await this.client.eval(script, { keys: [`${this.prefix}:lock:${name}`], arguments: [String(owner)] })) > 0;
  }

  async healthCheck() {
    const pong = await this.client.ping();
    return { ok: pong === "PONG", type: "redis" };
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
