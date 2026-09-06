import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
import { snapshotFromCache, extractObservedNames, generateCatalogStressCases, runCatalogAudit } from "../eval/entity-names/catalog-audit.js";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = arg.match(/^--([^=]+)=(.+)$/u);
  if (!match) throw new TypeError("Expected --cache=PATH --season=ID [--source-kind=local_qa|production_export] [--output=.cache/PATH]");
  return [match[1], match[2]];
}));
if (!args.cache || !args.season) throw new TypeError("--cache and --season are required");
for (const key of Object.keys(args)) if (!["cache", "season", "source-kind", "output"].includes(key)) throw new TypeError(`Unknown argument ${key}`);
const output = resolve(args.output ?? ".cache/eval/entity-name-catalog-audit");
const inside = relative(resolve(".cache"), output);
if (!inside || isAbsolute(inside) || inside.startsWith(`..${sep}`) || inside === ".." || resolve(".cache", inside) !== output) {
  throw new TypeError("Output must be a subdirectory of .cache; observed names must not enter tracked files");
}
const cache = JSON.parse(await readFile(args.cache, "utf8"));
const snapshot = snapshotFromCache(cache, args.season);
const observed = extractObservedNames(cache, args.season, args["source-kind"] ?? "local_qa");
const cases = [...generateCatalogStressCases(snapshot.catalog), ...observed.cases];
const report = runCatalogAudit(snapshot, cases);
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries({ snapshot, observed, report })) {
  await writeFile(resolve(output, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
console.log(JSON.stringify({ ...report, rows: undefined, sourceKind: args["source-kind"] ?? "local_qa",
  observedQueries: observed.queryCount, queriesWithoutEntityEvidence: observed.noCatalogEvidence, output }, null, 2));
process.exitCode = report.invariantsPass ? 0 : 1;
