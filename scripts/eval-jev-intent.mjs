import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createJevIntentShadow } from "../src/understanding/jev-intent-shadow.js";
import { projectJevIntentInput, projectJevIntentCandidate } from "../src/understanding/jev-intent-observer.js";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--live" && !arg.startsWith("--case="))) throw new Error("Usage: node scripts/eval-jev-intent.mjs [--live] [--case=id]");
const dataset = JSON.parse(await readFile(new URL("../eval/jev-intent-cases.json", import.meta.url), "utf8"));
const selectedId = args.find(arg => arg.startsWith("--case="))?.slice(7);
if (selectedId && !dataset.cases.some(c => c.id === selectedId)) throw new Error("Unknown case id");
const cases = selectedId ? dataset.cases.filter(c => c.id === selectedId) : dataset.cases;
if (!args.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry-run", calls: 0, cases: cases.length,
    inputs: cases.map(c => ({ id: c.id, ...projectJevIntentInput(c) })) }, null, 2));
} else {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("Missing TYPESAFE_API_KEY");
  const classify = createJevIntentShadow({ mode: "shadow", apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 15000 });
  const results = [];
  for (const c of cases) {
    const result = await classify(projectJevIntentInput(c), { baselineAction: c.action });
    const candidate = projectJevIntentCandidate(result);
    const checks = Object.fromEntries(["action", "domain", "context"].filter(key => c[key] !== undefined)
      .map(key => [key, result.answers?.[key]?.choice === c[key]]));
    if (c.abstain) checks.abstain = candidate.action === null;
    results.push({ id: c.id, checks, passed: result.status === "observed" && Object.values(checks).every(Boolean),
      candidate, ...result });
    if (result.status !== "observed") break;
  }
  const metrics = Object.fromEntries(["action", "domain", "context", "abstain"].map(key => {
    const applicable = results.filter(r => Object.hasOwn(r.checks, key));
    return [key, { passed: applicable.filter(r => r.checks[key]).length, total: applicable.length }];
  }));
  const report = { dataset: dataset.schemaVersion, description: dataset.description,
    timestamp: new Date().toISOString(), planned: cases.length, completed: results.length,
    passed: results.filter(r => r.passed).length, metrics, results };
  await mkdir(new URL("../.cache/eval/", import.meta.url), { recursive: true });
  const reportName = `jev-intent-development${selectedId ? `-${selectedId}` : ""}.json`;
  await writeFile(new URL(`../.cache/eval/${reportName}`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, results: results.map(({ id, passed, checks, status, candidate }) => ({ id, passed, checks, status, candidate })) }, null, 2));
  if (report.passed !== report.planned) process.exitCode = 1;
}
