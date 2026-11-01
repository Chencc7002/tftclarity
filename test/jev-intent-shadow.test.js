import test from "node:test";
import assert from "node:assert/strict";
import { buildJevIntentRequest, createJevIntentShadow, validateJevIntentResponse, diagnoseJevIntentResponse } from "../src/understanding/jev-intent-shadow.js";

function fixture() {
  const { questions } = buildJevIntentRequest({ input: "推荐装备" });
  const choices = { action: "recommend", domain: "tft", context: "self_contained" };
  return { model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, {
    type: "choice", choice: choices[name], confidence: 1,
    probabilities: Object.fromEntries(Object.keys(q.criteria).map(label => [label, Number(label === choices[name])]))
  }])), usage: { input_tokens: 100, output_tokens: 30 } };
}
const opts = fetchImpl => ({ mode: "shadow", apiKey: "test-secret", fetchImpl });

test("invalid response diagnostics retain fixed failure codes without provider text", async () => {
  const value = fixture();
  value.answers.action.probabilities.unknown = 0.02;
  assert.equal(diagnoseJevIntentResponse(value), "action_probability_sum");
  const result = await createJevIntentShadow(opts(async () => ({ ok: true, json: async () => value })))({ input: "x" });
  assert.equal(result.validationFailure, "action_probability_sum");
  assert.equal(result.reason, "invalid_response");
  const malformed = await createJevIntentShadow(opts(async () => ({ ok: true, json: async () => { throw new Error("sensitive-response"); } })))({ input: "x" });
  assert.equal(malformed.validationFailure, "invalid_json");
  assert.ok(!JSON.stringify(malformed).includes("sensitive-response"));
});

test("provider probability rounding is bounded and normalized before observation", async () => {
  const value = fixture();
  value.answers.domain.probabilities.tft = 0.99;
  assert.equal(validateJevIntentResponse(value), true);
  const result = await createJevIntentShadow(opts(async () => ({ ok: true, json: async () => value })))({ input: "x" });
  assert.equal(result.status, "observed");
  const sum = Object.values(result.answers.domain.probabilities).reduce((total, number) => total + number, 0);
  assert.ok(Math.abs(sum - 1) < Number.EPSILON * 4);
  const invalid = fixture();
  invalid.answers.domain.probabilities.tft = 0.98;
  assert.equal(diagnoseJevIntentResponse(invalid), "domain_probability_sum");
});

test("off, missing credentials and invalid input never access the network", async () => {
  const fetchImpl = () => { throw new Error("must not run"); };
  assert.equal((await createJevIntentShadow({ fetchImpl, apiKey: "x" })({ input: "查装备" })).status, "disabled");
  assert.equal((await createJevIntentShadow({ mode: "shadow", fetchImpl })({ input: "x" })).reason, "missing_api_key");
  assert.equal((await createJevIntentShadow(opts(fetchImpl))({ input: "x".repeat(4001) })).reason, "invalid_input");
  assert.throws(() => createJevIntentShadow({ mode: "invalid" }));
});

test("shadow restricts destination and input projection; returns only advisory comparison", async () => {
  const input = { input: "推荐装备", conversationSummary: "", apiKey: "do-not-send", tools: ["evil"] };
  let calls = 0;
  const classify = createJevIntentShadow(opts(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body).state, { input: input.input, conversationSummary: "" });
    return { ok: true, json: async () => fixture() };
  }));
  const baseline = { action: "recommend", tools: ["existing"] };
  const saved = structuredClone(baseline);
  const result = await classify(input, { baselineAction: baseline.action });
  assert.equal(result.status, "observed");
  assert.equal(result.actionAgreement, true);
  assert.deepEqual(baseline, saved);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  assert.equal(Object.hasOwn(result, "taskFrame"), false);
});

test("domain question explicitly inherits the domain of resolved contextual follow-ups", () => {
  const { domain } = buildJevIntentRequest({ input: "那这个呢？", conversationSummary: "earlier TFT turn" }).questions;
  assert.match(domain.instructions, /inherit the domain established by conversationSummary/u);
  assert.match(domain.criteria.tft, /inherits TFT/u);
  assert.match(domain.criteria.out_of_domain, /Do not choose this only because/u);
});

test("strict response validation rejects invented options, tools, types and invalid probabilities", () => {
  assert.equal(validateJevIntentResponse(fixture()), true);
  for (const mutate of [
    x => { x.answers.action.choice = "execute_sql"; },
    x => { x.tools = []; },
    x => { x.answers.action.confidence = "1"; },
    x => { x.answers.action.probabilities.unknown = 0.2; },
    x => { x.answers.action.choice = "unknown"; },
    x => { x.usage.input_tokens = -1; },
    x => { delete x.answers.context; }
  ]) { const x = fixture(); mutate(x); assert.equal(validateJevIntentResponse(x), false); }
});

test("timeouts cover a stalled response body, even if transport ignores AbortSignal", async () => {
  const classify = createJevIntentShadow({ ...opts(async () => ({ ok: true, json: () => new Promise(() => {}) })), timeoutMs: 10 });
  assert.equal((await classify({ input: "查装备" })).status, "timeout");
});

test("caller cancellation terminates a hanging transport", async () => {
  const controller = new AbortController();
  const classify = createJevIntentShadow(opts(() => new Promise(() => {})));
  const result = classify({ input: "查装备" }, { signal: controller.signal });
  controller.abort();
  assert.equal((await result).status, "cancelled");
  assert.equal((await classify({ input: "查装备" }, { signal: controller.signal })).status, "cancelled");
});

test("provider failures are bounded, sanitized and never retried", async () => {
  for (const status of [401, 422, 429, 529]) {
    let calls = 0;
    const classify = createJevIntentShadow(opts(async () => { calls++; return { ok: false, status }; }));
    assert.equal((await classify({ input: "查装备" })).httpStatus, status);
    assert.equal(calls, 1);
  }
  const classify = createJevIntentShadow(opts(async () => { throw new Error("test-secret"); }));
  assert.equal(JSON.stringify(await classify({ input: "查装备" })).includes("test-secret"), false);
  const invalid = createJevIntentShadow(opts(async () => ({ ok: true, json: async () => ({ tool: "evil" }) })));
  assert.equal((await invalid({ input: "查装备" })).reason, "invalid_response");
});
