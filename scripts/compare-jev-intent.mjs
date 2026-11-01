import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveSmallWindowStructuredParserConfig } from "../src/app/small-window-server.js";
import { createChatSemanticTaskProvider } from "../src/llm/chat-semantic-task-provider.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";
import { createJevIntentShadow } from "../src/understanding/jev-intent-shadow.js";
import { projectJevIntentCandidate } from "../src/understanding/jev-intent-observer.js";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--live" && !arg.startsWith("--case="))) throw new Error("Usage: node scripts/compare-jev-intent.mjs [--live] [--case=id]");
loadLocalEnvironment();
const config = resolveSmallWindowStructuredParserConfig();
const raw = await readFile(new URL("../eval/jev-intent-cases.json", import.meta.url), "utf8");
const dataset = JSON.parse(raw);
// Same single-turn input, no fabricated ConversationState or oracle context.
const eligible = dataset.cases.filter(c => c.context === "self_contained" && !c.messages);
const selectedId = args.find(arg => arg.startsWith("--case="))?.slice(7);
if (selectedId && !eligible.some(c => c.id === selectedId)) throw new Error("Unknown eligible case");
const cases = selectedId ? eligible.filter(c => c.id === selectedId) : eligible;
if (!args.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry-run", calls: 0, cases: cases.map(c => c.id),
    legacy: { enabled: config.enabled, model: config.model, keyPresent: Boolean(config.apiKey) },
    jevKeyPresent: Boolean(process.env.TYPESAFE_API_KEY) }, null, 2));
} else {
  if (!config.enabled || !config.apiKey || !process.env.TYPESAFE_API_KEY) throw new Error("Both configured legacy parser and Jev credentials are required");
  // Bounded comparison: one call per provider per case, no invalid-output retry.
  const provider = createChatSemanticTaskProvider({ ...config, timeoutMs: 1500,
    maxInvalidRetries: 0, thinkingMode: "disabled" });
  const classify = createJevIntentShadow({ mode: "shadow", apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 1500 });
  const rows = [];
  const inspect = async (c, semanticProvider) => {
    const started = performance.now();
    let usage = null;
    try {
      const parsed = await parseSemanticTask(c.input, { providerFailureFallback: true,
        provider: semanticProvider ? async request => { const result = await semanticProvider(request); usage = result.usage ?? null; return result; } : null });
      return { status: "completed", action: parsed.taskFrame.action, domain: parsed.taskFrame.domain,
        fallback: parsed.telemetry.providerFallback, usage,
        elapsedMs: Math.round(performance.now() - started) };
    } catch (error) { return { status: "failed", usage,
      reason: error instanceof RangeError ? "parser_budget" : error instanceof TypeError ? "parser_contract" : "parser_failed",
      elapsedMs: Math.round(performance.now() - started) }; }
  };
  const matches = (c, result) => result.domain === c.domain && (!c.action || result.action === c.action);
  for (const c of cases) {
    const deterministic = await inspect(c, null);
    const [legacy, jev] = await Promise.all([inspect(c, provider), classify({ input: c.input })]);
    const jevLabels = { action: jev.answers?.action.choice, domain: jev.answers?.domain.choice };
    rows.push({ id: c.id, expected: { action: c.action ?? null, domain: c.domain },
      deterministic: { ...deterministic, matched: matches(c, deterministic) },
      legacy: { ...legacy, matched: matches(c, legacy) },
      jev: { ...jev, candidate: projectJevIntentCandidate(jev), matched: jev.status === "observed" && matches(c, jevLabels) } });
    if (jev.reason === "http_error" || jev.reason === "missing_api_key") break;
  }
  const summary = Object.fromEntries(["deterministic", "legacy", "jev"].map(key => [key, {
    matched: rows.filter(r => r[key].matched).length, attempted: rows.length,
    failed: rows.filter(r => ["failed", "unavailable", "timeout"].includes(r[key].status)).length,
    fallback: rows.filter(r => r[key].fallback).length,
    averageMs: Math.round(rows.reduce((sum, r) => sum + r[key].elapsedMs, 0) / rows.length)
  }]));
  const report = { schemaVersion: "jev-parser-comparison.v1", timestamp: new Date().toISOString(),
    datasetHash: createHash("sha256").update(raw).digest("hex"), legacyModel: config.model,
    timeoutMs: 1500, invalidOutputRetries: 0, planned: cases.length,
    scope: "single-turn parser component, no catalog or multi-turn state; not ReAct end-to-end or production acceptance",
    summary, rows };
  const directory = new URL("../.cache/eval/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const filename = `jev-comparison-${Date.now()}.json`;
  await writeFile(new URL(filename, directory), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: `.cache/eval/${filename}`, model: config.model, summary }, null, 2));
  if (rows.length !== cases.length || rows.some(r => !r.jev.matched)) process.exitCode = 1;
}
