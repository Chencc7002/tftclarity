import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildJevDimensionContext, projectJevDimensionInput, projectJevDimensions, dimensionTelemetry } from "../src/understanding/jev-intent-dimensions.js";
import { createJevIntentShadow } from "../src/understanding/jev-intent-shadow.js";
import { projectJevIntentInput, projectJevIntentControl, inferJevInheritedDomain } from "../src/understanding/jev-intent-observer.js";
import { createChatSemanticTaskProvider } from "../src/llm/chat-semantic-task-provider.js";
import { resolveSmallWindowStructuredParserConfig } from "../src/app/small-window-server.js";

const args = process.argv.slice(2);
if (args.some(x => x !== "--live")) throw new Error("Usage: node scripts/eval-jev-dimensions.mjs [--live]; env must be explicitly supplied");
const raw = await readFile(new URL("../eval/jev-dimensions-cases.json", import.meta.url), "utf8");
const dataset = JSON.parse(raw);
if (!Array.isArray(dataset.cases) || dataset.cases.length > 12) throw new Error("case_budget");
const rows = [];
const config = resolveSmallWindowStructuredParserConfig();
const live = args.includes("--live");
if (live && (!config.enabled || !config.apiKey || !process.env.TYPESAFE_API_KEY)) throw new Error("Both LLM and Jev configuration are required");
// Diagnostic budget is equal across arms. No retries, no tools, no production writes.
const timeoutMs = 15000;
const jev = createJevIntentShadow({ mode: live ? "shadow" : "off", apiKey: process.env.TYPESAFE_API_KEY, timeoutMs });
const llm = live ? createChatSemanticTaskProvider({ ...config, timeoutMs, maxInvalidRetries: 0, thinkingMode: "disabled" }) : null;
let calls = 0;
for (const c of dataset.cases) {
  const b = c.bridge;
  const serverContext = b ? { bridgeContext: { relation: b.pending ? "reply_to_clarification" : "continue", view: {
    schemaVersion: "conversation-bridge-context.v1",
    records: b.operation ? [{ operation: b.operation, status: "completed", entityRefs: b.entities ?? [] }] : [],
    pendingClarification: b.pending ? { confirmationContext: b.pending } : null
  } } } : {};
  const context = buildJevDimensionContext(c, serverContext);
  const enriched = projectJevDimensionInput(c, context);
  if (!live) { rows.push({ id: c.id, domainSource: context.domainSource, summaryChars: enriched.conversationSummary.length }); continue; }
  const results = {};
  // Alternate order to avoid always giving the same arm the earliest request.
  const order = rows.length % 2 ? ["dimensions", "legacy", "llm"] : ["llm", "legacy", "dimensions"];
  for (const arm of order) {
    if (++calls > dataset.cases.length * 3) throw new Error("request_budget");
    const started = performance.now();
    if (arm === "llm") {
      try {
        const value = await llm({ messages: [{ role: "user", content: JSON.stringify({ dynamic_context: { input: c.input },
          conversationSummary: JSON.parse(enriched.conversationSummary) }) }], budget: { maxOutputTokens: 1200 } });
        results.llm = { status: "observed", action: value.taskFrame.action, domain: value.taskFrame.domain,
          usage: value.usage, context: null, contextMeasured: false, elapsedMs: Math.round(performance.now() - started) };
      } catch { results.llm = { status: "failed", elapsedMs: Math.round(performance.now() - started) }; }
    } else {
      const value = await jev(arm === "legacy" ? projectJevIntentInput(c) : enriched);
      const projected = arm === "legacy" ? projectJevIntentControl(value, { inheritedDomain: inferJevInheritedDomain(c) }) : projectJevDimensions(value, context);
      results[arm] = { status: value.status, reason: value.reason ?? null,
        httpStatus: value.httpStatus ?? null, validationFailure: value.validationFailure ?? null,
        elapsedMs: value.elapsedMs, usage: value.usage,
        action: value.answers?.action.choice ?? null, domain: value.answers?.domain.choice ?? null,
        context: value.answers?.context.choice ?? null, contextMeasured: true,
        hintAction: projected.advisory?.action ?? null, hintDomain: projected.advisory?.domain ?? null,
        policy: arm === "dimensions" ? dimensionTelemetry(projected) : { disposition: projected.disposition } };
    }
  }
  for (const arm of Object.keys(results)) {
    const r = results[arm];
    r.classificationChecks = Object.fromEntries(["action", "domain", ...(r.contextMeasured ? ["context"] : [])]
      .filter(k => c.expected[k] !== undefined).map(k => [k, r.status === "observed" && r[k] === c.expected[k]]));
    r.hintActionCorrect = arm === "llm" || !r.hintAction || !c.expected.action ? null : r.hintAction === c.expected.action;
    r.abstainedWhenRequired = c.expected.abstain && arm !== "llm" ? !r.hintAction && !r.hintDomain : null;
  }
  rows.push({ id: c.id, expected: c.expected, results });
  // Stop at service/contract failures rather than silently retesting until success.
  if (Object.values(results).some(r => r.status !== "observed")) break;
}
const summary = live ? Object.fromEntries(["llm", "legacy", "dimensions"].map(arm => {
  const values = rows.map(r => r.results[arm]);
  return [arm, { attempted: values.length, valid: values.filter(r => r.status === "observed").length,
    actionDomainMatched: values.filter(r => r.status === "observed" && ["action", "domain"].every(k => r.classificationChecks[k] !== false)).length,
    actionHints: values.filter(r => r.hintAction).length, wrongActionHints: values.filter(r => r.hintActionCorrect === false).length,
    meanMs: Math.round(values.reduce((n, r) => n + r.elapsedMs, 0) / values.length) }];
})) : null;
const sourceFiles = ["src/domain/tft/domain-gate.js", "src/understanding/jev-intent-dimensions.js", "src/understanding/jev-intent-shadow.js", "src/understanding/jev-intent-observer.js", "src/llm/chat-semantic-task-provider.js", "scripts/eval-jev-dimensions.mjs"];
const hashes = {};
for (const f of sourceFiles) hashes[f] = createHash("sha256").update(await readFile(new URL(`../${f}`, import.meta.url))).digest("hex");
const report = { schemaVersion: "jev-dimensions-evaluation.v1", mode: live ? "live-development" : "dry-run", timestamp: new Date().toISOString(),
  description: dataset.description, scope: "intent components only, LLM receives the same enriched context as v2; no tools or end-to-end accuracy measured",
  calls, plannedCalls: live ? dataset.cases.length * 3 : 0, timeoutMs, productionJevDefaultTimeoutMs: 1500, retries: 0,
  llmModel: config.model, datasetHash: createHash("sha256").update(raw).digest("hex"), hashes, summary, rows,
  humanReview: "pending", releaseReady: false };
await mkdir(new URL("../.cache/eval/", import.meta.url), { recursive: true });
const name = `jev-dimensions-${live ? "live" : "dry"}-${Date.now()}.json`;
await writeFile(new URL(`../.cache/eval/${name}`, import.meta.url), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ report: `.cache/eval/${name}`, calls, cases: rows.length, summary, releaseReady: false }, null, 2));
if (live && (rows.length !== dataset.cases.length || rows.some(r => Object.values(r.results).some(x => x.status !== "observed")))) process.exitCode = 1;
