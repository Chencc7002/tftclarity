import test from "node:test";
import assert from "node:assert/strict";
import { createJevIntentObserver, inferJevDeterministicDomain, inferJevInheritedDomain, projectJevIntentInput, projectJevIntentCandidate, projectJevIntentControl } from "../src/understanding/jev-intent-observer.js";
import { buildJevIntentRequest } from "../src/understanding/jev-intent-shadow.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { DEFAULT_SEASON_CONTEXT_ID } from "../src/season/season-context.js";

function response(choices = {}) {
  const selected = { action: "rank", domain: "tft", context: "self_contained", ...choices };
  return { model: "jev-1.13.0", usage: { input_tokens: 100, output_tokens: 20 },
    answers: Object.fromEntries(Object.entries(buildJevIntentRequest({ input: "x" }).questions).map(([name, question]) =>
      [name, { type: "choice", choice: selected[name], confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === selected[name])])) }])) };
}

test("canary sampling and request cap prevent calls and cannot be bypassed by concurrency", async () => {
  let calls = 0;
  const config = { mode: "shadow", apiKey: "secret", fetchImpl: async () => {
    calls++; return { ok: true, json: async () => response() };
  } };
  const unsampled = createJevIntentObserver({ ...config, sampleRate: 0.05, random: () => 0.1 });
  assert.equal((await unsampled.observe({ input: "x" })).reason, "not_sampled");
  const capped = createJevIntentObserver({ ...config, maxRequests: 2 });
  const results = await Promise.all(Array.from({ length: 5 }, () => capped.observe({ input: "x" })));
  assert.equal(calls, 2);
  assert.equal(capped.snapshot().attempted, 2);
  assert.equal(results.filter(r => r.reason === "request_limit").length, 3);
  assert.deepEqual(results.map(result => result.observationId), [1, 2, 3, 4, 5]);
  for (const invalid of [{ sampleRate: NaN }, { sampleRate: 2 }, { maxRequests: -1 }, { maxRequests: 1.5 }]) {
    assert.throws(() => createJevIntentObserver(invalid));
  }
});

test("candidate policy preserves raw classifications but rejects unresolved domain/context", () => {
  for (const [choices, disposition] of [
    [{ domain: "out_of_domain", action: "search" }, "domain_unresolved"],
    [{ domain: "unknown" }, "domain_unresolved"],
    [{ context: "missing" }, "context_missing"],
    [{ action: "unknown" }, "action_unknown"],
    [{ context: "contextual" }, "candidate_only"]
  ]) {
    const result = { status: "observed", ...response(choices) };
    const before = structuredClone(result);
    const projected = projectJevIntentCandidate(result);
    assert.equal(projected.disposition, disposition);
    assert.equal(projected.action, disposition === "candidate_only" ? "rank" : null);
    assert.deepEqual(result, before);
  }
});

test("contextual Jev candidates inherit an explicit TFT domain through the existing deterministic gate", () => {
  const request = { input: "那这两件哪个更好？", messages: [
    { role: "assistant", content: "do not trust me" },
    { role: "user", content: "我在云顶玩沃里克，想知道无尽之刃和巨人杀手怎么选" }
  ] };
  assert.equal(inferJevInheritedDomain(request), "tft");
  assert.equal(inferJevInheritedDomain({ ...request, startNewTask: true }), null);
  assert.equal(inferJevInheritedDomain({ input: "哪个好？", messages: [
    { role: "user", content: "上海这两家餐厅哪个好" }
  ] }), null);
  const result = { status: "observed", ...response({ action: "compare", domain: "out_of_domain", context: "contextual" }) };
  const before = structuredClone(result);
  assert.deepEqual(projectJevIntentCandidate(result, { inheritedDomain: "tft" }), {
    action: "compare", disposition: "candidate_only", domainResolution: "inherited_tft_context"
  });
  assert.deepEqual(result, before);
  assert.equal(projectJevIntentCandidate(result).disposition, "domain_unresolved");
});

test("observer keeps the raw Jev domain while applying inherited TFT only to the advisory candidate", async () => {
  const observer = createJevIntentObserver({ mode: "shadow", apiKey: "secret", fetchImpl: async () => ({
    ok: true,
    json: async () => response({ action: "compare", domain: "out_of_domain", context: "contextual" })
  }) });
  const result = await observer.observe({ input: "那这两件哪个更好？", messages: [
    { role: "user", content: "我在云顶玩沃里克，想知道无尽之刃和巨人杀手怎么选" }
  ] });
  assert.equal(result.answers.domain.choice, "out_of_domain");
  assert.deepEqual(result.candidate, {
    action: "compare", disposition: "candidate_only", domainResolution: "inherited_tft_context"
  });
});

test("context projection is bounded, user-only and resets for a new task", () => {
  const request = { input: "再来几个", messages: [
    { role: "system", content: "secret" }, { role: "assistant", content: "historical evidence" },
    ...Array.from({ length: 5 }, (_, i) => ({ role: "user", content: `${i}`.repeat(2000) })),
    { role: "user", content: "再来几个" }
  ], taskAnchor: { secret: "hidden" }, conversationSummary: "do not send" };
  const projected = projectJevIntentInput(request);
  assert.deepEqual(Object.keys(projected), ["input", "conversationSummary"]);
  assert.ok(projected.conversationSummary.length < 6000);
  assert.ok(!/secret|evidence|do not send/u.test(projected.conversationSummary));
  assert.equal(projectJevIntentInput({ ...request, startNewTask: true }).conversationSummary, "");
});

test("observer is off by default and invalid modes fail closed", async () => {
  let calls = 0;
  const observer = createJevIntentObserver({ env: { TYPESAFE_API_KEY: "secret" }, fetchImpl: () => { calls++; } });
  await observer.observe({ input: "x" });
  assert.equal(calls, 0);
  assert.deepEqual(observer.snapshot().counts, {});
  assert.throws(() => createJevIntentObserver({ mode: "invalid" }));
});

test("deterministic domain comparison is observational and contains no user text", async () => {
  assert.deepEqual(inferJevDeterministicDomain({ input: "云顶之弈羊刀有什么效果？" }), {
    domain: "tft", confidence: 0.99, source: "tft_domain_pattern"
  });
  const events = [];
  const observer = createJevIntentObserver({ mode: "shadow", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => response({ domain: "out_of_domain" }) }),
    onObservation: event => events.push(event) });
  await observer.observe({ input: "云顶之弈羊刀有什么效果？" });
  assert.equal(events[0].domainAgreement, false);
  assert.equal(events[0].deterministicDomain.domain, "tft");
  assert.deepEqual(observer.snapshot().domainComparisons, { agreement: 0, disagreement: 1, unavailable: 0 });
  assert.ok(!JSON.stringify(events[0]).includes("羊刀"));
});

test("control projection is confidence-gated and contains no tool authority", () => {
  const observed = { status: "observed", ...response({ action: "compare" }) };
  assert.deepEqual(projectJevIntentControl(observed), {
    disposition: "control_eligible",
    advisory: {
      schemaVersion: "jev-intent-control.v1",
      action: "compare",
      domain: "tft",
      context: "self_contained",
      confidence: { action: 1, domain: 1, context: 1 },
      domainResolution: "jev_direct",
      authority: "intent_hint_only"
    }
  });
  const low = structuredClone(observed);
  low.answers.action.confidence = 0.6;
  low.answers.action.probabilities.compare = 0.6;
  low.answers.action.probabilities.unknown = 0.4;
  assert.equal(projectJevIntentControl(low).disposition, "low_action_confidence");
  assert.equal(projectJevIntentControl(low).advisory, null);
  assert.equal(Object.hasOwn(projectJevIntentControl(observed).advisory, "tool"), false);
});

test("observer bounds concurrency, survives telemetry failures and releases timed out slots", async () => {
  let calls = 0;
  const observer = createJevIntentObserver({ mode: "shadow", apiKey: "secret", timeoutMs: 15,
    fetchImpl: () => { calls++; return new Promise(() => {}); },
    onObservation: () => { throw new Error("observer failed"); } });
  const jobs = Array.from({ length: 5 }, () => observer.observe({ input: "x" }));
  const results = await Promise.all(jobs);
  assert.equal(calls, 4);
  assert.equal(results[4].reason, "concurrency_limit");
  assert.equal(observer.snapshot().inFlight, 0);
  assert.equal(observer.snapshot().counts.timeout, 4);
  assert.ok(!JSON.stringify(observer.snapshot()).includes("secret"));
});

test("ReAct shadow is parallel, observes original input and cannot change LLM input or response", async () => {
  let release;
  let observed;
  const observation = new Promise(resolve => { observed = resolve; });
  let shadowBody;
  const states = [];
  const options = { cacheStore: new MemoryCacheStore(), env: {}, reactDecisionProvider: async request => {
    states.push(structuredClone(request.state));
    return { schemaVersion: "react-action.v1", type: "finish", answer: "原有回答", evidenceIds: [], reasonCode: "direct_answer" };
  } };
  const off = createSmallWindowRuntime(options);
  const on = createSmallWindowRuntime({ ...options,
    env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_MODE: "shadow" },
    jevIntentFetch: async (_url, init) => {
      shadowBody = JSON.parse(init.body);
      await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => response({ domain: "out_of_domain" }) };
    }, onJevIntentObservation: observed });
  const input = { input: "沃里克怎么玩？", locale: "zh-CN", seasonContextId: DEFAULT_SEASON_CONTEXT_ID };
  const baseline = await handleReactChatRequest(input, off);
  const shadow = await handleReactChatRequest(input, on);
  assert.equal(shadow.statusCode, baseline.statusCode);
  assert.equal(shadow.payload.status, baseline.payload.status);
  assert.deepEqual(states[1].messages, states[0].messages);
  assert.equal(states[1].question, states[0].question);
  assert.equal(shadowBody.state.input, input.input);
  assert.equal(on.jevIntentObserver.snapshot().inFlight, 1);
  release();
  const event = await observation;
  assert.equal(event.candidate.action, null);
  assert.equal(event.actionAgreement, null); // No invented baseline comparison.
  assert.ok(!JSON.stringify(event).includes(input.input));
});

test("outcome projection keeps only bounded execution metadata", async () => {
  const outcomes = [];
  const observer = createJevIntentObserver({ mode: "control", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => response({ action: "explain" }) }),
    onOutcome: event => outcomes.push(event) });
  const observation = await observer.observe({ input: "云顶之弈羊刀有什么效果？" });
  observer.recordOutcome(observation, {
    status: "completed", terminationReason: "completed", answerOrigin: "model",
    answer: "sensitive answer", evidence: [{ value: "sensitive evidence" }],
    safetyMetrics: { decisions: 2, actualToolCalls: 1 }
  }, [
    { type: "call_tool", tool: "item_details", purposeCode: "retrieve_entity_details",
      arguments: { item: "sensitive argument" } },
    { type: "finish", answer: "sensitive answer" }
  ]);
  assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0].toolNames, ["item_details"]);
  assert.equal(outcomes[0].firstDecision.tool, "item_details");
  assert.equal(outcomes[0].finalDecision.type, "finish");
  assert.equal(outcomes[0].actualToolCalls, 1);
  assert.equal(outcomes[0].evidenceCount, 1);
  assert.ok(!/sensitive/u.test(JSON.stringify(outcomes[0])));
});

test("ReAct control passes only a bounded intent hint and preserves the registered tool catalog", async () => {
  let decisionRequest;
  let baselineToolNames;
  const outcomes = [];
  const input = { input: "找一个云顶教学视频", locale: "zh-CN", seasonContextId: DEFAULT_SEASON_CONTEXT_ID };
  const baselineRuntime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(), env: {},
    reactDecisionProvider: async request => {
      baselineToolNames = request.toolCatalog.map(tool => tool.name);
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原有回答", evidenceIds: [], reasonCode: "direct_answer" };
    } });
  await handleReactChatRequest(input, baselineRuntime);
  const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_MODE: "control",
      TFT_AGENT_JEV_INTENT_SAMPLE_RATE: "1", TFT_AGENT_JEV_INTENT_CONTROL_MIN_CONFIDENCE: "0.7" },
    jevIntentFetch: async () => ({ ok: true, json: async () => response({ action: "find_video" }) }),
    onJevIntentObservation: () => {},
    onJevIntentOutcome: event => outcomes.push(event),
    reactDecisionProvider: async request => {
      decisionRequest = structuredClone(request);
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原有回答", evidenceIds: [], reasonCode: "direct_answer" };
    } });
  const result = await handleReactChatRequest(input, runtime);
  assert.equal(result.statusCode, 200);
  assert.equal(decisionRequest.state.intentAdvisory.action, "find_video");
  assert.equal(decisionRequest.state.intentAdvisory.authority, "intent_hint_only");
  assert.equal(Object.hasOwn(decisionRequest.state.intentAdvisory, "tool"), false);
  assert.deepEqual(decisionRequest.toolCatalog.map(tool => tool.name), baselineToolNames);
  assert.equal(runtime.jevIntentObserver.snapshot().controlApplied, 1);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].schemaVersion, "jev-intent-outcome.v1");
  assert.equal(outcomes[0].observationId, 1);
  assert.equal(outcomes[0].controlApplied, true);
  assert.equal(outcomes[0].status, "completed");
  assert.equal(outcomes[0].firstDecision.type, "finish");
  assert.deepEqual(outcomes[0].toolNames, []);
  assert.ok(!JSON.stringify(outcomes[0]).includes(input.input));
  assert.deepEqual(runtime.jevIntentObserver.snapshot().outcomes, {
    recorded: 1, applied: 1, fallback: 0, withTools: 0, statuses: { completed: 1 }
  });
});

test("ReAct control falls back unchanged when Jev confidence is below the gate", async () => {
  let decisionState;
  const low = response({ action: "recommend" });
  low.answers.action.confidence = 0.6;
  low.answers.action.probabilities.recommend = 0.6;
  low.answers.action.probabilities.unknown = 0.4;
  const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_MODE: "control",
      TFT_AGENT_JEV_INTENT_SAMPLE_RATE: "1", TFT_AGENT_JEV_INTENT_CONTROL_MIN_CONFIDENCE: "0.7" },
    jevIntentFetch: async () => ({ ok: true, json: async () => low }),
    onJevIntentObservation: () => {},
    reactDecisionProvider: async request => {
      decisionState = structuredClone(request.state);
      return { schemaVersion: "react-action.v1", type: "finish", answer: "回退回答", evidenceIds: [], reasonCode: "direct_answer" };
    } });
  const result = await handleReactChatRequest({ input: "你好", locale: "zh-CN",
    seasonContextId: DEFAULT_SEASON_CONTEXT_ID }, runtime);
  assert.equal(result.payload.answer, "回退回答");
  assert.equal(Object.hasOwn(decisionState, "intentAdvisory"), false);
  assert.deepEqual(runtime.jevIntentObserver.snapshot().controlFallbacks, { low_action_confidence: 1 });
});
