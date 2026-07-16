import test from "node:test";
import assert from "node:assert/strict";
import { AnonymousAccessService, anonymousScopeKey } from "../src/access/anonymous-access.js";
import { createCatalog, MemoryCacheStore } from "../src/index.js";
import {
  createSmallWindowRuntime,
  handlePreferencesRequest,
  loadSmallWindowPreferences,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const SECRET = "test-secret-that-is-longer-than-thirty-two-characters";

function responseStub() {
  return {
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    }
  };
}

function cookieHeader(setCookie) {
  return String(setCookie).split(";", 1)[0];
}

test("anonymous access issues and validates a signed visitor cookie", () => {
  const service = new AnonymousAccessService({
    enabled: true,
    secret: SECRET,
    secureCookies: false
  });
  const firstResponse = responseStub();
  const first = service.identify({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }, firstResponse);
  assert.equal(first.anonymous, true);
  assert.match(firstResponse.headers.get("set-cookie"), /HttpOnly/);
  assert.match(firstResponse.headers.get("set-cookie"), /SameSite=Lax/);

  const secondResponse = responseStub();
  const second = service.identify({
    headers: { cookie: cookieHeader(firstResponse.headers.get("set-cookie")) },
    socket: { remoteAddress: "127.0.0.1" }
  }, secondResponse);
  assert.equal(second.id, first.id);
  assert.equal(second.scope, first.scope);
  assert.equal(secondResponse.headers.has("set-cookie"), false);
});

test("anonymous LLM quota is enforced per visitor without disabling local mode", () => {
  let now = Date.parse("2026-07-15T10:00:00.000Z");
  const service = new AnonymousAccessService({
    enabled: true,
    secret: SECRET,
    visitorDailyLimit: 2,
    ipDailyLimit: 10,
    globalDailyLimit: 20,
    now: () => now
  });
  const response = responseStub();
  const visitor = service.identify({ headers: {}, socket: { remoteAddress: "10.0.0.1" } }, response);

  assert.equal(service.quota(visitor).remaining, 2);
  assert.equal(service.reserveLlmUse(visitor).remaining, 1);
  assert.equal(service.reserveLlmUse(visitor).remaining, 0);
  assert.throws(() => service.reserveLlmUse(visitor), { code: "llm_quota_exceeded" });

  now += 24 * 60 * 60 * 1000;
  assert.equal(service.quota(visitor).remaining, 2);

  const local = new AnonymousAccessService({ enabled: false });
  const localVisitor = local.identify({ headers: {}, socket: {} }, responseStub());
  assert.equal(localVisitor.scope, null);
  assert.doesNotThrow(() => local.reserveLlmUse(localVisitor));
});

test("anonymous preference keys isolate visitors while shared caches remain reusable", async () => {
  const runtime = { cacheStore: new MemoryCacheStore() };
  await handlePreferencesRequest({ preferences: { minSamples: 500 } }, runtime, "visitor-a");
  await handlePreferencesRequest({ preferences: { minSamples: 200 } }, runtime, "visitor-b");

  assert.equal((await loadSmallWindowPreferences(runtime, "visitor-a")).minSamples, 500);
  assert.equal((await loadSmallWindowPreferences(runtime, "visitor-b")).minSamples, 200);
  assert.equal((await loadSmallWindowPreferences(runtime, "visitor-c")).minSamples, 100);
  assert.equal(
    runtime.cacheStore.getUserPreference(anonymousScopeKey("visitor-a", "small_window")).value.minSamples,
    500
  );
});

test("public HTTP mode keeps two browser visitors isolated", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    catalog: createCatalog(),
    fetchItems: false
  });
  runtime.accessService = new AnonymousAccessService({
    enabled: true,
    secret: SECRET,
    secureCookies: false,
    requestsPerMinute: 50
  });
  const started = await startSmallWindowServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    prewarmCatalog: false
  });
  try {
    const firstAccess = await fetch(`${started.url}api/access`);
    const firstCookie = cookieHeader(firstAccess.headers.get("set-cookie"));
    assert.equal((await firstAccess.json()).access.quota.remaining, 5);

    const saved = await fetch(`${started.url}api/preferences`, {
      method: "POST",
      headers: { cookie: firstCookie, "content-type": "application/json" },
      body: JSON.stringify({ preferences: { minSamples: 500 } })
    });
    assert.equal(saved.status, 200);

    const firstPreferences = await fetch(`${started.url}api/preferences`, {
      headers: { cookie: firstCookie }
    }).then((response) => response.json());
    const secondPreferences = await fetch(`${started.url}api/preferences`)
      .then((response) => response.json());
    assert.equal(firstPreferences.preferences.minSamples, 500);
    assert.equal(secondPreferences.preferences.minSamples, 100);

    const hiddenMaintenance = await fetch(`${started.url}api/entity-aliases`, {
      headers: { cookie: firstCookie }
    });
    assert.equal(hiddenMaintenance.status, 404);
  } finally {
    await new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
  }
});
