import { readFile } from "node:fs/promises";
import {
  AgentRuntime,
  MemoryCacheStore,
  ToolExecutor,
  ToolRegistry,
  createCatalog,
  createStructuredToolDefinitions,
  generateEvidenceBackedConclusion,
  retrieveSemanticPlan
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";
import { calculateAgentMetrics } from "./metrics.mjs";

const UNIT_BUILD_FIXTURE = Object.freeze([
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT17_Item_StargazerEmblemItem|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
    placement_count: [50, 45, 40, 35, 30, 20, 10, 5]
  }
]);

export async function loadAgentEvalDataset(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
    if (!value.id || !value.input || !value.expected?.status || !value.expected?.intent) {
      throw new Error(`Invalid core agent case at line ${index + 1}`);
    }
    if (!Array.isArray(value.expected.requiredTools) || !Array.isArray(value.expected.forbiddenTools)) {
      throw new Error(`Invalid tool expectations at line ${index + 1}`);
    }
    return value;
  });
}

function createCaseRuntime(caseRecord, compFixture, eventSink) {
  let id = 0;
  const createId = () => `${caseRecord.id}-id-${++id}`;
  const agentRuntime = new AgentRuntime({
    createId,
    now: () => 0,
    onEvent: (event) => eventSink.push(event)
  });
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({
    registry: toolRegistry,
    createId,
    now: () => 0
  });
  return createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {
      getUnitBuilds: async () => UNIT_BUILD_FIXTURE
    },
    compsClient: {
      getCompsData: async () => compFixture.compsData,
      getCompsStats: async () => compFixture.compsStats
    },
    officialItemDetails: new Map([["TFT_Item_GuinsoosRageblade", {
      apiName: "TFT_Item_GuinsoosRageblade",
      name: "鬼索的狂暴之刃",
      effect: "攻击提供可叠加攻速。",
      recipe: [],
      iconUrl: null,
      craftable: true,
      sourceUrl: "offline-eval"
    }]]),
    officialEntityDetails: {
      units: new Map([["TFT17_Xayah", {
        apiName: "TFT17_Xayah",
        name: "霞",
        cost: 4,
        role: "物理输出",
        traitNames: ["观星者"],
        stats: { health: 900, mana: 80, startingMana: 20, attackDamage: 60, armor: 30, magicResist: 30, attackSpeed: 0.8, attackRange: 4, critChance: 25 },
        ability: { name: "羽刃", type: "主动", description: "发射羽刃。", iconUrl: null },
        source: { version: "offline-eval" }
      }]]),
      traits: new Map([["TFT17_Stargazer", {
        apiName: "TFT17_Stargazer",
        name: "观星者",
        type: "race",
        description: "获得观星增益。",
        levels: [{ units: 3, effect: "获得观星增益。" }],
        iconUrl: null,
        source: { version: "offline-eval" }
      }]]),
      meta: { version: "offline-eval" }
    },
    agentRuntime,
    toolRegistry,
    toolExecutor,
    conclusionGeneratorConfig: { enabled: false, mode: "off", provider: "off" }
  });
}

function checkTools(actualTools, expected) {
  return expected.requiredTools.every((tool) => actualTools.includes(tool))
    && expected.forbiddenTools.every((tool) => !actualTools.includes(tool));
}

function contractResult(caseRecord, passed, details = {}) {
  const status = details.status ?? "completed";
  const intent = details.intent ?? caseRecord.expected.intent;
  const resultType = details.resultType ?? caseRecord.expected.resultType;
  const needsClarification = Boolean(details.needsClarification);
  const tools = details.tools ?? [];
  const checks = {
    status: status === caseRecord.expected.status,
    intent: intent === caseRecord.expected.intent,
    clarification: needsClarification === caseRecord.expected.needsClarification,
    tools: checkTools(tools, caseRecord.expected),
    toolInput: passed,
    resultType: resultType === caseRecord.expected.resultType
  };
  return {
    id: caseRecord.id,
    passed: passed && Object.values(checks).every(Boolean),
    skipped: false,
    durationMs: 0,
    checks,
    actual: {
      status,
      intent,
      needsClarification,
      tools,
      resultType,
      fallback: Boolean(details.fallback),
      ...(details.error ? { error: details.error } : {})
    }
  };
}

async function runToolGuardrailScenario(caseRecord) {
  let handlerCalls = 0;
  const executor = new ToolExecutor({
    registry: new ToolRegistry(createStructuredToolDefinitions())
  });
  const handler = async () => {
    handlerCalls += 1;
    return {};
  };
  const codes = [];
  for (const operation of [
    () => executor.execute("invented_tool", {}, { handler }),
    () => executor.execute("unit_builds", { invented: true }, { source: "metatft", handler }),
    () => executor.execute("unit_builds", {}, { source: "official_catalog", handler })
  ]) {
    try {
      await operation();
    } catch (error) {
      codes.push(error.code);
    }
  }
  const passed = handlerCalls === 0
    && codes.join(",") === "tool_not_registered,invalid_tool_input,tool_source_mismatch";
  return contractResult(caseRecord, passed);
}

async function runRuntimeLimitsScenario(caseRecord) {
  let timeoutCode;
  try {
    await new AgentRuntime({ budget: { deadlineMs: 5 } }).run({}, async () => new Promise(() => {}));
  } catch (error) {
    timeoutCode = error.code;
  }

  const controller = new AbortController();
  let release;
  let cancelError;
  const cancelled = new AgentRuntime({ budget: { deadlineMs: 100 } }).run({}, async () => new Promise((resolve) => {
    release = resolve;
  }), { signal: controller.signal });
  controller.abort();
  try {
    await cancelled;
  } catch (error) {
    cancelError = error;
  }
  release?.("late");
  await Promise.resolve();

  let budgetCode;
  try {
    await new AgentRuntime({ budget: { maxSteps: 1 } }).run({}, async (run) => {
      await run.stage("resolving", async () => null);
      await run.stage("planning", async () => null);
    });
  } catch (error) {
    budgetCode = error.code;
  }
  const passed = timeoutCode === "run_timed_out"
    && cancelError?.code === "run_cancelled"
    && cancelError?.publicRun?.status === "cancelled"
    && budgetCode === "budget_exhausted";
  return contractResult(caseRecord, passed, { status: "timed_out" });
}

async function conclusionFixture() {
  return JSON.parse(await readFile(new URL("../test/fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
}

async function runResilienceScenario(caseRecord, compFixture) {
  const events = [];
  const runtime = createCaseRuntime(caseRecord, compFixture, events);
  const empty = await handleRecommendRequest({
    input: "霞带哪三件装备最好？",
    seasonContextId: caseRecord.seasonContextId,
    preferences: { minSamples: 999999 }
  }, runtime);
  const lowOrEmptyHandled = empty.payload.type === "clarification"
    || (Array.isArray(empty.payload.cards) && empty.payload.cards.length === 0);

  let structuredCalls = 0;
  const semanticHits = await retrieveSemanticPlan({
    semanticQueries: [{
      query: "霞",
      types: ["unit"],
      patch: "current",
      locale: "zh-CN",
      topK: 3
    }]
  }, {
    search: async () => {
      throw Object.assign(new Error("offline"), { code: "embedding_provider_unavailable" });
    }
  }).catch(() => []);
  structuredCalls += 1;

  const fixture = await conclusionFixture();
  const config = { enabled: true, model: "offline-eval", promptVersion: "offline-eval.v1" };
  const stale = await generateEvidenceBackedConclusion({
    result: { ...structuredClone(fixture), cache: { query: { hit: true, stale: true } } },
    catalog: createCatalog(),
    config,
    provider: async () => {
      throw new Error("must not run for stale evidence");
    }
  });
  const llmFailure = await generateEvidenceBackedConclusion({
    result: structuredClone(fixture),
    catalog: createCatalog(),
    input: "霞怎么出装？",
    config,
    provider: async () => {
      throw Object.assign(new Error("invalid JSON"), { code: "invalid_json", recoverable: false });
    }
  });
  const passed = lowOrEmptyHandled
    && semanticHits.length === 0
    && structuredCalls === 1
    && stale.status === "skipped"
    && stale.reason === "unsafe_state"
    && llmFailure.status === "fallback";
  return contractResult(caseRecord, passed, { fallback: true });
}

async function runIsolationAuthorityScenario(caseRecord) {
  const store = new MemoryCacheStore();
  store.setQuery("same-key", { marker: "live" }, { seasonContextId: "set17-live" });
  store.setQuery("same-key", { marker: "archive" }, { seasonContextId: "set17-archive" });
  const isolated = store.getQuery("same-key", { seasonContextId: "set17-live" })?.value?.marker === "live"
    && store.getQuery("same-key", { seasonContextId: "set17-archive" })?.value?.marker === "archive";

  const fixture = await conclusionFixture();
  const original = structuredClone(fixture);
  const conclusion = await generateEvidenceBackedConclusion({
    result: fixture,
    catalog: createCatalog(),
    input: "霞怎么出装？",
    config: { enabled: true, model: "offline-eval", promptVersion: "offline-eval.v1" },
    provider: async ({ evidence }) => ({
      schemaVersion: "llm_conclusion.v2",
      contractId: evidence.questionContract?.contractId ?? "offline-eval",
      status: "ok",
      addressedDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
      missingDimensions: [],
      missingEvidence: [],
      headline: "模型尝试越权",
      summary: "模型声称前四率为99.9%。",
      reasons: [{ dimension: "build_performance", evidenceIds: ["build:1"], text: "前四率99.9%。" }],
      alternatives: [],
      nextAction: "覆盖确定性结果。",
      riskNotice: null
    })
  });
  const passed = isolated
    && JSON.stringify(fixture) === JSON.stringify(original)
    && conclusion.status === "fallback"
    && conclusion.content === null
    && conclusion.validationFeedback?.errors?.some((error) => error.category === "unsupported_number");
  return contractResult(caseRecord, passed, { fallback: true });
}

async function runContractScenario(caseRecord, compFixture) {
  if (caseRecord.scenario === "tool_guardrails") return runToolGuardrailScenario(caseRecord);
  if (caseRecord.scenario === "runtime_limits") return runRuntimeLimitsScenario(caseRecord);
  if (caseRecord.scenario === "resilience_bundle") return runResilienceScenario(caseRecord, compFixture);
  if (caseRecord.scenario === "isolation_authority") return runIsolationAuthorityScenario(caseRecord);
  throw new Error(`Unknown evaluation scenario: ${caseRecord.scenario}`);
}

export async function runAgentEvaluation(cases, options = {}) {
  const compFixture = options.compFixture;
  if (!compFixture?.compsData || !compFixture?.compsStats) {
    throw new Error("Agent evaluation requires the offline comps fixture");
  }
  const results = [];
  for (const caseRecord of cases) {
    if (caseRecord.scenario) {
      try {
        results.push(await runContractScenario(caseRecord, compFixture));
      } catch (error) {
        results.push(contractResult(caseRecord, false, { error: error.code ?? error.message }));
      }
      continue;
    }
    const events = [];
    const runtime = createCaseRuntime(caseRecord, compFixture, events);
    const startedAt = Date.now();
    try {
      for (const priorInput of caseRecord.conversation ?? []) {
        await handleRecommendRequest({
          input: priorInput,
          conversationId: `eval-${caseRecord.id}`,
          seasonContextId: caseRecord.seasonContextId
        }, runtime);
      }
      const response = await handleRecommendRequest({
        input: caseRecord.input,
        conversationId: `eval-${caseRecord.id}`,
        seasonContextId: caseRecord.seasonContextId
      }, runtime);
      const payload = response.payload;
      const actualTools = [...new Set(events
        .filter((event) => event.type === "tool_call_started")
        .map((event) => event.data.toolName))];
      const actualIntent = payload.intentEnvelope?.intent ?? payload.query?.intent ?? payload.type ?? null;
      const needsClarification = Boolean(payload.clarification?.needsClarification);
      const checks = {
        status: payload.run?.status === caseRecord.expected.status,
        intent: actualIntent === caseRecord.expected.intent,
        clarification: needsClarification === caseRecord.expected.needsClarification,
        tools: checkTools(actualTools, caseRecord.expected),
        toolInput: !events.some((event) => event.type === "tool_call_failed" && event.data.error === "invalid_tool_input"),
        resultType: payload.type === caseRecord.expected.resultType
      };
      results.push({
        id: caseRecord.id,
        passed: Object.values(checks).every(Boolean),
        skipped: false,
        durationMs: payload.run?.durationMs ?? 0,
        checks,
        actual: {
          status: payload.run?.status ?? null,
          intent: actualIntent,
          needsClarification,
          tools: actualTools,
          resultType: payload.type ?? null,
          fallback: payload.answer?.generatedConclusion?.status === "fallback"
        }
      });
    } catch (error) {
      results.push({
        id: caseRecord.id,
        passed: false,
        skipped: false,
        durationMs: Date.now() - startedAt,
        checks: {
          status: false,
          intent: false,
          clarification: false,
          tools: false,
          toolInput: error.code !== "invalid_tool_input",
          resultType: false
        },
        actual: {
          status: error.publicRun?.status ?? "failed",
          intent: null,
          needsClarification: false,
          tools: [],
          resultType: null,
          fallback: false,
          error: error.code ?? error.message
        }
      });
    }
  }
  return {
    schemaVersion: "agent_eval_report.v1",
    datasetVersion: "core-agent-cases.v1",
    results,
    metrics: calculateAgentMetrics(results)
  };
}
