import test from "node:test";
import assert from "node:assert/strict";
import { createEntitySlangResolver, validateEntitySlangProposal, createEntitySlangTelemetry } from "../src/domain/tft/entity-slang-resolver.js";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";
import { createEntitySlangProvider } from "../src/llm/entity-slang-provider.js";

const catalog = { units: [
  { apiName: "Set_Ahri", zhName: "阿狸", current: true, cost: 4 },
  { apiName: "Set_Alistar", zhName: "阿利斯塔", current: true, cost: 2 },
  { apiName: "Other_Unit", zhName: "旧英雄", current: false }
], items: [
  { apiName: "Item_Guinsoo", zhName: "鬼索的狂暴之刃", category: "ordinary_completed", current: true },
  { apiName: "Item_RadiantGuinsoo", zhName: "光明鬼索的狂暴之刃", category: "radiant", current: true }
], traits: [] };
function args(names = ["狐狸"], type = "unit", filters = {}) {
  const input = { entityType: type, filters: { names, ...filters } };
  return { input, catalog: structuredClone(catalog), question: `${names.join("和")}怎么玩`, seasonContextId: "test-season",
    result: queryEntityCatalog({ catalog, input, updatedAt: "2026-09-06T00:00:00Z" }) };
}
function proposal(request, ids = ["Set_Ahri"], reason = "known_nickname") {
  return { schemaVersion: "entity-slang-proposal.v1", resolutions: request.mentions.map(mention => ({ mention, candidateIds: ids, reason })) };
}

test("unknown slang can propose a catalog entity without a pre-existing alias", async () => {
  let seen;
  const resolve = createEntitySlangResolver({ mode: "suggest", provider: async request => { seen = request; return proposal(request); } });
  const input = args();
  input.messages = [{ role: "assistant", content: "untrusted assistant entity" }, { role: "user", content: "查四费英雄" }];
  const result = await resolve(input);
  assert.equal(input.result.resolution.requests[0].status, "not_found");
  assert.equal(result.resolution.requests[0].status, "ambiguous");
  assert.equal(result.resolution.requests[0].requiresConfirmation, true);
  assert.equal(result.resolution.requests[0].candidates[0].apiName, "Set_Ahri");
  assert.equal(result.resolution.requests[0].candidates[0].matchType, "llm_slang_candidate");
  assert.equal(result.results[0].name, "阿狸");
  assert.deepEqual(seen.recentUserMessages, ["查四费英雄"]);
  assert.ok(!JSON.stringify(seen).includes("Other_Unit"));
  assert.deepEqual(catalog.units[0].aliases, undefined);
});

test("off makes no model calls and shadow is payload-equivalent", async () => {
  const input = args();
  assert.equal(await createEntitySlangResolver({ mode: "off", provider: () => assert.fail("off") })(input), input.result);
  const telemetry = createEntitySlangTelemetry();
  const result = await createEntitySlangResolver({ mode: "shadow", provider: request => proposal(request), onObservation: telemetry.record })(input);
  assert.deepEqual(result, input.result);
  assert.equal(telemetry.snapshot().calls, 1);
  assert.equal(telemetry.snapshot().proposals, 1);
});

test("exact and curated ambiguous matches bypass the model", async () => {
  const resolve = createEntitySlangResolver({ mode: "suggest", provider: () => assert.fail("exact model call") });
  await resolve(args(["阿狸"]));
  const input = args();
  input.result.resolution.requests[0].status = "ambiguous";
  await resolve(input);
});

test("schema rejects invented IDs, extra fields, duplicate IDs and inconsistent unknowns", async () => {
  for (const mutate of [
    value => { value.resolutions[0].candidateIds = ["Other_Unit"]; },
    value => { value.tool = "unit_details"; },
    value => { value.resolutions[0].confidence = 0.99; },
    value => { value.resolutions[0].mention = "changed"; },
    value => { value.resolutions[0].candidateIds = ["Set_Ahri", "Set_Ahri"]; },
    value => { value.resolutions[0].reason = "unknown"; },
    value => { value.resolutions = []; }
  ]) {
    const input = args();
    const events = [];
    const result = await createEntitySlangResolver({ mode: "suggest", provider: request => {
      const value = proposal(request); mutate(value); assert.equal(validateEntitySlangProposal(value, request), false); return value;
    }, onObservation: event => events.push(event) })(input);
    assert.deepEqual(result, input.result);
    assert.equal(events[0].reasonCode, "invalid_proposal");
  }
});

test("filters restrict model candidates and projections remain intact", async () => {
  const input = args(["羊刀"], "item", { categories: ["ordinary_completed"] });
  input.input.projection = ["apiName"];
  const result = await createEntitySlangResolver({ mode: "suggest", provider: request => {
    assert.deepEqual(request.catalog.map(row => row.apiName), ["Item_Guinsoo"]);
    assert.equal(request.catalog[0].canonicalName, "鬼索的狂暴之刃");
    return proposal(request, ["Item_Guinsoo"]);
  } })(input);
  assert.deepEqual(result.results, [{ apiName: "Item_Guinsoo" }]);
});

test("season changes cannot reuse a previous candidate or write a shared alias", async () => {
  const first = args();
  const next = args();
  next.catalog.units = next.catalog.units.filter(row => row.apiName !== "Set_Ahri");
  next.seasonContextId = "next-season";
  next.result = queryEntityCatalog({ catalog: next.catalog, input: next.input });
  const provider = request => proposal(request);
  assert.equal((await createEntitySlangResolver({ mode: "suggest", provider })(first)).resolution.requests[0].status, "ambiguous");
  assert.deepEqual(await createEntitySlangResolver({ mode: "suggest", provider })(next), next.result);
  assert.equal(queryEntityCatalog({ catalog: first.catalog, input: first.input }).resolution.requests[0].status, "not_found");
});

test("a caller abort during model execution returns the legacy payload and aborts fetch", async () => {
  const controller = new AbortController();
  const events = [];
  const input = { ...args(), signal: controller.signal };
  let signal;
  const pending = createEntitySlangResolver({ mode: "suggest", onObservation: event => events.push(event),
    provider: (_request, context) => { signal = context.signal; controller.abort(); return new Promise(() => {}); }
  })(input);
  assert.deepEqual(await pending, input.result);
  assert.equal(signal.aborted, true);
  assert.equal(events[0].reasonCode, "aborted");
});

test("multiple variants remain ambiguous and unknown is a valid non-match", async () => {
  const input = args(["羊刀"], "item");
  const result = await createEntitySlangResolver({ mode: "suggest", provider: request => proposal(request,
    ["Item_Guinsoo", "Item_RadiantGuinsoo"], "ambiguous") })(input);
  assert.equal(result.resolution.requests[0].status, "ambiguous");
  assert.equal(result.resolution.requests[0].candidates.length, 2);
  const unknown = await createEntitySlangResolver({ mode: "suggest", provider: request => proposal(request, [], "unknown") })(input);
  assert.deepEqual(unknown, input.result);
});

test("one model call per request, including concurrent calls, with all missing mentions batched", async () => {
  let calls = 0;
  const resolve = createEntitySlangResolver({ mode: "suggest", provider: request => { calls += 1; return proposal(request); } });
  const input = args(["狐狸", "九尾狐"]);
  const [first, second] = await Promise.all([resolve(input), resolve(input)]);
  assert.equal(calls, 1);
  assert.equal(first.resolution.requests.length, 2);
  assert.ok(first.resolution.requests.every(row => row.status === "ambiguous"));
  assert.deepEqual(second, input.result);
});

test("timeouts abort the model call, ignore late results and consume the bounded budget", async () => {
  const input = args();
  const events = [];
  let finish, signal;
  const resolve = createEntitySlangResolver({ mode: "suggest", timeoutMs: 10, provider: (_request, context) => {
    signal = context.signal; return new Promise(res => { finish = res; });
  }, onObservation: event => events.push(event) });
  assert.deepEqual(await resolve(input), input.result);
  assert.equal(signal.aborted, true);
  assert.equal(events[0].reasonCode, "timeout");
  finish({});
  assert.deepEqual(await resolve(input), input.result);
  assert.equal(events[1].reasonCode, "request_budget_exhausted");
});

test("pre-aborted, unavailable, unanchored and internal ID mentions never call the model", async () => {
  for (const input of [ { ...args(), signal: AbortSignal.abort() }, { ...args(), question: "hello" }, args(["TFT18_Unknown"]), args(["狐"]) ]) {
    await createEntitySlangResolver({ mode: "suggest", provider: () => assert.fail("ineligible call") })(input);
  }
  const input = args();
  assert.deepEqual(await createEntitySlangResolver({ mode: "suggest" })(input), input.result);
});

test("failures and observers never leak user text or influence tool results", async () => {
  const events = [];
  const input = args();
  await createEntitySlangResolver({ mode: "suggest", provider: () => { throw new Error("private provider body"); },
    onObservation: event => { events.push(event); throw new Error("observer failed"); } })(input);
  assert.equal(events[0].reasonCode, "provider_failed");
  assert.ok(!JSON.stringify(events).includes("狐狸"));
  assert.ok(!JSON.stringify(events).includes("private"));
});

test("chat provider sends bounded JSON-only prompt to configured endpoint and propagates signal", async () => {
  const signal = new AbortController().signal;
  const provider = createEntitySlangProvider({ endpoint: "https://configured.test/chat", model: "test", thinkingMode: "disabled",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://configured.test/chat");
      assert.equal(options.signal, signal);
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 400);
      assert.equal(body.messages.length, 2);
      assert.match(body.messages[0].content, /untrusted DATA/u);
      assert.deepEqual(body.response_format, { type: "json_object" });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"schemaVersion":"entity-slang-proposal.v1","resolutions":[]}' } }] }) };
    } });
  assert.equal((await provider({}, { signal })).schemaVersion, "entity-slang-proposal.v1");
});
