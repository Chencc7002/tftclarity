import { mkdir, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  CURRENT_ITEM_LOCALIZATION,
  MemoryCacheStore,
  buildItemCatalogFromItemsResponse,
  buildUnitCatalogFromExplorerRows,
  createCatalog
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  createSmallWindowServer
} from "../src/app/small-window-server.js";
import { CompsContextClient, MetaTFTClient } from "../src/data/metatft-client.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = {
    level: "all",
    vus: "20,50,100",
    stampedeVus: 50,
    durationSec: 6,
    label: "run",
    target: null,
    maxRequests: 30,
    outputDir: ".cache/load-test"
  };
  for (const arg of argv) {
    if (arg.startsWith("--level=")) args.level = arg.slice("--level=".length).toLowerCase();
    else if (arg.startsWith("--vus=")) args.vus = arg.slice("--vus=".length);
    else if (arg.startsWith("--stampede-vus=")) args.stampedeVus = Math.max(1, Number(arg.slice("--stampede-vus=".length)) || 50);
    else if (arg.startsWith("--duration=")) args.durationSec = Math.max(1, Number(arg.slice("--duration=".length)) || 6);
    else if (arg.startsWith("--label=")) args.label = arg.slice("--label=".length).replace(/[^a-zA-Z0-9_-]/g, "_");
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length).replace(/\/+$/, "");
    else if (arg.startsWith("--max-requests=")) args.maxRequests = Math.max(1, Number(arg.slice("--max-requests=".length)) || 30);
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
  }
  return args;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

function summarizeLatencies(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    minMs: sorted.length ? Number(sorted[0].toFixed(2)) : 0,
    avgMs: sorted.length ? Number((sum / sorted.length).toFixed(2)) : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : 0
  };
}

function buildLoadTestFixture() {
  const compPageFixture = JSON.parse(readFileSync(
    new URL("../test/fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
    "utf8"
  ));
  compPageFixture.compsData.results.data.comps = {
    "409002": { "Average Placement Change": -0.31 },
    "409003": { "Average Placement Change": 0.25 },
    "409019": { "Average Placement Change": -0.14 },
    "409092": { "Average Placement Change": 0.09 }
  };
  const visualUnitApiNames = [...new Set(Object.values(
    compPageFixture.compsData.results.data.cluster_details
  ).flatMap((comp) => String(comp.units_string ?? "").split(/,\s*/).filter(Boolean)))];

  const baseItems = buildItemCatalogFromItemsResponse({
    data: CURRENT_ITEM_LOCALIZATION.items.map((item) => ({ items: item.apiName }))
  }, { patch: "current" });

  const s19Units = buildUnitCatalogFromExplorerRows({
    data: [...visualUnitApiNames, "DA_Smeech19", "DA_DrMundo19", "TFT17_Xayah"].map((apiName) => ({
      units_unique: `${apiName}-1`,
      placement_count: [20, 18, 16, 14, 12, 10, 8, 6]
    }))
  }, { patch: "current" }).map((u) => u.apiName === "DA_Smeech19"
    ? { ...u, zhName: "史密奇", enName: "Smeech19", cost: 7, current: true }
    : u);

  const emblemItems = [
    { apiName: "DA_Arcanist19_Emblem", zhName: "法师纹章", enName: "Arcanist Emblem", category: "emblem", current: true, obtainable: true },
    { apiName: "DA_Bodyguard19_Emblem", zhName: "保镖纹章", enName: "Bodyguard Emblem", category: "emblem", current: true, obtainable: true },
    { apiName: "DA_Frontman19_Emblem", zhName: "主唱纹章", enName: "Frontman Emblem", category: "emblem", current: true, obtainable: true }
  ];

  const catalog = createCatalog({
    units: s19Units,
    items: [...baseItems, ...emblemItems]
  });

  const itemDetails = new Map([
    ["DA_Arcanist19_Emblem", { apiName: "DA_Arcanist19_Emblem", name: "法师纹章", recipe: [{ apiName: "TFT_Item_Spatula" }, { apiName: "TFT_Item_NeedlesslyLargeRod" }] }],
    ["DA_Bodyguard19_Emblem", { apiName: "DA_Bodyguard19_Emblem", name: "保镖纹章", recipe: [{ apiName: "TFT_Item_FryingPan" }, { apiName: "TFT_Item_ChainVest" }] }],
    ["DA_Frontman19_Emblem", { apiName: "DA_Frontman19_Emblem", name: "主唱纹章", recipe: [{ apiName: "TFT_Item_FryingPan" }, { apiName: "TFT_Item_GiantsBelt" }] }]
  ]);

  return { compPageFixture, catalog, itemDetails };
}

async function createMockProductionServer({ upstreamDelayMs = 120, llmDelayMs = 450 } = {}) {
  const { compPageFixture, catalog, itemDetails } = buildLoadTestFixture();
  const counters = {
    compsData: 0,
    compsStats: 0,
    emblemItems: 0,
    unitBuilds: 0,
    llmCalls: 0,
    maxConcurrentUpstream: 0,
    activeUpstream: 0,
    maxConcurrentLlm: 0,
    activeLlm: 0
  };

  const trackUpstream = async (bucket, fn) => {
    counters[bucket] += 1;
    counters.activeUpstream += 1;
    if (counters.activeUpstream > counters.maxConcurrentUpstream) {
      counters.maxConcurrentUpstream = counters.activeUpstream;
    }
    try {
      await sleep(upstreamDelayMs);
      return fn();
    } finally {
      counters.activeUpstream -= 1;
    }
  };

  const mockFetch = async (urlLike) => {
    const url = String(urlLike);
    if (url.includes("/tft-comps-api/comps_data")) {
      const data = await trackUpstream("compsData", () => compPageFixture.compsData);
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/tft-comps-api/comps_stats")) {
      const data = await trackUpstream("compsStats", () => compPageFixture.compsStats);
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/tft-explorer-api/items")) {
      const excluded = url.includes("DA_Smeech19");
      const data = await trackUpstream("emblemItems", () => ({
        data: [
          { items: "DA_Arcanist19_Emblem", placement_count: excluded ? [120, 140, 160, 180, 190, 170, 140, 100] : [260, 220, 190, 160, 120, 90, 60, 40] },
          { items: "DA_Bodyguard19_Emblem", placement_count: excluded ? [150, 160, 170, 170, 160, 130, 100, 60] : [300, 240, 200, 150, 110, 80, 50, 30] },
          { items: "DA_Frontman19_Emblem", placement_count: excluded ? [240, 200, 180, 160, 130, 90, 60, 40] : [180, 170, 160, 160, 150, 120, 90, 70] }
        ]
      }));
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
    const data = await trackUpstream("unitBuilds", () => ({ data: [] }));
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  };

  const metaTFTClient = new MetaTFTClient({ fetchImpl: mockFetch, timeoutMs: 8000 });
  const compsClient = new CompsContextClient({ fetchImpl: mockFetch, timeoutMs: 8000, rankingsTimeoutMs: 8000 });

  const reactDecisionProvider = async () => {
    counters.llmCalls += 1;
    counters.activeLlm += 1;
    if (counters.activeLlm > counters.maxConcurrentLlm) {
      counters.maxConcurrentLlm = counters.activeLlm;
    }
    try {
      await sleep(llmDelayMs);
      return {
        action: {
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "当前 S19 PBE 环境下优先围绕主流高前四率体系过渡，结合来牌决定主 C 装备。",
          evidenceIds: [],
          reasonCode: "direct_answer",
          narrative: null
        },
        telemetry: {
          status: "ok",
          model: "mock-flash",
          durationMs: llmDelayMs,
          attempts: 1,
          usage: { cachedInputTokens: 2800, uncachedInputTokens: 350, outputTokens: 64 }
        }
      };
    } finally {
      counters.activeLlm -= 1;
    }
  };
  reactDecisionProvider.providerKind = "react_decision_llm";
  reactDecisionProvider.model = "mock-flash";

  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore,
    fetchItems: false,
    officialItemDetails: itemDetails,
    metaTFTClient,
    compsClient,
    reactChatMode: "on",
    reactDecisionProvider
  });

  const server = createSmallWindowServer({ runtime });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    counters,
    runtime,
    resetCounters() {
      counters.compsData = 0;
      counters.compsStats = 0;
      counters.emblemItems = 0;
      counters.unitBuilds = 0;
      counters.llmCalls = 0;
      counters.maxConcurrentUpstream = 0;
      counters.maxConcurrentLlm = 0;
    },
    async close() {
      server.closeIdleConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

async function issueScenarioRequest(baseUrl, bucket, seq) {
  const started = performance.now();
  let ttftMs = null;
  let status = 0;
  try {
    if (bucket === "quick_comp") {
      const res = await fetch(`${baseUrl}/api/recommend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: "查询热门阵容排行",
          seasonContextId: "set19-pbe",
          preferences: { conclusionMode: "off" },
          quickTask: {
            schemaVersion: "quick-task.v1",
            requestId: `lt-comp-${seq}`,
            id: "comp-rankings",
            operation: "comp_rankings",
            arguments: {}
          }
        })
      });
      status = res.status;
      await res.text();
    } else if (bucket === "quick_emblem" || bucket === "quick_emblem_excl") {
      const excludeUnits = bucket === "quick_emblem_excl" ? ["DA_Smeech19"] : [];
      const res = await fetch(`${baseUrl}/api/recommend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: "查询可合成转职强度排行",
          seasonContextId: "set19-pbe",
          preferences: { conclusionMode: "off" },
          quickTask: {
            schemaVersion: "quick-task.v1",
            requestId: `lt-emb-${seq}`,
            id: "emblem-rankings",
            operation: "emblem_rankings",
            arguments: excludeUnits.length ? { excludeUnits } : {}
          }
        })
      });
      status = res.status;
      await res.text();
    } else if (bucket === "catalog") {
      const path = seq % 2 === 0
        ? "/api/item-icons?seasonContextId=set19-pbe"
        : "/api/entity-catalog?type=unit&seasonContextId=set19-pbe&limit=50";
      const res = await fetch(`${baseUrl}${path}`);
      status = res.status;
      await res.text();
    } else {
      const res = await fetch(`${baseUrl}/api/react-chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: "当前版本简单运营思路是什么？",
          seasonContextId: "set19-pbe",
          conversationId: `lt-react-${seq}`
        })
      });
      status = res.status;
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ttftMs === null && value?.byteLength > 0) {
            ttftMs = performance.now() - started;
          }
        }
      } else {
        await res.text();
      }
    }
    const latencyMs = performance.now() - started;
    return { ok: status >= 200 && status < 300, status, bucket, latencyMs, ttftMs };
  } catch (error) {
    return {
      ok: false,
      status,
      bucket,
      latencyMs: performance.now() - started,
      ttftMs,
      error: String(error?.message ?? error)
    };
  }
}

function pickMixBucket(seq) {
  const mod = seq % 10;
  if (mod < 3) return "quick_comp";
  if (mod < 5) return "quick_emblem";
  if (mod === 5) return "quick_emblem_excl";
  if (mod < 8) return "catalog";
  return "react_stream";
}

async function runL1Stage(vus, durationSec) {
  const harness = await createMockProductionServer({ upstreamDelayMs: 120, llmDelayMs: 450 });
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const rssStartMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  let rssPeakMb = rssStartMb;
  const memTimer = setInterval(() => {
    const current = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
    if (current > rssPeakMb) rssPeakMb = current;
  }, 250);

  const results = [];
  let seq = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationSec * 1000;

  const worker = async () => {
    while (performance.now() < deadline) {
      seq += 1;
      const bucket = pickMixBucket(seq);
      results.push(await issueScenarioRequest(harness.baseUrl, bucket, seq));
    }
  };

  await Promise.all(Array.from({ length: vus }, () => worker()));
  const elapsedSec = Math.max(0.001, (performance.now() - startedAt) / 1000);
  clearInterval(memTimer);
  loopDelay.disable();
  const rssEndMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));

  const upstreamSnapshot = { ...harness.counters };
  await harness.close();

  const okCount = results.filter((r) => r.ok).length;
  const busy503 = results.filter((r) => r.status === 503).length;
  const errorCount = results.length - okCount;
  const byBucket = {};
  for (const name of ["quick_comp", "quick_emblem", "quick_emblem_excl", "catalog", "react_stream"]) {
    const items = results.filter((r) => r.bucket === name);
    byBucket[name] = {
      ...summarizeLatencies(items.map((r) => r.latencyMs)),
      errors: items.filter((r) => !r.ok).length,
      busy503: items.filter((r) => r.status === 503).length
    };
  }
  const quickLatencies = results
    .filter((r) => r.bucket.startsWith("quick_"))
    .map((r) => r.latencyMs);
  const reactTtft = results
    .filter((r) => r.bucket === "react_stream" && r.ttftMs != null)
    .map((r) => r.ttftMs);

  return {
    vus,
    durationSec: Number(elapsedSec.toFixed(2)),
    totalRequests: results.length,
    qps: Number((results.length / elapsedSec).toFixed(2)),
    okCount,
    errorCount,
    busy503,
    errorRatePct: results.length ? Number(((errorCount / results.length) * 100).toFixed(2)) : 0,
    overall: summarizeLatencies(results.map((r) => r.latencyMs)),
    quickTask: summarizeLatencies(quickLatencies),
    reactTtft: summarizeLatencies(reactTtft),
    byBucket,
    eventLoopLagMs: {
      p50: Number((loopDelay.percentile(50) / 1e6).toFixed(2)),
      p95: Number((loopDelay.percentile(95) / 1e6).toFixed(2)),
      p99: Number((loopDelay.percentile(99) / 1e6).toFixed(2)),
      max: Number((loopDelay.max / 1e6).toFixed(2))
    },
    memoryRssMb: { start: rssStartMb, peak: rssPeakMb, end: rssEndMb },
    upstream: upstreamSnapshot
  };
}

async function runL2Stampede(vus) {
  const harness = await createMockProductionServer({ upstreamDelayMs: 180, llmDelayMs: 300 });
  const runBurst = async (name, bucket) => {
    harness.resetCounters();
    const started = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: vus }, (_, i) => issueScenarioRequest(harness.baseUrl, bucket, i + 1))
    );
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    return {
      name,
      vus,
      elapsedMs,
      okCount: outcomes.filter((r) => r.ok).length,
      errorCount: outcomes.filter((r) => !r.ok).length,
      latency: summarizeLatencies(outcomes.map((r) => r.latencyMs)),
      upstreamCalls: {
        compsData: harness.counters.compsData,
        compsStats: harness.counters.compsStats,
        emblemItems: harness.counters.emblemItems,
        maxConcurrentUpstream: harness.counters.maxConcurrentUpstream
      }
    };
  };

  const coldComp = await runBurst("cold_comp_rankings", "quick_comp");
  const warmComp = await runBurst("warm_comp_rankings", "quick_comp");
  const coldEmblemDefault = await runBurst("cold_emblem_default", "quick_emblem");
  const coldEmblemExcludeSmeech = await runBurst("cold_emblem_exclude_smeech", "quick_emblem_excl");
  const warmEmblemExcludeSmeech = await runBurst("warm_emblem_exclude_smeech", "quick_emblem_excl");

  await harness.close();
  return {
    vus,
    bursts: [coldComp, warmComp, coldEmblemDefault, coldEmblemExcludeSmeech, warmEmblemExcludeSmeech]
  };
}

async function runL3Live({ target, vusList, maxRequests }) {
  if (!target) {
    throw new Error("L3 live load test requires --target=http://host:port");
  }
  const stages = [];
  let remaining = maxRequests;
  for (const vus of vusList) {
    if (remaining <= 0) break;
    const batchSize = Math.min(vus, remaining);
    remaining -= batchSize;
    const started = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: batchSize }, (_, i) => issueScenarioRequest(target, "react_stream", i + 1))
    );
    const elapsedSec = Math.max(0.001, (performance.now() - started) / 1000);
    stages.push({
      vus: batchSize,
      elapsedSec: Number(elapsedSec.toFixed(2)),
      okCount: outcomes.filter((r) => r.ok).length,
      errorCount: outcomes.filter((r) => !r.ok).length,
      status429: outcomes.filter((r) => r.status === 429).length,
      status503: outcomes.filter((r) => r.status === 503).length,
      latency: summarizeLatencies(outcomes.map((r) => r.latencyMs)),
      ttft: summarizeLatencies(outcomes.filter((r) => r.ttftMs != null).map((r) => r.ttftMs))
    });
  }
  return { target, maxRequests, stages };
}

function renderMarkdownReport(report) {
  const lines = [
    `# Load Test Report (${report.label})`,
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Level: ${report.level}`,
    ""
  ];
  if (report.l1) {
    lines.push("## L1 Process Concurrency", "");
    lines.push("| VUs | Total | QPS | Err% | 503 | Quick P95 (ms) | Overall P95 (ms) | EL Lag P99 (ms) | Peak RSS (MB) | MetaTFT Calls (comp+emblem) | Max Upstream Conc |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const s of report.l1) {
      const upstreamTotal = s.upstream.compsData + s.upstream.compsStats + s.upstream.emblemItems;
      lines.push(`| ${s.vus} | ${s.totalRequests} | ${s.qps} | ${s.errorRatePct}% | ${s.busy503} | ${s.quickTask.p95Ms} | ${s.overall.p95Ms} | ${s.eventLoopLagMs.p99} | ${s.memoryRssMb.peak} | ${upstreamTotal} | ${s.upstream.maxConcurrentUpstream} |`);
    }
    lines.push("");
  }
  if (report.l2) {
    lines.push("## L2 Cache Stampede Burst", "");
    lines.push("| Burst | VUs | OK/Err | P95 (ms) | compsData | compsStats | emblemItems | Max Upstream Conc |");
    lines.push("|---|---:|---|---:|---:|---:|---:|---:|");
    for (const b of report.l2.bursts) {
      lines.push(`| ${b.name} | ${b.vus} | ${b.okCount}/${b.errorCount} | ${b.latency.p95Ms} | ${b.upstreamCalls.compsData} | ${b.upstreamCalls.compsStats} | ${b.upstreamCalls.emblemItems} | ${b.upstreamCalls.maxConcurrentUpstream} |`);
    }
    lines.push("");
  }
  if (report.l3) {
    lines.push("## L3 Live Model Concurrency", "");
    lines.push("| VUs | OK/Err | 429 | 503 | TTFT P95 (ms) | Total P95 (ms) |");
    lines.push("|---:|---|---:|---:|---:|---:|");
    for (const s of report.l3.stages) {
      lines.push(`| ${s.vus} | ${s.okCount}/${s.errorCount} | ${s.status429} | ${s.status503} | ${s.ttft.p95Ms} | ${s.latency.p95Ms} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vusList = args.vus.split(",").map((v) => Number(v.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const report = {
    label: args.label,
    level: args.level,
    timestamp: new Date().toISOString()
  };

  if (args.level === "l1" || args.level === "all") {
    report.l1 = [];
    for (const vus of vusList) {
      report.l1.push(await runL1Stage(vus, args.durationSec));
    }
  }
  if (args.level === "l2" || args.level === "all") {
    report.l2 = await runL2Stampede(args.stampedeVus);
  }
  if (args.level === "l3") {
    const l3Vus = vusList.length ? vusList : [5, 15, 30];
    report.l3 = await runL3Live({ target: args.target, vusList: l3Vus, maxRequests: args.maxRequests });
  }

  const outDir = resolve(args.outputDir);
  await mkdir(outDir, { recursive: true });
  const baseName = `${args.label}-${args.level}`;
  const jsonPath = resolve(outDir, `${baseName}.json`);
  const mdPath = resolve(outDir, `${baseName}.md`);
  const md = renderMarkdownReport(report);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, md, "utf8");
  console.log(md);
  console.log(`Saved: ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
