import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  assignUnitsToDiscoverySplits,
  buildFactorDiscoveryPack,
  normalizeFactorCandidate,
  selectStratifiedDiscoveryCases,
  validateFactorCandidate
} from "../src/knowledge/mechanism-discovery.js";
import {
  createMechanismExtractionProvider,
  resolveMechanismExtractionConfig
} from "../src/knowledge/mechanism-extraction-provider.js";
import {
  buildFactorSchemaEnvelope,
  collectFactorObservations,
  validateNormalizedFactorSchema
} from "../src/knowledge/mechanism-factor-normalizer.js";
import { sha256, stableStringify } from "../src/knowledge/mechanic-atom-extractor.js";

function parseArgs(argv) {
  const options = {
    datasetRoot: resolve("data", "generated", "mechanisms", "s17"),
    cacheRoot: resolve(".cache", "s17-factor-discovery"),
    limit: 300,
    concurrency: 3,
    correctionAttempts: 3,
    prepareOnly: false,
    extractOnly: false,
    batch: null
  };
  for (const arg of argv) {
    if (arg === "--prepare-only") options.prepareOnly = true;
    else if (arg === "--extract-only") options.extractOnly = true;
    else if (arg.startsWith("--batch=")) {
      options.batch = Number(arg.slice("--batch=".length));
      options.extractOnly = true;
    }
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--concurrency=")) options.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--dataset-root=")) options.datasetRoot = resolve(arg.slice("--dataset-root=".length));
    else if (arg.startsWith("--cache-root=")) options.cacheRoot = resolve(arg.slice("--cache-root=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8");
  }
  if (options.batch !== null && (!Number.isInteger(options.batch) || options.batch < 1)) {
    throw new Error("--batch must be a positive integer");
  }
  return options;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readGzipJsonl(path) {
  const rows = [];
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, values.map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeJson(temporary, value);
  await rename(temporary, path);
}

function usageTotal(total, usage) {
  for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    total[field] = (total[field] ?? 0) + Number(usage?.[field] ?? 0);
  }
}

async function callWithValidation(provider, pack, validate, attempts, normalize = (value) => value) {
  let previousOutput = null;
  let feedback = null;
  let usage = {};
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await provider({
        pack,
        validationFeedback: feedback,
        previousOutput
      });
    } catch (error) {
      if (error?.recoverable && attempt < attempts) {
        feedback = [`provider_${error.code ?? "error"}: retry with one strict JSON object`];
        continue;
      }
      throw error;
    }
    usageTotal(usage, response.usage);
    const normalizedValue = normalize(response.value);
    const errors = validate(normalizedValue);
    if (errors.length === 0) return { value: normalizedValue, usage, corrections: attempt };
    previousOutput = normalizedValue;
    feedback = errors.slice(0, 30);
  }
  const error = new Error(`Provider output failed validation: ${feedback.join("; ")}`);
  error.code = "validation_failed";
  error.validationErrors = feedback;
  error.previousOutput = previousOutput;
  error.usage = usage;
  throw error;
}

async function mapConcurrent(values, concurrency, worker) {
  let cursor = 0;
  const results = new Array(values.length);
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function schemaObservationIds(schema) {
  const ids = new Set();
  for (const factor of schema?.factors ?? []) {
    for (const id of factor.positiveObservationIds ?? []) ids.add(id);
    for (const id of factor.negativeObservationIds ?? []) ids.add(id);
  }
  for (const theory of schema?.theoryCandidates ?? []) {
    for (const id of theory.supportingObservationIds ?? []) ids.add(id);
    for (const id of theory.counterObservationIds ?? []) ids.add(id);
  }
  for (const unmapped of schema?.unmappedFactors ?? []) {
    for (const id of unmapped.observationIds ?? []) ids.add(id);
  }
  return ids;
}

function relationCounts(candidates) {
  const counts = {};
  for (const candidate of candidates) {
    for (const relationship of candidate.relationshipCandidates ?? []) {
      counts[relationship.relationType] = (counts[relationship.relationType] ?? 0) + 1;
    }
  }
  return counts;
}

function countBy(values, keySelector) {
  const counts = {};
  for (const value of values) {
    const key = keySelector(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const options = parseArgs(process.argv.slice(2));
loadLocalEnvironment();

const indexPath = resolve(options.datasetRoot, "index.v1.json");
const datasetIndex = await readJson(indexPath);
const latest = datasetIndex.snapshots.find((entry) => entry.snapshotId === datasetIndex.latestSnapshotId);
if (!latest) throw new Error("Latest S17 mechanism snapshot is missing from index");
const snapshotDirectory = resolve(latest.artifactDirectory);
const report = await readJson(resolve(snapshotDirectory, "capture-report.v1.json"));
const fullCasesPath = resolve(report.artifacts.fullCases);
const comparisonCandidatesPath = resolve(report.artifacts.comparisonCandidates);
if (!await exists(fullCasesPath) || !await exists(comparisonCandidatesPath)) {
  throw new Error("Full derived snapshot is unavailable; Stage B requires the immutable Stage A raw-derived files");
}

const [allCases, allComparisons] = await Promise.all([
  readGzipJsonl(fullCasesPath),
  readGzipJsonl(comparisonCandidatesPath)
]);
const playableCompleteCases = allCases.filter((entry) => (
  entry.unit?.entityType !== "auxiliary"
  && entry.evidencePolicy?.officialTextComplete === true
));
const splitManifest = assignUnitsToDiscoverySplits(playableCompleteCases);
const selected = selectStratifiedDiscoveryCases(
  playableCompleteCases,
  allComparisons,
  splitManifest,
  { limit: options.limit, split: "discovery" }
);

const extractionConfig = resolveMechanismExtractionConfig();
const runKey = sha256(stableStringify({
  snapshotId: latest.snapshotId,
  splitHash: splitManifest.hash,
  sampleHash: selected.manifest.hash,
  model: extractionConfig.model,
  promptVersion: extractionConfig.promptVersion
})).slice(0, 20);
const workDirectory = resolve(options.cacheRoot, latest.snapshotId, runKey);
await mkdir(workDirectory, { recursive: true });
await Promise.all([
  writeJson(resolve(workDirectory, "split-manifest.v1.json"), splitManifest),
  writeJson(resolve(workDirectory, "sample-manifest.v1.json"), selected.manifest)
]);

console.log(JSON.stringify({
  stage: "prepared",
  snapshotId: latest.snapshotId,
  patch: latest.officialPatch,
  completePlayableCases: playableCompleteCases.length,
  splitCounts: splitManifest.counts,
  selectedCases: selected.cases.length,
  selectedUnits: selected.manifest.unitCount,
  runKey,
  workDirectory
}));

if (options.prepareOnly) process.exit(0);
if (!extractionConfig.enabled) {
  throw new Error(`Mechanism discovery provider is not configured: ${extractionConfig.missing.join(", ")}`);
}

const extractionProvider = createMechanismExtractionProvider(extractionConfig);
const packs = selected.cases.map((caseRecord) => buildFactorDiscoveryPack(
  caseRecord,
  allComparisons,
  { allCases, maxComparisons: 3 }
));
const candidateDirectory = resolve(workDirectory, "candidates");
await mkdir(candidateDirectory, { recursive: true });
const extractionUsage = {};
let completed = 0;
let resumed = 0;
let corrections = 0;

const cachedCandidates = new Map();
const pendingPacks = [];
for (const pack of packs) {
  const candidatePath = resolve(candidateDirectory, `${sha256(pack.caseId)}.json`);
  if (await exists(candidatePath)) {
    const cached = await readJson(candidatePath);
    const errors = validateFactorCandidate(cached, pack);
    if (errors.length === 0) {
      cachedCandidates.set(pack.caseId, cached);
      continue;
    }
  }
  pendingPacks.push(pack);
}
resumed = cachedCandidates.size;
const runPacks = options.batch === null ? pendingPacks : pendingPacks.slice(0, options.batch);
console.log(JSON.stringify({
  stage: "extraction_plan",
  cached: cachedCandidates.size,
  pending: pendingPacks.length,
  runningNow: runPacks.length
}));

const newCandidates = await mapConcurrent(runPacks, options.concurrency, async (pack) => {
  const candidatePath = resolve(candidateDirectory, `${sha256(pack.caseId)}.json`);
  const result = await callWithValidation(
    extractionProvider,
    pack,
    (value) => validateFactorCandidate(value, pack),
    options.correctionAttempts,
    (value) => normalizeFactorCandidate(value, { caseId: pack.caseId })
  );
  usageTotal(extractionUsage, result.usage);
  corrections += result.corrections;
  await writeJsonAtomic(candidatePath, result.value);
  completed += 1;
  if (completed % 5 === 0 || completed === runPacks.length) {
    console.log(JSON.stringify({
      stage: "extracting",
      completed,
      runningNow: runPacks.length,
      totalCachedAfterBatch: resumed + completed,
      total: packs.length
    }));
  }
  return result.value;
});
for (const candidate of newCandidates) cachedCandidates.set(candidate.caseId, candidate);
const candidates = packs.map((pack) => cachedCandidates.get(pack.caseId)).filter(Boolean);
await writeJsonl(resolve(workDirectory, "factor-candidates.v1.jsonl"), candidates);

if (options.extractOnly) {
  console.log(JSON.stringify({
    stage: "extracted",
    candidates: candidates.length,
    remaining: packs.length - candidates.length,
    corrections,
    usage: extractionUsage,
    workDirectory
  }));
  process.exit(0);
}

const observations = collectFactorObservations(candidates);
const entityNames = uniqueNames(allCases);
const normalizationPromptUrl = new URL(
  "../src/knowledge/prompts/normalize-mechanism-factors.md",
  import.meta.url
);
const normalizationProvider = createMechanismExtractionProvider({
  ...extractionConfig,
  promptUrl: normalizationPromptUrl,
  maxOutputTokens: Math.max(extractionConfig.maxOutputTokens, 5000),
  thinkingMode: "disabled",
  temperature: 0.1
});
const normalizationUsage = {};
const observationChunks = chunks(observations, 20);
const normalizationDirectory = resolve(workDirectory, "normalization");
await mkdir(normalizationDirectory, { recursive: true });
let normalizedBatchCount = 0;
let cachedNormalizationCount = 0;
let fallbackUnmappedCount = 0;
function unresolvedNormalizationSchema(observationChunk, error) {
  fallbackUnmappedCount += observationChunk.length;
  return {
    schemaVersion: "mechanism-factor-schema.v1",
    factors: [],
    theoryCandidates: [],
    unmappedFactors: [{
      unmappedId: `unmapped:normalization-${sha256(stableStringify(
        observationChunk.map((entry) => entry.observationId)
      )).slice(0, 20)}`,
      label: "无法安全归并的机制观察",
      reason: `最小证据块在多次模型抽取或本地校验后仍失败，保留为待人工审核；错误类别：${error.code ?? "provider_error"}`,
      observationIds: observationChunk.map((entry) => entry.observationId),
      reviewStatus: "unmapped"
    }]
  };
}
async function normalizeObservationChunk(observationChunk, depth = 0) {
  const chunkKey = sha256(stableStringify(observationChunk.map((entry) => entry.observationId))).slice(0, 24);
  const cachePath = resolve(normalizationDirectory, `batch-${chunkKey}.json`);
  const splitPath = resolve(normalizationDirectory, `split-${chunkKey}.json`);
  if (await exists(cachePath)) {
    const cached = await readJson(cachePath);
    const errors = validateNormalizedFactorSchema(cached, observationChunk, {
      entityNames,
      requireNegativeExamples: false
    });
    if (errors.length === 0) {
      cachedNormalizationCount += 1;
      return [cached];
    }
  }
  if (await exists(splitPath)) {
    const split = await readJson(splitPath);
    const middle = Number(split.middle);
    const left = await normalizeObservationChunk(observationChunk.slice(0, middle), depth + 1);
    const right = await normalizeObservationChunk(observationChunk.slice(middle), depth + 1);
    return [...left, ...right];
  }
  try {
    const response = await callWithValidation(
      normalizationProvider,
      {
        schemaVersion: "mechanism_factor_normalization_input.v1",
        season: "S17",
        patch: latest.officialPatch,
        observations: observationChunk
      },
      (value) => validateNormalizedFactorSchema(value, observationChunk, {
        entityNames,
        requireNegativeExamples: false
      }),
      options.correctionAttempts
    );
    usageTotal(normalizationUsage, response.usage);
    await writeJsonAtomic(cachePath, response.value);
    normalizedBatchCount += 1;
    console.log(JSON.stringify({
      stage: "normalizing",
      completed: normalizedBatchCount,
      chunkSize: observationChunk.length,
      depth
    }));
    return [response.value];
  } catch (error) {
    if (observationChunk.length <= 8) {
      const fallback = unresolvedNormalizationSchema(observationChunk, error);
      await writeJsonAtomic(cachePath, fallback);
      console.log(JSON.stringify({
        stage: "normalization_unmapped",
        chunkSize: observationChunk.length,
        depth,
        reason: error.code ?? "provider_error"
      }));
      return [fallback];
    }
    const middle = Math.ceil(observationChunk.length / 2);
    console.log(JSON.stringify({
      stage: "normalization_split",
      chunkSize: observationChunk.length,
      depth,
      reason: error.code ?? "provider_error"
    }));
    await writeJsonAtomic(splitPath, {
      schemaVersion: "mechanism_normalization_split.v1",
      chunkKey,
      middle,
      reason: error.code ?? "provider_error"
    });
    const left = await normalizeObservationChunk(observationChunk.slice(0, middle), depth + 1);
    const right = await normalizeObservationChunk(observationChunk.slice(middle), depth + 1);
    return [...left, ...right];
  }
}
console.log(JSON.stringify({
  stage: "normalization_plan",
  chunks: observationChunks.length
}));
const normalizedChunkGroups = await mapConcurrent(
  observationChunks,
  Math.min(options.concurrency, 8),
  (observationChunk) => normalizeObservationChunk(observationChunk)
);
const partialSchemas = normalizedChunkGroups.flat();
console.log(JSON.stringify({
  stage: "normalization_complete",
  schemas: partialSchemas.length,
  newlyGenerated: normalizedBatchCount,
  cached: cachedNormalizationCount,
  fallbackUnmappedObservations: fallbackUnmappedCount
}));

let normalized;
if (partialSchemas.length === 1) {
  normalized = partialSchemas[0];
} else {
  const consolidationProvider = createMechanismExtractionProvider({
    ...extractionConfig,
    promptUrl: new URL(
      "../src/knowledge/prompts/consolidate-mechanism-factors.md",
      import.meta.url
    ),
    maxOutputTokens: Math.max(extractionConfig.maxOutputTokens, 8000),
    thinkingMode: "disabled",
    temperature: 0.1
  });
  let level = 0;
  let levelSchemas = partialSchemas;
  let fallbackConsolidationObservations = 0;
  function unresolvedConsolidationSchema(groupObservations, error, groupKey) {
    fallbackConsolidationObservations += groupObservations.length;
    return {
      schemaVersion: "mechanism-factor-schema.v1",
      factors: [],
      theoryCandidates: [],
      unmappedFactors: [{
        unmappedId: `unmapped:consolidation-${groupKey}`,
        label: "无法安全合并的机制候选",
        reason: `候选组在多次全局归并或校验后仍失败，保留为待人工审核；错误类别：${error.code ?? "provider_error"}`,
        observationIds: groupObservations.map((entry) => entry.observationId),
        reviewStatus: "unmapped"
      }]
    };
  }
  async function consolidateGroup(group, currentLevel, depth = 0) {
    if (group.length === 1) return [group[0]];
    const groupIds = new Set(group.flatMap((schema) => [...schemaObservationIds(schema)]));
    const groupObservations = observations.filter((entry) => groupIds.has(entry.observationId));
    const groupKey = sha256(stableStringify(group)).slice(0, 24);
    const cachePath = resolve(normalizationDirectory, `merge-${currentLevel}-${groupKey}.json`);
    const splitPath = resolve(normalizationDirectory, `merge-split-${currentLevel}-${groupKey}.json`);
    if (await exists(cachePath)) {
      const cached = await readJson(cachePath);
      const errors = validateNormalizedFactorSchema(cached, groupObservations, { entityNames });
      if (errors.length === 0) return [cached];
    }
    if (await exists(splitPath)) {
      const split = await readJson(splitPath);
      const middle = Number(split.middle);
      const left = await consolidateGroup(group.slice(0, middle), currentLevel, depth + 1);
      const right = await consolidateGroup(group.slice(middle), currentLevel, depth + 1);
      return [...left, ...right];
    }
    try {
      const response = await callWithValidation(
        consolidationProvider,
        {
          schemaVersion: "mechanism_factor_consolidation_input.v1",
          season: "S17",
          patch: latest.officialPatch,
          candidateSchemas: group
        },
        (value) => validateNormalizedFactorSchema(value, groupObservations, { entityNames }),
        Math.min(options.correctionAttempts, 1)
      );
      usageTotal(normalizationUsage, response.usage);
      await writeJsonAtomic(cachePath, response.value);
      return [response.value];
    } catch (error) {
      if (group.length <= 2) {
        const fallback = unresolvedConsolidationSchema(groupObservations, error, groupKey);
        await writeJsonAtomic(cachePath, fallback);
        console.log(JSON.stringify({
          stage: "consolidation_unmapped",
          level: currentLevel,
          depth,
          observations: groupObservations.length,
          reason: error.code ?? "provider_error"
        }));
        return [fallback];
      }
      const middle = Math.ceil(group.length / 2);
      await writeJsonAtomic(splitPath, {
        schemaVersion: "mechanism_consolidation_split.v1",
        groupKey,
        middle,
        reason: error.code ?? "provider_error"
      });
      console.log(JSON.stringify({
        stage: "consolidation_split",
        level: currentLevel,
        depth,
        groupSize: group.length,
        reason: error.code ?? "provider_error"
      }));
      const left = await consolidateGroup(group.slice(0, middle), currentLevel, depth + 1);
      const right = await consolidateGroup(group.slice(middle), currentLevel, depth + 1);
      return [...left, ...right];
    }
  }
  while (levelSchemas.length > 1) {
    const groups = chunks(levelSchemas, 4);
    let consolidatedCount = 0;
    const consolidatedGroups = await mapConcurrent(groups, Math.min(options.concurrency, 8), async (group) => {
      const values = await consolidateGroup(group, level);
      consolidatedCount += 1;
      console.log(JSON.stringify({
        stage: "consolidating",
        level,
        completed: consolidatedCount,
        total: groups.length
      }));
      return values;
    });
    levelSchemas = consolidatedGroups.flat();
    level += 1;
  }
  normalized = levelSchemas[0];
  console.log(JSON.stringify({
    stage: "consolidation_complete",
    levels: level,
    fallbackUnmappedObservations: fallbackConsolidationObservations
  }));
}

const generatedAt = new Date().toISOString();
const factorSchema = buildFactorSchemaEnvelope(normalized, observations, {
  season: "S17",
  patch: latest.officialPatch,
  sourceSnapshotId: latest.snapshotId,
  discoverySplitHash: splitManifest.hash,
  sampleHash: selected.manifest.hash,
  model: extractionConfig.model,
  promptVersion: extractionConfig.promptVersion,
  generatedAt
});
const finalErrors = validateNormalizedFactorSchema(factorSchema, observations, { entityNames });
if (finalErrors.length) {
  throw new Error(`Final mechanism factor schema failed validation: ${finalErrors.join("; ")}`);
}

const publicationDirectory = resolve(
  options.datasetRoot,
  "discovery",
  latest.officialPatch,
  latest.snapshotId,
  runKey
);
if (await exists(publicationDirectory)) {
  throw new Error(`Immutable factor discovery run already exists: ${publicationDirectory}`);
}
const buildingDirectory = `${publicationDirectory}.building-${process.pid}`;
await mkdir(buildingDirectory, { recursive: true });
const discoveryReport = {
  schemaVersion: "s17_factor_discovery_report.v1",
  runKey,
  sourceSnapshotId: latest.snapshotId,
  season: "S17",
  patch: latest.officialPatch,
  generatedAt,
  provider: {
    type: "openai_compatible",
    endpointHost: new URL(extractionConfig.endpoint).host,
    model: extractionConfig.model,
    promptVersion: extractionConfig.promptVersion
  },
  isolation: {
    unitSplit: splitManifest.counts,
    splitHash: splitManifest.hash,
    discoveryUnitCount: selected.manifest.unitCount,
    adjustmentAndBlindCasesSentToProvider: 0
  },
  sampling: {
    selectedCaseCount: selected.cases.length,
    sampleHash: selected.manifest.hash,
    strata: countBy(selected.manifest.cases, (entry) => entry.stratum)
  },
  extraction: {
    candidateCount: candidates.length,
    observationCount: observations.length,
    correctionCount: corrections,
    resumedCount: resumed,
    relationTypeCounts: relationCounts(candidates),
    usage: extractionUsage
  },
  normalization: {
    batchCount: partialSchemas.length,
    factorCount: factorSchema.factors.length,
    theoryCandidateCount: factorSchema.theoryCandidates.length,
    unmappedFactorCount: factorSchema.unmappedFactors.length,
    usage: normalizationUsage,
    reviewStatus: "candidate_requires_human_review"
  },
  evidencePolicy: {
    statisticalCorrelationIsCausal: false,
    exactFormulaClaimsAllowed: false,
    multiplicativeRelationsAreHypotheses: true,
    fixedEntityBuildAnswersAllowed: false
  }
};
await Promise.all([
  writeJson(resolve(buildingDirectory, "split-manifest.v1.json"), splitManifest),
  writeJson(resolve(buildingDirectory, "sample-manifest.v1.json"), selected.manifest),
  writeJsonl(resolve(buildingDirectory, "factor-candidates.v1.jsonl"), candidates),
  writeJson(resolve(buildingDirectory, "factor-schema.candidate.v1.json"), factorSchema),
  writeJson(resolve(buildingDirectory, "discovery-report.v1.json"), discoveryReport)
]);
await mkdir(dirname(publicationDirectory), { recursive: true });
await rename(buildingDirectory, publicationDirectory);

const discoveryIndexPath = resolve(options.datasetRoot, "discovery", "index.v1.json");
const discoveryIndex = await exists(discoveryIndexPath)
  ? await readJson(discoveryIndexPath)
  : { schemaVersion: "s17_factor_discovery_index.v1", runs: [] };
discoveryIndex.latestRunKey = runKey;
discoveryIndex.runs.push({
  runKey,
  sourceSnapshotId: latest.snapshotId,
  patch: latest.officialPatch,
  generatedAt,
  artifactDirectory: publicationDirectory.replaceAll("\\", "/"),
  factorSchema: resolve(publicationDirectory, "factor-schema.candidate.v1.json").replaceAll("\\", "/"),
  report: resolve(publicationDirectory, "discovery-report.v1.json").replaceAll("\\", "/")
});
await writeJsonAtomic(discoveryIndexPath, discoveryIndex);

console.log(JSON.stringify({
  stage: "published",
  runKey,
  publicationDirectory,
  candidateCount: candidates.length,
  observationCount: observations.length,
  factorCount: factorSchema.factors.length,
  theoryCandidateCount: factorSchema.theoryCandidates.length,
  unmappedFactorCount: factorSchema.unmappedFactors.length
}));

function uniqueNames(cases) {
  const names = new Set();
  for (const entry of cases) {
    for (const value of [
      entry.unit?.name,
      entry.unit?.apiName,
      ...(entry.items ?? []).flatMap((item) => [item.name, item.apiName])
    ]) {
      if (value) names.add(String(value));
    }
  }
  return [...names];
}
