import { createWriteStream } from "node:fs";
import { access, readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { relative, resolve } from "node:path";
import { createGzip } from "node:zlib";
import {
  OFFICIAL_TFT_CHESS_URL,
  buildOfficialTftEntityDetails
} from "../src/data/official-entity-details.js";
import {
  OFFICIAL_TFT_EQUIPMENT_URL,
  buildOfficialTftItemDetailsCatalog
} from "../src/data/official-item-details.js";
import { MetaTFTClient } from "../src/data/metatft-client.js";
import { normalizeUnitBuildRows } from "../src/data/metatft-response-adapter.js";
import { planMetaTFTUnitBuilds } from "../src/core/query-planner.js";
import {
  createMechanismCase,
  createSingleItemReplacementComparisons,
  selectStandardCases,
  validateMechanismCase
} from "../src/knowledge/mechanism-case-builder.js";
import { sha256, stableStringify } from "../src/knowledge/mechanic-atom-extractor.js";

const DEFAULT_QUERY = Object.freeze({
  queue: "1100",
  queueLabel: "RANKED_TFT",
  patch: "current",
  days: 30,
  rankFilter: ["CHALLENGER", "GRANDMASTER", "MASTER"],
  starLevel: [2],
  itemCount: 3
});

function parseArgs(argv) {
  const options = {
    outputDir: resolve("data", "generated", "mechanisms", "s17"),
    rawRoot: resolve(".cache", "s17-mechanisms"),
    standardLimit: 300,
    comparisonLimit: 200,
    comparisonPerUnitLimit: 1000,
    concurrency: 3,
    requestDelayMs: 250,
    timeoutMs: 30000,
    baseUrl: process.env.METATFT_BASE_URL ?? "https://api-hc.metatft.com",
    sourceCapturedAt: null,
    replayedFromSnapshot: null,
    reuseRawSnapshot: false,
    chess: null,
    equipment: null,
    units: null,
    buildsDir: null
  };
  const numeric = new Set([
    "standard-limit",
    "comparison-limit",
    "comparison-per-unit-limit",
    "concurrency",
    "request-delay-ms",
    "timeout-ms"
  ]);
  const paths = new Set(["output-dir", "raw-root", "chess", "equipment", "units", "builds-dir"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (rawKey === "reuse-raw-snapshot") {
      options.reuseRawSnapshot = true;
      continue;
    }
    const next = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    options[key] = numeric.has(rawKey) ? Number(next) : paths.has(rawKey) ? resolve(next) : next;
  }
  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

async function loadJsonFile(filePath) {
  const buffer = await readFile(filePath);
  return {
    buffer,
    json: JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/u, "")),
    location: filePath
  };
}

async function fetchJsonSource(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "TFTAgent S17 mechanism dataset capture/1" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      json: JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/u, "")),
      location: url
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeJson(filePath, value) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath, rows) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

async function writeJsonlGzip(filePath, rows) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  const output = createWriteStream(filePath);
  const gzip = createGzip({ level: 9 });
  gzip.pipe(output);
  for (const row of rows) {
    if (!gzip.write(`${JSON.stringify(row)}\n`, "utf8")) await once(gzip, "drain");
  }
  gzip.end();
  await once(output, "close");
}

function rawRelative(filePath) {
  return relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function sleep(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
    : Promise.resolve();
}

function unitApiNameFromRow(row) {
  const raw = row?.units_unique ?? row?.unitsUnique ?? "";
  return String(raw).split("-")[0];
}

function queryableUnitApiNames(unitsResponse) {
  return [...new Set(
    (Array.isArray(unitsResponse?.data) ? unitsResponse.data : [])
      .map(unitApiNameFromRow)
      .filter((apiName) => apiName.startsWith("TFT17_"))
  )].sort();
}

function unitKind(unit) {
  const apiName = unit?.apiName ?? "";
  if (/_PVE_|_Enemy_|Minion|Summon|FakeUnit|Core$/u.test(apiName)) return "auxiliary";
  if (Number(unit?.cost) > 5) return "auxiliary";
  return "playable_candidate";
}

function statsRequestParams(query) {
  return {
    formatnoarray: "true",
    compact: "true",
    queue: query.queue,
    patch: query.patch,
    days: query.days,
    rank: query.rankFilter.join(","),
    permit_filter_adjustment: "true"
  };
}

async function runPool(values, concurrency, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

function summarizeErrors(rejectedRows) {
  const counts = {};
  for (const row of rejectedRows) {
    for (const error of row.errors) counts[error] = (counts[error] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const options = parseArgs(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const offlineReplay = Boolean(options.chess || options.equipment || options.units || options.buildsDir);
if (offlineReplay && !options.sourceCapturedAt) {
  throw new Error("Offline replay requires --source-captured-at <ISO-8601>");
}
const sourceCapturedAt = options.sourceCapturedAt
  ? new Date(options.sourceCapturedAt).toISOString()
  : generatedAt;
const snapshotId = `s17-${safeTimestamp(sourceCapturedAt)}`;
const rawDir = resolve(options.rawRoot, snapshotId);
if (await exists(rawDir) && !options.reuseRawSnapshot) {
  throw new Error(`Immutable raw snapshot already exists: ${rawDir}`);
}
await Promise.all([mkdir(rawDir, { recursive: true }), mkdir(options.outputDir, { recursive: true })]);

const [chessSource, equipmentSource] = await Promise.all([
  options.chess
    ? loadJsonFile(options.chess)
    : fetchJsonSource(OFFICIAL_TFT_CHESS_URL, options.timeoutMs),
  options.equipment
    ? loadJsonFile(options.equipment)
    : fetchJsonSource(OFFICIAL_TFT_EQUIPMENT_URL, options.timeoutMs)
]);
if (!options.reuseRawSnapshot) {
  await Promise.all([
    writeFile(resolve(rawDir, "official-chess.json"), chessSource.buffer),
    writeFile(resolve(rawDir, "official-equipment.json"), equipmentSource.buffer)
  ]);
}

const officialHashes = {
  chess: sha256(chessSource.buffer),
  equipment: sha256(equipmentSource.buffer)
};
const officialDetails = buildOfficialTftEntityDetails({
  chess: chessSource.json,
  race: { data: [] },
  job: { data: [] }
});
const itemCatalog = buildOfficialTftItemDetailsCatalog(equipmentSource.json);
const officialPatch = String(chessSource.json.version ?? "unknown");
const officialSeason = String(chessSource.json.season ?? "unknown");
if (!/(?:^|[.\s])S?17$/iu.test(officialSeason) && !officialSeason.includes("S17")) {
  throw new Error(`Official chess source is not S17: ${officialSeason}`);
}
if (String(equipmentSource.json.version) !== officialPatch || String(equipmentSource.json.season) !== officialSeason) {
  throw new Error("Official chess and equipment sources do not share the same version and season");
}
const snapshotOutputDir = resolve(options.outputDir, officialPatch, snapshotId);
if (await exists(snapshotOutputDir)) {
  throw new Error(`Immutable published snapshot already exists: ${snapshotOutputDir}`);
}
const snapshotBuildDir = `${snapshotOutputDir}.building-${process.pid}-${safeTimestamp(generatedAt)}`;
await mkdir(snapshotBuildDir, { recursive: true });

const client = new MetaTFTClient({
  baseUrl: options.baseUrl,
  timeoutMs: options.timeoutMs,
  maxRetries: 2,
  retryDelayMs: 300,
  maxRetryDelayMs: 2000
});
const unitsResponse = options.units
  ? (await loadJsonFile(options.units)).json
  : await client.getUnitsUnique(statsRequestParams(DEFAULT_QUERY));
if (!options.reuseRawSnapshot) {
  await writeJson(resolve(rawDir, "metatft-units-unique.json"), unitsResponse);
}
const queryableUnits = queryableUnitApiNames(unitsResponse);

const statuses = await runPool(queryableUnits, options.concurrency, async (unitApiName, index) => {
  if (index > 0) await sleep(options.requestDelayMs);
  const unit = officialDetails.units.get(unitApiName) ?? null;
  const rawFile = resolve(rawDir, "unit-builds", `${unitApiName}.json`);
  const status = {
    unitApiName,
    unitName: unit?.name ?? null,
    unitKind: unitKind(unit),
    officialLinked: Boolean(unit),
    status: "pending",
    responseRows: 0,
    traceableCases: 0,
    rejectedRows: 0,
    responseHash: null,
    rawResponsePath: rawRelative(rawFile),
    error: null
  };
  if (!unit) {
    status.status = "missing_official_unit";
    return { status, cases: [], rejectedRows: [], comparisons: [] };
  }

  try {
    let response;
    if (options.buildsDir) {
      response = (await loadJsonFile(resolve(options.buildsDir, `${unitApiName}.json`))).json;
    } else {
      const plan = planMetaTFTUnitBuilds({
        unit: unitApiName,
        queue: DEFAULT_QUERY.queue,
        patch: DEFAULT_QUERY.patch,
        days: DEFAULT_QUERY.days,
        rankFilter: DEFAULT_QUERY.rankFilter,
        starLevel: DEFAULT_QUERY.starLevel,
        itemCount: DEFAULT_QUERY.itemCount
      });
      response = await client.getUnitBuilds(plan);
    }
    if (!options.reuseRawSnapshot) await writeJson(rawFile, response);
    const responseHash = sha256(stableStringify(response));
    const rows = normalizeUnitBuildRows(response);
    const providerQuery = {
      ...statsRequestParams(DEFAULT_QUERY),
      unit_tier_numitems_unique: `${unitApiName}-1_2_3`
    };
    const source = {
      provider: "MetaTFT",
      endpoint: `/tft-explorer-api/unit_builds/${unitApiName}`,
      capturedAt: options.buildsDir ? sourceCapturedAt : new Date().toISOString(),
      providerQuery,
      responseHash,
      rawResponsePath: rawRelative(rawFile)
    };
    const queryContext = {
      queue: DEFAULT_QUERY.queueLabel,
      days: DEFAULT_QUERY.days,
      rankFilter: [...DEFAULT_QUERY.rankFilter],
      starLevel: 2,
      itemCount: 3,
      providerPatch: DEFAULT_QUERY.patch
    };
    const cases = [];
    const rejectedRows = [];
    rows.forEach((row, rowIndex) => {
      const built = createMechanismCase({
        row,
        unit: { ...unit, entityType: status.unitKind },
        itemCatalog,
        patch: officialPatch,
        queryContext,
        source,
        officialHashes
      });
      if (built.case) {
        const validationErrors = validateMechanismCase(built.case);
        if (validationErrors.length) rejectedRows.push({ rowIndex, errors: validationErrors });
        else cases.push(built.case);
      } else {
        rejectedRows.push({ rowIndex, errors: built.errors });
      }
    });
    const comparisons = createSingleItemReplacementComparisons(cases)
      .slice(0, options.comparisonPerUnitLimit);
    status.status = cases.length ? "captured" : rows.length ? "no_traceable_cases" : "empty";
    status.responseRows = rows.length;
    status.traceableCases = cases.length;
    status.rejectedRows = rejectedRows.length;
    status.responseHash = responseHash;
    status.filterAdjustment = response?.filter_adjustment ?? null;
    return { status, cases, rejectedRows, comparisons };
  } catch (error) {
    status.status = "failed";
    status.error = error instanceof Error ? error.message : String(error);
    return { status, cases: [], rejectedRows: [], comparisons: [] };
  }
});

const allCases = statuses.flatMap((entry) => entry.cases);
const allRejectedRows = statuses.flatMap((entry) => entry.rejectedRows.map((row) => ({
  unitApiName: entry.status.unitApiName,
  ...row
})));
const allComparisons = statuses.flatMap((entry) => entry.comparisons);
const duplicateCaseIds = [...new Set(
  allCases
    .map((entry) => entry.caseId)
    .filter((caseId, index, values) => values.indexOf(caseId) !== index)
)].sort();
const deduplicatedCases = [...new Map(allCases.map((entry) => [entry.caseId, entry])).values()];
const playableCases = deduplicatedCases.filter((entry) => entry.unit.entityType === "playable_candidate");
const auxiliaryCases = deduplicatedCases.filter((entry) => entry.unit.entityType === "auxiliary");
const completeOfficialCases = playableCases.filter((entry) => entry.evidencePolicy.officialTextComplete);
const partialOfficialCases = playableCases.filter((entry) => !entry.evidencePolicy.officialTextComplete);
const comparisonsFor = (cases) => {
  const ids = new Set(cases.map((entry) => entry.caseId));
  return allComparisons.filter((entry) => ids.has(entry.from.caseId) && ids.has(entry.to.caseId));
};
const standardCases = selectStandardCases(
  completeOfficialCases,
  comparisonsFor(completeOfficialCases),
  options.standardLimit
);
const partialCases = selectStandardCases(
  partialOfficialCases,
  comparisonsFor(partialOfficialCases),
  Math.min(100, options.standardLimit)
);
const publishedAuxiliaryCases = selectStandardCases(
  auxiliaryCases,
  comparisonsFor(auxiliaryCases),
  Math.min(50, options.standardLimit)
);
const standardCaseIds = new Set(standardCases.map((entry) => entry.caseId));
const eligibleStandardComparisons = allComparisons
  .filter((entry) => standardCaseIds.has(entry.from.caseId) && standardCaseIds.has(entry.to.caseId))
  .filter((entry) => entry.sampleEvidence.eligibleForPerformanceInference)
  .sort((a, b) => {
    const sampleA = Math.min(a.from.games, a.to.games);
    const sampleB = Math.min(b.from.games, b.to.games);
    return sampleB - sampleA || a.comparisonId.localeCompare(b.comparisonId);
  });
const standardComparisonMap = new Map();
for (const unitApiName of [...new Set(eligibleStandardComparisons.map((entry) => entry.unit.apiName))].sort()) {
  const comparison = eligibleStandardComparisons.find((entry) => entry.unit.apiName === unitApiName);
  if (comparison) standardComparisonMap.set(comparison.comparisonId, comparison);
}
for (const comparison of eligibleStandardComparisons) {
  if (standardComparisonMap.size >= options.comparisonLimit) break;
  standardComparisonMap.set(comparison.comparisonId, comparison);
}
const standardComparisons = [...standardComparisonMap.values()];
const publishedCaseIds = new Set([
  ...standardCases,
  ...partialCases,
  ...publishedAuxiliaryCases
].map((entry) => entry.caseId));
const mechanismOnlyComparisons = allComparisons
  .filter((entry) => publishedCaseIds.has(entry.from.caseId) && publishedCaseIds.has(entry.to.caseId))
  .filter((entry) => !entry.sampleEvidence.eligibleForPerformanceInference)
  .sort((a, b) => b.sampleEvidence.minimumGames - a.sampleEvidence.minimumGames)
  .slice(0, options.comparisonLimit);
const referencedItems = new Set(deduplicatedCases.flatMap((entry) => entry.rawItems));
const missingOfficialItems = Object.keys(summarizeErrors(allRejectedRows))
  .filter((error) => error.startsWith("missing_official_item:"))
  .map((error) => error.slice("missing_official_item:".length))
  .sort();

const derivedDir = resolve(rawDir, "derived", safeTimestamp(generatedAt));
await mkdir(derivedDir, { recursive: true });
await Promise.all([
  writeJsonlGzip(resolve(derivedDir, "mechanism-cases.full.v1.jsonl.gz"), deduplicatedCases),
  writeJsonlGzip(resolve(derivedDir, "replacement-comparisons.candidates.v1.jsonl.gz"), allComparisons),
  writeJsonl(resolve(snapshotBuildDir, "standard-cases.v1.jsonl"), standardCases),
  writeJsonl(resolve(snapshotBuildDir, "partial-official-cases.v1.jsonl"), partialCases),
  writeJsonl(resolve(snapshotBuildDir, "auxiliary-cases.v1.jsonl"), publishedAuxiliaryCases),
  writeJsonl(resolve(snapshotBuildDir, "replacement-comparisons.v1.jsonl"), standardComparisons),
  writeJsonl(resolve(snapshotBuildDir, "mechanism-only-replacement-comparisons.v1.jsonl"), mechanismOnlyComparisons)
]);

const report = {
  schemaVersion: "s17_mechanism_capture_report.v1",
  snapshotId,
  capturedAt: sourceCapturedAt,
  generatedAt,
  provenance: {
    mode: offlineReplay ? "offline_replay" : "live_capture",
    sourceCapturedAt,
    generatedAt,
    replayedFromSnapshot: options.replayedFromSnapshot ?? null,
    rawSnapshotReused: options.reuseRawSnapshot
  },
  season: "S17",
  officialPatch,
  statisticsPatchRequest: DEFAULT_QUERY.patch,
  queryContext: {
    queue: DEFAULT_QUERY.queueLabel,
    providerQueue: DEFAULT_QUERY.queue,
    days: DEFAULT_QUERY.days,
    rankFilter: DEFAULT_QUERY.rankFilter,
    starLevel: 2,
    itemCount: 3
  },
  sources: {
    officialChess: {
      url: OFFICIAL_TFT_CHESS_URL,
      version: officialPatch,
      season: officialSeason,
      updatedAt: chessSource.json.time ?? null,
      sha256: officialHashes.chess,
      capturedFrom: chessSource.location
    },
    officialEquipment: {
      url: OFFICIAL_TFT_EQUIPMENT_URL,
      version: String(equipmentSource.json.version),
      season: String(equipmentSource.json.season),
      updatedAt: equipmentSource.json.time ?? null,
      sha256: officialHashes.equipment,
      capturedFrom: equipmentSource.location
    },
    statistics: {
      provider: "MetaTFT",
      baseUrl: options.baseUrl,
      endpoint: "/tft-explorer-api/unit_builds/{unit}",
      unitsEndpoint: "/tft-explorer-api/units_unique",
      requestedPatch: DEFAULT_QUERY.patch,
      note: "Third-party observational statistics; not an official mechanics source."
    }
  },
  coverage: {
    officialS17UnitCount: [...officialDetails.units.keys()].filter((apiName) => apiName.startsWith("TFT17_")).length,
    queryableUnitCount: queryableUnits.length,
    playableCandidateCount: statuses.filter((entry) => entry.status.unitKind === "playable_candidate").length,
    auxiliaryUnitCount: statuses.filter((entry) => entry.status.unitKind === "auxiliary").length,
    capturedUnitCount: statuses.filter((entry) => entry.status.status === "captured").length,
    emptyUnitCount: statuses.filter((entry) => entry.status.status === "empty").length,
    failedUnitCount: statuses.filter((entry) => entry.status.status === "failed").length,
    officialUnitLinkRate: queryableUnits.length
      ? statuses.filter((entry) => entry.status.officialLinked).length / queryableUnits.length
      : 0,
    responseRowCount: statuses.reduce((sum, entry) => sum + entry.status.responseRows, 0),
    traceableCaseCount: deduplicatedCases.length,
    playableCaseCount: playableCases.length,
    auxiliaryCaseCount: auxiliaryCases.length,
    completeOfficialTextCaseCount: completeOfficialCases.length,
    partialOfficialTextCaseCount: partialOfficialCases.length,
    numericFormulaIncompleteCaseCount: deduplicatedCases.filter(
      (entry) => !entry.evidencePolicy.numericFormulaComplete
    ).length,
    rejectedRowCount: allRejectedRows.length,
    referencedOfficialItemCount: referencedItems.size,
    standardCaseCount: standardCases.length,
    standardPlayableUnitCount: new Set(standardCases.map((entry) => entry.unit.apiName)).size,
    partialPublishedCaseCount: partialCases.length,
    partialPublishedUnitCount: new Set(partialCases.map((entry) => entry.unit.apiName)).size,
    auxiliaryPublishedCaseCount: publishedAuxiliaryCases.length,
    auxiliaryPublishedUnitCount: new Set(publishedAuxiliaryCases.map((entry) => entry.unit.apiName)).size,
    replacementComparisonCandidateCount: allComparisons.length,
    standardReplacementComparisonCount: standardComparisons.length,
    mechanismOnlyReplacementComparisonCount: mechanismOnlyComparisons.length
  },
  integrity: {
    duplicateCaseIds,
    duplicateCaseCount: allCases.length - deduplicatedCases.length,
    rejectionReasons: summarizeErrors(allRejectedRows),
    missingOfficialItems,
    statsValidatedCaseCount: deduplicatedCases.length,
    queryFingerprintIncludesProviderParameters: true,
    comparisonsAreNonCausal: true,
    fullComparisonPerUnitLimit: options.comparisonPerUnitLimit
  },
  artifacts: {
    publishedSnapshotDirectory: rawRelative(snapshotOutputDir),
    standardCases: rawRelative(resolve(snapshotOutputDir, "standard-cases.v1.jsonl")),
    partialOfficialCases: rawRelative(resolve(snapshotOutputDir, "partial-official-cases.v1.jsonl")),
    auxiliaryCases: rawRelative(resolve(snapshotOutputDir, "auxiliary-cases.v1.jsonl")),
    standardComparisons: rawRelative(resolve(snapshotOutputDir, "replacement-comparisons.v1.jsonl")),
    mechanismOnlyComparisons: rawRelative(resolve(snapshotOutputDir, "mechanism-only-replacement-comparisons.v1.jsonl")),
    fullCases: rawRelative(resolve(derivedDir, "mechanism-cases.full.v1.jsonl.gz")),
    comparisonCandidates: rawRelative(resolve(derivedDir, "replacement-comparisons.candidates.v1.jsonl.gz")),
    rawSnapshotDirectory: rawRelative(rawDir)
  },
  units: statuses.map((entry) => entry.status)
};
await writeJson(resolve(snapshotBuildDir, "capture-report.v1.json"), report);
await rename(snapshotBuildDir, snapshotOutputDir);

const indexPath = resolve(options.outputDir, "index.v1.json");
let index = {
  schemaVersion: "s17_mechanism_dataset_index.v1",
  latestSnapshotId: null,
  snapshots: []
};
if (await exists(indexPath)) index = JSON.parse(await readFile(indexPath, "utf8"));
if (index.snapshots.some((entry) => entry.snapshotId === snapshotId)) {
  throw new Error(`Snapshot already registered in dataset index: ${snapshotId}`);
}
index.snapshots.push({
  snapshotId,
  officialPatch,
  sourceCapturedAt,
  generatedAt,
  artifactDirectory: rawRelative(snapshotOutputDir),
  report: rawRelative(resolve(snapshotOutputDir, "capture-report.v1.json"))
});
index.snapshots.sort((a, b) => a.sourceCapturedAt.localeCompare(b.sourceCapturedAt));
index.latestSnapshotId = snapshotId;
await writeJson(indexPath, index);

console.log(JSON.stringify({
  snapshotId,
  officialPatch,
  queryableUnits: report.coverage.queryableUnitCount,
  capturedUnits: report.coverage.capturedUnitCount,
  failedUnits: report.coverage.failedUnitCount,
  traceableCases: report.coverage.traceableCaseCount,
  standardCases: report.coverage.standardCaseCount,
  standardComparisons: report.coverage.standardReplacementComparisonCount,
  mechanismOnlyComparisons: report.coverage.mechanismOnlyReplacementComparisonCount,
  rejectedRows: report.coverage.rejectedRowCount,
  outputDir: rawRelative(snapshotOutputDir),
  rawDir: rawRelative(rawDir)
}, null, 2));
if (report.coverage.failedUnitCount > 0) process.exitCode = 2;
