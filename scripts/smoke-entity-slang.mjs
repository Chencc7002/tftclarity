import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveSmallWindowStructuredParserConfig } from "../src/app/small-window-server.js";
import { createEntitySlangProvider, ENTITY_SLANG_PROMPT_VERSION } from "../src/llm/entity-slang-provider.js";
import { createEntitySlangResolver } from "../src/domain/tft/entity-slang-resolver.js";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";
import { validateSnapshot } from "../eval/entity-names/catalog-audit.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { validateToolInput } from "../src/agent/tools/contracts.js";

const args = process.argv.slice(2);
const value = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
if (!args.includes("--live") || !value("--snapshot")) throw new Error("Use --live --snapshot=<historical snapshot.json>; this calls the configured model, at most once per 5 names.");
const output = resolve(value("--output") ?? ".cache/eval/entity-slang-live.json");
const rel = relative(resolve(".cache"), output);
if (!rel || rel.startsWith("..") || isAbsolute(rel) || !output.endsWith(".json")) throw new Error("Output must be a JSON file inside .cache.");
const snapshot = JSON.parse(await readFile(resolve(value("--snapshot")), "utf8"));
validateSnapshot(snapshot);
const fixture = JSON.parse(await readFile(new URL("../eval/entity-names/slang.json", import.meta.url), "utf8"));
if (snapshot.seasonContextId !== fixture.seasonContextId) throw new Error("Fixture and snapshot season differ.");
const catalogSchema = createStructuredToolDefinitions().find(tool => tool.name === "entity_catalog_query").inputSchema;
for (const row of fixture.cases) {
  validateToolInput({ entityType: row.type, filters: { names: [row.input], ...row.filters } }, catalogSchema, "entity_catalog_query");
  const records = snapshot.catalog[row.type === "unit" ? "units" : "items"];
  if (row.expected.some(id => !records.some(record => record.apiName === id))) throw new Error(`Expected entity is absent: ${row.input}`);
}
loadLocalEnvironment();
const config = resolveSmallWindowStructuredParserConfig();
if (!config.enabled) throw new Error("Configure an enabled LLM before running live smoke.");
const provider = createEntitySlangProvider({ ...config, thinkingMode: "disabled" });
const groups = Map.groupBy(fixture.cases, row => JSON.stringify([row.type, row.filters ?? {}]));
const observations = [], cases = [];
for (const group of groups.values()) {
  for (let offset = 0; offset < group.length; offset += 5) {
    const rows = group.slice(offset, offset + 5);
    const input = { entityType: rows[0].type, filters: { names: rows.map(row => row.input), ...rows[0].filters } };
    const baseline = queryEntityCatalog({ catalog: snapshot.catalog, input, updatedAt: snapshot.domainUpdatedAt });
    const resolver = createEntitySlangResolver({ mode: "suggest", provider, onObservation: event => observations.push(event) });
    const result = await resolver({ result: baseline, catalog: snapshot.catalog, input, seasonContextId: snapshot.seasonContextId,
      question: `${input.entityType === "item" ? "这些普通装备" : "这些英雄"}分别是什么：${rows.map(row => row.input).join("、")}` });
    for (const [i, row] of rows.entries()) {
      const resolved = result.resolution.requests[i];
      const ids = resolved.candidates.map(candidate => candidate.apiName);
      const baselineStatus = baseline.resolution.requests[i].status;
      cases.push({ ...row, baselineStatus, actual: ids, status: resolved.status,
        match: ids.length === row.expected.length && row.expected.every(id => ids.includes(id)),
        path: baselineStatus === "not_found" ? observations.at(-1)?.status : "legacy" });
    }
    console.log(JSON.stringify({ batch: rows.map(row => row.input), observation: observations.at(-1) }));
  }
}
const report = { schemaVersion: "entity-slang-live-smoke.v1", createdAt: new Date().toISOString(),
  scope: "Historical catalog, manually selected examples; not production accuracy or rollout approval.",
  model: config.model, promptVersion: ENTITY_SLANG_PROMPT_VERSION, timeoutMs: 2500,
  catalogHash: snapshot.catalogHash, seasonContextId: snapshot.seasonContextId, catalogUpdatedAt: snapshot.domainUpdatedAt,
  summary: { cases: cases.length, matched: cases.filter(row => row.match).length,
    legacyMatches: cases.filter(row => row.path === "legacy").length,
    llmCalls: observations.reduce((sum, event) => sum + event.llmCallsAdded, 0),
    failedCalls: observations.filter(event => event.status === "failed").length }, observations, cases };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: report.summary, output }));
if (report.summary.failedCalls || cases.some(row => !row.match)) process.exitCode = 1;
