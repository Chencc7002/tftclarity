import assert from "node:assert/strict";
import test from "node:test";
import { BoundedSemaphore, SingleflightCache } from "../src/core/concurrency.js";
import { CompsContextClient, MetaTFTClient } from "../src/data/metatft-client.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore, createCatalog } from "../src/index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("BoundedSemaphore bounds concurrency, releases aborted waiters, and returns 503 on overload", async () => {
  const sem = new BoundedSemaphore({
    maxConcurrent: 2,
    maxQueue: 1,
    queueTimeoutMs: 80,
    errorCode: "llm_busy",
    errorStatusCode: 503
  });

  let active = 0;
  let peak = 0;
  const hold = () => sem.run(async () => {
    active += 1;
    if (active > peak) peak = active;
    await sleep(60);
    active -= 1;
    return "ok";
  });

  const p1 = hold();
  const p2 = hold();
  // Waiter 3 aborts while queued; must not consume a slot or leak queue space.
  const abortController = new AbortController();
  const pAborted = sem.run(async () => "never", abortController.signal);
  abortController.abort(new Error("client_gone"));
  await assert.rejects(() => pAborted, /client_gone/);

  // Queue capacity is 1, so p3 queues and succeeds once p1/p2 finish; p4 exceeds maxQueue immediately.
  const p3 = sem.run(async () => "queued-ok");
  await assert.rejects(
    () => sem.run(async () => "overflow"),
    (error) => error.code === "llm_busy" && error.statusCode === 503
  );

  assert.deepEqual(await Promise.all([p1, p2, p3]), ["ok", "ok", "queued-ok"]);
  assert.equal(peak, 2);
  assert.equal(sem.stats().inFlight, 0);
  assert.equal(sem.stats().queued, 0);
});

test("SingleflightCache coalesces 50 concurrent cold requests, isolates caller abort, and supports SWR + L2", async () => {
  let nowMs = 1_000_000;
  const cache = new SingleflightCache({
    maxEntries: 8,
    softTtlMs: 1_000,
    hardTtlMs: 5_000,
    now: () => nowMs
  });

  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    await sleep(40);
    return { generation: loaderCalls };
  };

  // AC-C1 + AC-C2: Caller #1 aborts mid-flight; callers #2..#50 still succeed with 1 upstream load.
  const firstAbort = new AbortController();
  const calls = Array.from({ length: 50 }, (_, index) =>
    cache.getOrLoad("hot-key", loader, { signal: index === 0 ? firstAbort.signal : null })
  );
  setTimeout(() => firstAbort.abort(new Error("caller1_left")), 10);

  const settled = await Promise.allSettled(calls);
  assert.equal(settled[0].status, "rejected");
  assert.equal(settled.slice(1).every((item) => item.status === "fulfilled" && item.value.value.generation === 1), true);
  assert.equal(loaderCalls, 1);
  assert.equal(cache.stats().coalesced, 49);

  // Fresh L1 hit
  const warm = await cache.getOrLoad("hot-key", loader);
  assert.equal(warm.hit, "l1");
  assert.equal(warm.stale, false);
  assert.equal(loaderCalls, 1);

  // Soft-stale SWR hit returns stale immediately and triggers 1 background refresh
  nowMs += 1_500;
  const staleRes = await cache.getOrLoad("hot-key", loader);
  assert.equal(staleRes.hit, "l1");
  assert.equal(staleRes.stale, true);
  assert.equal(staleRes.value.generation, 1);
  await sleep(70);
  assert.equal(loaderCalls, 2);
  const refreshed = await cache.getOrLoad("hot-key", loader);
  assert.equal(refreshed.value.generation, 2);
  assert.equal(refreshed.stale, false);

  // L2 hit hydrates L1 without calling upstream loader
  const l2Hit = await cache.getOrLoad("l2-only-key", loader, {
    l2Get: async () => ({ value: { from: "redis" }, updatedAt: new Date(nowMs).toISOString(), expired: false })
  });
  assert.equal(l2Hit.hit, "l2");
  assert.deepEqual(l2Hit.value, { from: "redis" });
  assert.equal(loaderCalls, 2);
});

test("MetaTFTClient coalesces identical concurrent URLs and caps distinct upstream concurrency", async () => {
  let fetchCalls = 0;
  let active = 0;
  let peak = 0;
  const client = new MetaTFTClient({
    maxConcurrent: 3,
    fetchImpl: async (url) => {
      fetchCalls += 1;
      active += 1;
      if (active > peak) peak = active;
      await sleep(30);
      active -= 1;
      return new Response(JSON.stringify({ url: String(url), ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  // 20 identical URLs coalesce into 1 fetch even if first caller aborts
  const abort1 = new AbortController();
  const sameCalls = Array.from({ length: 20 }, (_, i) =>
    client.getItems({ queue: "PBE", patch: "current" }, { signal: i === 0 ? abort1.signal : null })
  );
  setTimeout(() => abort1.abort(new Error("gone")), 5);
  const sameResults = await Promise.allSettled(sameCalls);
  assert.equal(sameResults[0].status, "rejected");
  assert.equal(sameResults.slice(1).every((r) => r.status === "fulfilled" && r.value.ok), true);
  assert.equal(fetchCalls, 1);

  // 8 distinct URLs never exceed maxConcurrent=3
  await Promise.all(Array.from({ length: 8 }, (_, i) => client.getItems({ queue: "PBE", days: i + 1 })));
  assert.equal(peak <= 3, true);
  assert.equal(fetchCalls, 9);
});

test("S19 emblem rankings isolate excludeUnits cache keys and coalesce 50 concurrent cold requests to 1 upstream call", async () => {
  const SMEECH = "DA_Smeech19";
  const EMBLEM = "DA_Arcanist19_Emblem";
  let upstreamCalls = 0;
  const metaTFTClient = new MetaTFTClient({
    fetchImpl: async (url) => {
      upstreamCalls += 1;
      await sleep(35);
      const excluded = String(url).includes(SMEECH);
      return new Response(JSON.stringify({
        data: [{ items: EMBLEM, placement_count: excluded ? [100, 120, 140, 160, 180, 150, 100, 50] : [300, 220, 180, 120, 80, 50, 30, 20] }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const compsClient = new CompsContextClient({ fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }) });
  const catalog = createCatalog({
    units: [{ apiName: SMEECH, zhName: "史密奇", enName: "Smeech19", cost: 7, current: true }],
    items: [{ apiName: EMBLEM, zhName: "法师纹章", enName: "Arcanist Emblem", category: "emblem", current: true, obtainable: true }]
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient,
    compsClient,
    officialItemDetails: new Map([[EMBLEM, {
      apiName: EMBLEM,
      name: "法师纹章",
      recipe: [{ apiName: "TFT_Item_Spatula" }, { apiName: "TFT_Item_NeedlesslyLargeRod" }]
    }]])
  });

  // 50 concurrent default requests -> 1 upstream call
  const defaultBurst = await Promise.all(Array.from({ length: 50 }, (_, i) => handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: `d-${i}`, id: "emblem-rankings", operation: "emblem_rankings", arguments: {} }
  }, runtime)));
  assert.equal(defaultBurst.every((r) => r.statusCode === 200), true);
  assert.equal(upstreamCalls, 1);
  const defaultAvg = defaultBurst[0].payload.rows[0].stats.avgPlacement;

  // 50 concurrent excluded-Smeech requests -> 1 more upstream call, distinct stats
  const excludedBurst = await Promise.all(Array.from({ length: 50 }, (_, i) => handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: `e-${i}`, id: "emblem-rankings", operation: "emblem_rankings", arguments: { excludeUnits: [SMEECH] } }
  }, runtime)));
  assert.equal(excludedBurst.every((r) => r.statusCode === 200), true);
  assert.equal(upstreamCalls, 2);
  const excludedAvg = excludedBurst[0].payload.rows[0].stats.avgPlacement;
  assert.notEqual(defaultAvg, excludedAvg);
  assert.ok(excludedAvg > defaultAvg);

  // Warm repeat -> 0 additional upstream calls
  const warm = await handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "w-1", id: "emblem-rankings", operation: "emblem_rankings", arguments: { excludeUnits: [SMEECH] } }
  }, runtime);
  assert.equal(warm.statusCode, 200);
  assert.equal(upstreamCalls, 2);
});
