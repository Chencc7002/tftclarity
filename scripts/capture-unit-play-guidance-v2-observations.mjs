import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime
} from "../src/app/small-window-server.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPERIMENT_ID = "unit-play-guidance-forward.2026-09-01.v2";
const SEASON_CONTEXT_ID = "set18-live";
const TARGET_COUNT = 10;
const output = path.resolve(ROOT, process.argv.find((value) => value.startsWith("--output="))
  ?.slice("--output=".length) ?? ".cache/eval/unit-play-guidance-v2-observation-capture.json");

try {
  await access(output);
  throw new Error(`Refusing to overwrite existing capture: ${output}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const runtime = createSmallWindowRuntime();
runtime.reactUnitPlayItemMechanismBatch = true;
runtime.reactOfficialItemEvidenceV1 = true;

const run = {
  budget: { maxRetriesPerTool: 1 },
  assertActive() {},
  consumeToolCall() {},
  consumeRetry() {},
  emit() {}
};

async function bundleFor(unit = null) {
  const semanticAdvisory = unit ? {
    action: "recommend",
    goal: "recommend_unit_play",
    subject: { resolvedId: unit.apiName, canonicalName: unit.name },
    expectedOutput: ["unit_play_guidance"]
  } : null;
  return createDefaultReactToolHandlerBundle({
    request: { seasonContextId: SEASON_CONTEXT_ID, locale: "zh-CN", semanticAdvisory },
    runtime,
    context: {}
  });
}

async function execute(bundle, tool, input) {
  const handler = bundle.handlers[tool];
  if (typeof handler !== "function") throw new Error(`Missing registered handler: ${tool}`);
  const result = await runtime.toolExecutor.execute(tool, input, {
    handler,
    run,
    maxRetriesPerTool: 1,
    timeoutMs: 30_000
  });
  if (result.status !== "completed") throw new Error(`${tool} did not complete`);
  return result;
}

function score(unit) {
  return createHash("sha256").update(`${EXPERIMENT_ID}\0${unit.apiName}`).digest("hex");
}

function playable(unit) {
  return Number.isInteger(unit.cost) && unit.cost >= 1 && unit.cost <= 5
    && /^(?:DA_|TFT18_)[A-Za-z0-9_]+$/u.test(String(unit.apiName ?? ""))
    && !/(?:Summon|PVE|Cinderling|Brambleback|Sentinel|Sentry|Murkwolf|Dummy|Test|Akali_AD)/iu.test(unit.apiName);
}

function spreadByCost(units) {
  const sorted = [...units].sort((left, right) => score(left).localeCompare(score(right)));
  const groups = new Map([1, 2, 3, 4, 5].map((cost) => [cost, sorted.filter((unit) => unit.cost === cost)]));
  const output = [];
  let layer = 0;
  while (output.length < sorted.length) {
    let progressed = false;
    for (const cost of [1, 2, 3, 4, 5]) {
      const unit = groups.get(cost)?.[layer];
      if (!unit) continue;
      output.push(unit);
      progressed = true;
    }
    if (!progressed) break;
    layer += 1;
  }
  return output;
}

async function captureUnit(unit) {
  const bundle = await bundleFor(unit);
  const unitDetails = await execute(bundle, "unit_details", { apiName: unit.apiName });
  if (unitDetails.value?.status !== "found") throw new Error("official unit details unavailable");

  const unitBuilds = await execute(bundle, "unit_builds", { unit: unit.apiName });
  const mechanismPlan = unitBuilds.value?.mechanismQueryPlan;
  if (mechanismPlan?.schemaVersion !== "unit-play-item-mechanism-query-plan.v1"
    || mechanismPlan.status !== "available" || mechanismPlan.apiNames?.length !== 3) {
    throw new Error("leading three-item mechanism plan unavailable");
  }
  const itemDetailsBatch = await execute(bundle, "item_details_batch", {
    apiNames: mechanismPlan.apiNames,
    seasonContextId: mechanismPlan.seasonContextId
  });
  if (itemDetailsBatch.value?.mechanismStatus !== "available"
    || itemDetailsBatch.value?.items?.some((item) => item.status !== "found")) {
    throw new Error("official item batch unavailable");
  }

  const initialComps = await execute(bundle, "comps_rankings", { unit: unit.apiName });
  const candidates = (initialComps.value?.results ?? []).slice(0, 2);
  if (candidates.length !== 2) throw new Error(`expected two composition candidates, received ${candidates.length}`);
  const cards = [];
  for (const candidate of candidates) {
    const mention = candidate.compositionRef?.compId;
    if (!mention) throw new Error("composition candidate has no compId");
    const resolvedComps = await execute(bundle, "comps_rankings", { mention });
    const resolved = resolvedComps.value?.results?.find((entry) => (
      entry.compositionRef?.compId === mention
    )) ?? resolvedComps.value?.results?.[0];
    const plan = resolved?.tacticalDetailQueryPlan;
    if (!plan || plan.status !== "ready") throw new Error(`tactical plan unavailable for ${mention}`);
    const tacticalDetails = await execute(bundle, "composition_tactical_details", {
      compositionId: plan.compositionId,
      clusterId: plan.clusterId,
      units: plan.units,
      seasonContextId: plan.seasonContextId
    });
    if (tacticalDetails.value?.formation?.status !== "available"
      || tacticalDetails.value.formation.units?.length < 5) {
      throw new Error(`complete formation unavailable for ${mention}`);
    }
    cards.push({ candidate, resolvedComps, tacticalDetails });
  }
  return { unit, unitDetails, unitBuilds, itemDetailsBatch, initialComps, cards };
}

let catalogResult;
const captured = [];
const failures = [];
try {
  const catalogBundle = await bundleFor();
  catalogResult = await execute(catalogBundle, "entity_catalog_query", {
    entityType: "unit",
    filters: { current: true },
    projection: ["apiName", "name", "cost", "traits"]
  });
  const candidates = spreadByCost((catalogResult.value?.results ?? []).filter(playable));
  for (const unit of candidates) {
    if (captured.length >= TARGET_COUNT) break;
    try {
      captured.push(await captureUnit(unit));
      console.log(`captured ${captured.length}/${TARGET_COUNT}: ${unit.name ?? unit.apiName}`);
    } catch (error) {
      failures.push({ apiName: unit.apiName, name: unit.name ?? null, reason: String(error?.message ?? error) });
      console.log(`skipped ${unit.name ?? unit.apiName}: ${error?.message ?? error}`);
    }
  }
  if (captured.length !== TARGET_COUNT) throw new Error(`Only ${captured.length}/${TARGET_COUNT} units had complete frozen inputs`);
  const payload = {
    schemaVersion: "unit-play-guidance-forward-observation-capture.v2",
    experimentId: EXPERIMENT_ID,
    capturedAt: new Date().toISOString(),
    seasonContextId: SEASON_CONTEXT_ID,
    selection: {
      method: "sha256_round_robin_by_cost",
      seed: EXPERIMENT_ID,
      targetCount: TARGET_COUNT,
      selected: captured.map(({ unit }) => ({ apiName: unit.apiName, name: unit.name, cost: unit.cost }))
    },
    provenance: {
      providerModelCalls: 0,
      registeredToolExecutorOnly: true,
      liveRetrievalOccurredBeforeFreeze: true,
      canonicalReplayMustUseOnlyTheseFrozenValues: true
    },
    catalogResult,
    units: Object.fromEntries(captured.map((entry) => [entry.unit.apiName, entry])),
    rejectedCandidates: failures
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output, captured: captured.length, skipped: failures.length, providerModelCalls: 0 }, null, 2));
} finally {
  await runtime.storage?.close?.();
}
