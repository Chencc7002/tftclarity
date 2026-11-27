import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";

const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
if (envFileArg) {
  loadDotenv({ path: envFileArg.slice("--env-file=".length), quiet: true });
} else {
  loadLocalEnvironment();
}

// Reference unit pricing in USD per 1M tokens (DeepSeek official off-peak rates; peak is 2x).
const DEFAULT_PRICING_PER_1M = {
  "deepseek-v4-flash": { input: 0.15, cachedInput: 0.003, output: 0.60 },
  "deepseek-flash": { input: 0.15, cachedInput: 0.003, output: 0.60 },
  "deepseek-chat": { input: 0.27, cachedInput: 0.07, output: 1.10 },
  "qwen-turbo-latest": { input: 0.05, cachedInput: 0.01, output: 0.20 },
  "qwen3-flash": { input: 0.05, cachedInput: 0.01, output: 0.20 },
  "gemini-2.5-flash-lite": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gpt-4.1-nano": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gpt-4.1-mini": { input: 0.40, cachedInput: 0.10, output: 1.60 },
  "glm-4-flash": { input: 0.014, cachedInput: 0.014, output: 0.014 }
};

const BENCHMARK_CASES = [
  { id: "c01", category: "unit_build", question: "蒙多医生两星出什么装备最好？", expectedTools: ["entity_catalog_query", "unit_builds", "unit_builds_batch"] },
  { id: "c02", category: "unit_artifact", question: "蒙多医生带什么神器最合适？", expectedTools: ["entity_catalog_query", "unit_builds"] },
  { id: "c03", category: "emblem_ranking", question: "S19 金铲铲可合成转职排行前三是哪些？", expectedTools: ["emblem_rankings"] },
  { id: "c04", category: "emblem_exclude", question: "排除史密奇后 S19 转职强度怎么排？", expectedTools: ["entity_catalog_query", "emblem_rankings"] },
  { id: "c05", category: "comp_trends", question: "今天有哪些上升最快的阵容？", expectedTools: ["comps_trends"] },
  { id: "c06", category: "comp_analysis", question: "爵士乐希瓦娜现在还能玩吗？", expectedTools: ["comps_analysis", "comps_rankings"] },
  { id: "c07", category: "item_carriers", question: "羊刀这赛季最适合哪些棋子？", expectedTools: ["entity_catalog_query", "item_carrier_rankings"] },
  { id: "c08", category: "item_comparison", question: "霞带无尽还是巨杀更好？", expectedTools: ["entity_catalog_query", "unit_builds"] },
  { id: "c09", category: "tactical_pos", question: "古典乐锤石怎么站位，拿什么海克斯？", expectedTools: ["comps_rankings"] },
  { id: "c10", category: "direct_chat", question: "你好，你能帮我查什么？", expectedType: "finish" }
];

function parseArgs(argv) {
  const args = {
    live: false,
    models: "",
    endpoint: process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    outputDir: ".cache/model-benchmark"
  };
  for (const arg of argv) {
    if (arg === "--live") args.live = true;
    else if (arg.startsWith("--models=")) args.models = arg.slice("--models=".length);
    else if (arg.startsWith("--endpoint=")) args.endpoint = arg.slice("--endpoint=".length);
    else if (arg.startsWith("--api-key=")) args.apiKey = arg.slice("--api-key=".length);
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
  }
  return args;
}

function normalizeEndpoint(raw) {
  const value = String(raw ?? "").trim();
  if (/\/chat\/completions\/?$/iu.test(value)) return value.replace(/\/+$/u, "");
  return `${value.replace(/\/+$/u, "")}/chat/completions`;
}

export function estimateCostUsd(model, usage = {}, pricingTable = DEFAULT_PRICING_PER_1M) {
  const rate = pricingTable[model] ?? pricingTable["deepseek-v4-flash"];
  const cached = Number(usage.cachedInputTokens ?? 0);
  const uncached = Number(usage.uncachedInputTokens ?? 0);
  const output = Number(usage.outputTokens ?? 0);
  return (
    (cached * rate.cachedInput)
    + (uncached * rate.input)
    + (output * rate.output)
  ) / 1_000_000;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

function createMockFetchForModel(model) {
  let step = 0;
  return async (_url, init) => {
    step += 1;
    const body = JSON.parse(init.body);
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    const text = String(lastUser?.content ?? "");
    const action = text.includes("你能帮我查什么")
      ? { schemaVersion: "react-action.v1", type: "finish", answer: "我可以查询阵容排行、棋子出装、转职强度和装备对比。", evidenceIds: [], reasonCode: "direct_answer", narrative: null }
      : text.includes("上升最快")
        ? { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_trends", arguments: { direction: "rising" }, purposeCode: "retrieve_current_statistics" }
        : text.includes("转职")
          ? { schemaVersion: "react-action.v1", type: "call_tool", tool: "emblem_rankings", arguments: {}, purposeCode: "retrieve_current_statistics" }
          : text.includes("还能玩吗")
            ? { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_analysis", arguments: { mention: "爵士乐希瓦娜" }, purposeCode: "retrieve_current_statistics" }
            : text.includes("站位")
              ? { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_rankings", arguments: { mention: "古典乐锤石" }, purposeCode: "retrieve_current_statistics" }
              : { schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query", arguments: { entityType: "unit", filters: { names: ["蒙多医生"] } }, purposeCode: "retrieve_entity_details" };
    const cached = step === 1 ? 0 : 2850;
    const uncached = step === 1 ? 3100 : 260;
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify(action) } }],
          usage: {
            prompt_tokens: cached + uncached,
            prompt_cache_hit_tokens: cached,
            prompt_cache_miss_tokens: uncached,
            completion_tokens: 48
          }
        };
      }
    };
  };
}

async function evaluateModel(model, { live, endpoint, apiKey, toolCatalog }) {
  const logs = [];
  const provider = createReactDecisionProvider({
    endpoint: normalizeEndpoint(endpoint),
    model,
    apiKey: live ? apiKey : "mock-key",
    thinkingMode: "disabled",
    timeoutMs: 25_000,
    fetchImpl: live ? globalThis.fetch : createMockFetchForModel(model),
    onRequestLog: (entry) => logs.push(entry)
  });

  const durations = [];
  let validCount = 0;
  let firstAttemptValid = 0;
  let toolMatchCount = 0;
  let totalCached = 0;
  let totalUncached = 0;
  let totalOutput = 0;
  const errors = [];

  for (const item of BENCHMARK_CASES) {
    const started = performance.now();
    try {
      const res = await provider({
        state: {
          question: item.question,
          seasonContextId: "set19-pbe",
          locale: "zh-CN",
          evidence: [],
          transcript: []
        },
        toolCatalog
      });
      durations.push(performance.now() - started);
      validCount += 1;
      if (res.telemetry?.attempts === 1) firstAttemptValid += 1;
      const usage = res.telemetry?.usage ?? {};
      totalCached += Number(usage.cachedInputTokens ?? 0);
      totalUncached += Number(usage.uncachedInputTokens ?? 0);
      totalOutput += Number(usage.outputTokens ?? 0);

      const matched = item.expectedType
        ? res.action.type === item.expectedType
        : res.action.type === "call_tool" && item.expectedTools.includes(res.action.tool);
      if (matched) toolMatchCount += 1;
    } catch (error) {
      durations.push(performance.now() - started);
      errors.push(`${item.id}: ${String(error?.message ?? error).slice(0, 160)}`);
    }
  }

  const totalInput = totalCached + totalUncached;
  const cacheHitRatePct = totalInput > 0 ? Number(((totalCached / totalInput) * 100).toFixed(1)) : 0;
  const totalCostUsd = estimateCostUsd(model, {
    cachedInputTokens: totalCached,
    uncachedInputTokens: totalUncached,
    outputTokens: totalOutput
  });
  const costPer1kCallsUsd = Number(((totalCostUsd / BENCHMARK_CASES.length) * 1000).toFixed(4));

  return {
    model,
    cases: BENCHMARK_CASES.length,
    validRatePct: Number(((validCount / BENCHMARK_CASES.length) * 100).toFixed(1)),
    firstAttemptValidPct: Number(((firstAttemptValid / BENCHMARK_CASES.length) * 100).toFixed(1)),
    toolMatchPct: Number(((toolMatchCount / BENCHMARK_CASES.length) * 100).toFixed(1)),
    retries: logs.filter((entry) => entry.status === "retry").length,
    cacheHitRatePct,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    costPer1kCallsUsd,
    tokens: { cached: totalCached, uncached: totalUncached, output: totalOutput },
    errors
  };
}

function renderMarkdown(results, live) {
  const lines = [
    `# Model Cost & Quality Benchmark (${live ? "LIVE" : "MOCK DRY-RUN"})`,
    "",
    "| Model | First-Pass JSON% | Final Valid% | Tool Match% | Retries | KV Cache Hit% | P50 (ms) | P95 (ms) | Est. USD / 1k Calls |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const r of results) {
    lines.push(`| ${r.model} | ${r.firstAttemptValidPct}% | ${r.validRatePct}% | ${r.toolMatchPct}% | ${r.retries} | ${r.cacheHitRatePct}% | ${r.p50Ms} | ${r.p95Ms} | $${r.costPer1kCallsUsd} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const models = (args.models || "deepseek-v4-flash,qwen-turbo-latest,gemini-2.5-flash-lite,glm-4-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (args.live && !args.apiKey) {
    throw new Error("--live requires OPENAI_API_KEY or --api-key=...");
  }
  const toolCatalog = createStructuredToolDefinitions().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
  const results = [];
  for (const model of models) {
    results.push(await evaluateModel(model, {
      live: args.live,
      endpoint: args.endpoint,
      apiKey: args.apiKey,
      toolCatalog
    }));
  }

  const outDir = resolve(args.outputDir);
  await mkdir(outDir, { recursive: true });
  const md = renderMarkdown(results, args.live);
  const stamp = args.live ? "live" : "mock";
  await writeFile(resolve(outDir, `benchmark-${stamp}.json`), JSON.stringify({ live: args.live, results }, null, 2), "utf8");
  await writeFile(resolve(outDir, `benchmark-${stamp}.md`), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
