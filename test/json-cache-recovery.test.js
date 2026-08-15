import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getSmallWindowRuntimeStatus } from "../src/app/small-window-server.js";
import { JsonFileCacheStore } from "../src/data/cache-store.js";

test("invalid JSON cache fails open as an empty memory-only store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tft-json-cache-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "cache.json");
  const invalidJson = '{"queryCache":{},"broken":';
  await writeFile(filePath, invalidJson, "utf8");

  const store = new JsonFileCacheStore({
    filePath,
    now: () => Date.parse("2026-08-16T00:00:00.000Z")
  });

  assert.equal(await store.getQuery("missing"), null);
  assert.equal(store.loaded, true);
  assert.equal(store.persistenceDisabled, true);
  assert.deepEqual(store.loadDiagnostic, {
    status: "degraded",
    reason: "invalid_json",
    persistence: "memory_only",
    detectedAt: "2026-08-16T00:00:00.000Z",
    detail: store.loadDiagnostic.detail
  });
  assert.match(store.loadDiagnostic.detail, /JSON|position|input/u);

  await store.setQuery("warwick", { ok: true });
  assert.deepEqual((await store.getQuery("warwick"))?.value, { ok: true });
  assert.equal(await readFile(filePath, "utf8"), invalidJson);
});

test("runtime status exposes bounded JSON cache recovery diagnostics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tft-json-cache-status-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "cache.json");
  await writeFile(filePath, "{invalid", "utf8");
  const store = new JsonFileCacheStore({ filePath });
  await store.getQuery("trigger-load");

  const status = getSmallWindowRuntimeStatus({
    cacheStore: store,
    cacheStoreInfo: {
      type: "json",
      cachePath: filePath,
      persistent: true
    }
  });

  assert.equal(status.cache.operationalMode, "memory_fallback");
  assert.deepEqual(status.cache.recovery, {
    status: "degraded",
    reason: "invalid_json",
    persistence: "memory_only",
    detectedAt: store.loadDiagnostic.detectedAt
  });
  assert.equal(JSON.stringify(status.cache.recovery).includes(filePath), false);
  assert.equal(Object.hasOwn(status.cache.recovery, "detail"), false);
});
