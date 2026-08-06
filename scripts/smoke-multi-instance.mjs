import { randomUUID } from "node:crypto";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createRedisClient, RedisStore } from "../src/storage/redis-store.js";

loadLocalEnvironment();
const config = resolveStorageConfig({ ephemeralStore: "redis" });
const a = new RedisStore({ client: await createRedisClient({ url: config.redisUrl }), prefix: config.redisPrefix });
const b = new RedisStore({ client: await createRedisClient({ url: config.redisUrl }), prefix: config.redisPrefix });
const id = randomUUID();

try {
  await a.setSessionState(id, { instance: "a" }, { seasonContextId: "set17-live", ttlMs: 5000 });
  if ((await b.getSessionState(id, { seasonContextId: "set17-live" }))?.value?.instance !== "a") {
    throw new Error("Cross-instance session read failed");
  }

  const subject = `multi:${id}`;
  const quotaResults = await Promise.all([
    a.incrementRateLimit(subject, 1, 5000),
    b.incrementRateLimit(subject, 1, 5000)
  ]);
  if (quotaResults.filter((result) => result.allowed).length !== 1) {
    throw new Error("Cross-instance quota was not atomic");
  }

  await a.createConclusionJob({ jobId: id, status: "queued", attempts: 0 }, { ttlMs: 5000 });
  await a.enqueueConclusionJob(id);
  if ((await b.getConclusionJob(id))?.status !== "queued") {
    throw new Error("Cross-instance conclusion job read failed");
  }
  if (await b.dequeueConclusionJob(1) !== id) throw new Error("Cross-instance conclusion dequeue failed");
  if ((await b.claimConclusionJob(id, "worker-b"))?.status !== "running") {
    throw new Error("Cross-instance conclusion claim failed");
  }
  await b.completeConclusionJob(id, "complete", { result: { ok: true } });
  await b.acknowledgeConclusionJob(id);
  if ((await a.getConclusionJob(id))?.result?.ok !== true) {
    throw new Error("Cross-instance conclusion completion read failed");
  }

  console.log(JSON.stringify({
    ok: true,
    sessionShared: true,
    quotaAtomic: true,
    conclusionJobShared: true
  }));
} finally {
  await a.deleteSessionState(id, { seasonContextId: "set17-live" });
  await Promise.all([a.close(), b.close()]);
}
