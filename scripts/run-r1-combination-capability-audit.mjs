import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime
} from "../src/app/small-window-server.js";
import { ITEM_ALIAS_OVERRIDES } from "../src/data/item-alias-overrides.js";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17335/"
);
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/combination-capability-audit.json"
);

function hashScore(seed, value) {
  return createHash("sha256").update(`${seed}|${value}`).digest("hex");
}

async function fetchJson(pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${pathname}`);
  return payload;
}

function toolByName(name) {
  return createStructuredToolDefinitions().find((definition) => definition.name === name);
}

function parameters(name) {
  return Object.keys(toolByName(name)?.inputSchema?.properties ?? {});
}

function enumValues(name, parameter) {
  return toolByName(name)?.inputSchema?.properties?.[parameter]?.enum ?? [];
}

function hasContestedItem(comp) {
  const owners = new Map();
  for (const unit of comp.units ?? []) {
    for (const item of new Set(unit.items ?? [])) {
      const values = owners.get(item) ?? [];
      values.push(unit.apiName);
      owners.set(item, values);
    }
  }
  return [...owners.values()].some((values) => values.length >= 2);
}

function contestedItem(comp) {
  const owners = new Map();
  for (const unit of comp.units ?? []) {
    for (const item of new Set(unit.items ?? [])) {
      const values = owners.get(item) ?? [];
      values.push(unit);
      owners.set(item, values);
    }
  }
  return [...owners.entries()]
    .filter(([, values]) => values.length >= 2)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0]
    ?? null;
}

async function runReact(input, conversationId, seasonContextId) {
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ input, conversationId, seasonContextId, startNewTask: true })
  });
  const text = await response.text();
  const lines = text.trim().split(/\n+/u).filter(Boolean).map((line) => JSON.parse(line));
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const complete = lines.findLast((line) => line.type === "complete");
  const payload = complete?.payload ?? {};
  return {
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    toolSequence: events
      .filter((event) => event.type === "tool_started")
      .map((event) => event.data?.tool),
    decisionTypes: events
      .filter((event) => event.type === "decision")
      .map((event) => event.data?.action?.type ?? event.data?.type ?? null),
    evidenceTypes: (payload.evidence ?? []).map((entry) => entry.evidenceType),
    rejectionErrors: events
      .filter((event) => event.type === "decision_rejected")
      .flatMap((event) => event.data?.errors ?? []),
    answerPreview: String(payload.answer ?? payload.question ?? "").slice(0, 800)
  };
}

const runtime = await fetchJson("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? null;
if (
  provenance?.decisionProviderMode !== "real_model"
  || provenance?.toolHandlerMode !== "production"
  || provenance?.fixtureMode !== false
) {
  throw new Error(`Production provenance check failed: ${JSON.stringify(provenance)}`);
}

const compPayload = await fetchJson("/api/recommend", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    input: "当前版本前四率最高的阵容有哪些？",
    preferences: { minSamples: 1 }
  })
});
const comps = compPayload.rankings?.top4Rate ?? [];
const eligible = comps.filter((comp) => (
  Array.isArray(comp.units)
  && comp.units.length >= 5
  && Array.isArray(comp.traits)
  && comp.traits.length >= 2
  && comp.units.filter((unit) => (unit.items ?? []).length > 0).length >= 2
));
if (!eligible.length) throw new Error("No production composition met the audit preconditions");

const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const seasonContextId = compPayload.source?.seasonContextId ?? "unknown";
const seed = createHash("sha256")
  .update(`${gitHead}|${seasonContextId}|R1-COMBINATION-CAPABILITY-AUDIT`)
  .digest("hex");
const selected = [...eligible].sort((left, right) => (
  hashScore(seed, left.source?.clusterId ?? left.name)
    .localeCompare(hashScore(seed, right.source?.clusterId ?? right.name))
))[0];
const contentionEligible = eligible.filter(hasContestedItem);
const contentionSelected = [...contentionEligible].sort((left, right) => (
  hashScore(`${seed}|contention`, left.source?.clusterId ?? left.name)
    .localeCompare(hashScore(`${seed}|contention`, right.source?.clusterId ?? right.name))
))[0] ?? null;
const target = [...selected.units].sort((left, right) => (
  hashScore(seed, left.apiName).localeCompare(hashScore(seed, right.apiName))
))[0];
const replacementPool = comps
  .flatMap((comp) => comp.units ?? [])
  .filter((unit, index, values) => (
    !selected.units.some((member) => member.apiName === unit.apiName)
    && values.findIndex((candidate) => candidate.apiName === unit.apiName) === index
  ));
const replacement = [...replacementPool].sort((left, right) => (
  hashScore(seed, left.apiName).localeCompare(hashScore(seed, right.apiName))
))[0] ?? null;
const contested = contentionSelected ? contestedItem(contentionSelected) : null;
const itemNames = new Map(ITEM_ALIAS_OVERRIDES.map((item) => [
  item.apiName,
  item.preferredDisplayName ?? item.zhName ?? item.shortName ?? item.apiName
]));

const entityTypes = enumValues("entity_catalog_query", "entityType");
const compMemberDefinition = toolByName("composition_member_statistics");
const batchParams = parameters("unit_builds_batch");
const preflightRuntime = createSmallWindowRuntime();
const preflightBundle = await createDefaultReactToolHandlerBundle({
  request: { seasonContextId },
  runtime: preflightRuntime,
  context: {}
});
const productionReactTools = preflightBundle.availableToolNames;
await preflightRuntime.storage?.close?.();
const sourceAudit = {
  G1_compositionResolution: {
    supported: entityTypes.includes("composition")
      || productionReactTools.includes("comps_rankings"),
    entityCatalogTypes: entityTypes,
    reactHasCompsRankings: productionReactTools.includes("comps_rankings"),
    reason: "entity_catalog_query only accepts unit/item/trait and the production ReAct handler bundle does not expose comps_rankings"
  },
  G2_compositionRoleEvidence: {
    supported: false,
    required: compMemberDefinition?.inputSchema?.required ?? [],
    evidenceType: compMemberDefinition?.evidenceType ?? null,
    reason: "composition_member_statistics is trait-scoped splash-unit aggregation and has no carry/tank/core-role contract"
  },
  G3_replacementImpact: {
    supported: false,
    unitDetailsAvailable: productionReactTools.includes("unit_details"),
    reason: "unit_details exposes traits, but no deterministic roster trait-delta/breakpoint implementation exists"
  },
  G4_compositionItemAllocation: {
    supported: false,
    reason: "no composition-aware contention detector, carrier priority evidence, or deterministic allocation policy exists"
  },
  G5_conditionalReallocation: {
    supported: ["excludedItems", "fixedItem", "itemOwner", "inventory"].some((name) => batchParams.includes(name)),
    batchParameters: batchParams,
    reason: "unit_builds_batch has rank/patch/time scope but no item ownership or exclusion constraint"
  }
};

const runId = Date.now();
const diagnostics = [];
diagnostics.push(await runReact(
  `当前版本“${selected.name}”这套阵容怎么组成？核心羁绊是什么？中期怎么运营？`,
  `ra-02c-a-${runId}`,
  seasonContextId
));
if (replacement) {
  diagnostics.push(await runReact(
    `在“${selected.name}”阵容里，${target.name}负责什么？如果换成${replacement.name}，羁绊和成型条件会怎么变？`,
    `ra-02c-b-${runId}`,
    seasonContextId
  ));
}
if (contested) {
  const [itemApiName, owners] = contested;
  diagnostics.push(await runReact(
    `“${contentionSelected.name}”阵容中，${owners.map((unit) => unit.name).join("和")}都可能使用${itemNames.get(itemApiName) ?? itemApiName}，应该优先给谁，另一方怎么调整？`,
    `ra-02c-c-${runId}`,
    seasonContextId
  ));
}

const blockers = Object.entries(sourceAudit)
  .filter(([, value]) => !value.supported)
  .map(([name]) => name);
const report = {
  schemaVersion: "r1-combination-capability-audit.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  gitHead,
  seed,
  provenance,
  runtimeRegisteredTools: runtime.runtime?.agent?.registeredTools ?? [],
  productionReactTools,
  liveCompositionData: {
    available: compPayload.ok === true && comps.length > 0,
    source: compPayload.source,
    candidateCount: comps.length,
    eligibleCount: eligible.length,
    contestedCandidateCount: eligible.filter(hasContestedItem).length
  },
  selection: {
    clusterId: selected.source?.clusterId ?? null,
    name: selected.name,
    unitCount: selected.units.length,
    traitCount: selected.traits.length,
    targetUnit: target ? { apiName: target.apiName, name: target.name } : null,
    replacementUnit: replacement ? { apiName: replacement.apiName, name: replacement.name } : null,
    contentionComposition: contentionSelected ? {
      clusterId: contentionSelected.source?.clusterId ?? null,
      name: contentionSelected.name
    } : null,
    contestedItem: contested ? {
      apiName: contested[0],
      name: itemNames.get(contested[0]) ?? contested[0],
      owners: contested[1].map((unit) => ({ apiName: unit.apiName, name: unit.name }))
    } : null
  },
  preflight: sourceAudit,
  diagnostics,
  cases: {
    "RA-02C-A-COMPOSITION": { status: sourceAudit.G1_compositionResolution.supported ? "READY" : "BLOCKED_BY_TOOL_CONTRACT_GAP" },
    "RA-02C-B-COMP-UNIT": { status: sourceAudit.G1_compositionResolution.supported && sourceAudit.G3_replacementImpact.supported ? "READY" : "BLOCKED_BY_TOOL_CONTRACT_GAP" },
    "RA-02C-C-COMP-ITEM": { status: sourceAudit.G1_compositionResolution.supported && sourceAudit.G2_compositionRoleEvidence.supported && sourceAudit.G4_compositionItemAllocation.supported ? "READY" : "BLOCKED_BY_TOOL_CONTRACT_GAP" },
    "R1-E2E-COMPOSITE-001": { status: blockers.length ? "BLOCKED_BY_TOOL_CONTRACT_GAP" : "READY" }
  },
  summary: {
    auditComplete: true,
    r1CombinationReady: blockers.length === 0,
    blockers
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary, selection: report.selection, diagnostics }, null, 2));
