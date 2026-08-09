import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17335/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))
  ?.slice("--season=".length) ?? "set17-live";
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/r1-g2r-g5-capability-preflight.json"
);

async function json(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function recommend(input, prefix) {
  return json("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input,
      conversationId: `${prefix}-${randomUUID()}`,
      seasonContextId
    })
  });
}

async function liveCompositions() {
  const requestId = randomUUID();
  const payload = await json("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: "推荐当前版本热门阵容",
      conversationId: `preflight-comps-${requestId}`,
      seasonContextId,
      quickTask: {
        schemaVersion: "quick-task.v1",
        id: "comp-rankings",
        operation: "comp_rankings",
        requestId,
        arguments: {}
      }
    })
  });
  const candidates = [
    ...(payload.rankings?.top4Rate ?? []),
    ...(payload.rankings?.popularity ?? []),
    ...(payload.rankings?.winRate ?? [])
  ];
  const seen = new Set();
  return candidates.filter((composition) => {
    if (!composition?.compId || !composition?.name || !composition.units?.length || seen.has(composition.compId)) {
      return false;
    }
    seen.add(composition.compId);
    return true;
  });
}

async function react(input, prefix) {
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      input,
      conversationId: `${prefix}-${randomUUID()}`,
      seasonContextId
    })
  });
  const raw = await response.text();
  const lines = raw.trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const payload = lines.findLast((line) => line.type === "complete")?.payload ?? {};
  return {
    statusCode: response.status,
    payload,
    toolSequence: events.filter((event) => event.type === "tool_started")
      .map((event) => event.data?.tool)
  };
}

const runtime = await json("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? null;
if (
  provenance?.decisionProviderMode !== "real_model"
  || provenance?.toolHandlerMode !== "production"
  || provenance?.fixtureMode !== false
) {
  throw new Error(`Real preflight provenance failed: ${JSON.stringify(provenance)}`);
}

const compositions = await liveCompositions();
if (compositions.length < 3) throw new Error("Need at least three dynamic production compositions");

const roleCases = [];
for (const [index, composition] of compositions.slice(0, 8).entries()) {
  const result = await react(
    `请解析${composition.name}阵容，只列出成员关系、官方定位和已有装备样本证据；不要推断主C、主坦或装备优先级。`,
    `g2r-${index + 1}`
  );
  const evidence = (result.payload.evidence ?? []).findLast((entry) => entry.toolName === "comps_rankings") ?? null;
  const resolved = evidence?.value?.resolution?.status === "resolved";
  const members = resolved ? evidence.value.results?.[0]?.members ?? [] : [];
  roleCases.push({
    caseId: `G2R-dynamic-${index + 1}`,
    selection: { compId: composition.compId, name: composition.name },
    status: result.payload.status ?? null,
    terminationReason: result.payload.terminationReason ?? null,
    toolSequence: result.toolSequence,
    resolution: evidence?.value?.resolution ?? null,
    members: members.map((member) => ({
      apiName: member.apiName,
      name: member.name,
      targetStarLevel: member.targetStarLevel,
      relations: member.relations,
      roleEvidence: member.roleEvidence,
      officialProfile: member.officialProfile,
      itemizationEvidence: member.itemizationEvidence
    }))
  });
  console.log(JSON.stringify({
    caseId: `G2R-dynamic-${index + 1}`,
    composition: composition.name,
    resolution: evidence?.value?.resolution?.status ?? null,
    memberCount: members.length
  }));
  if (roleCases.filter((entry) => entry.resolution?.status === "resolved").length >= 3) break;
}

const resolvedRoleCases = roleCases.filter((entry) => entry.resolution?.status === "resolved");
const roleMembers = resolvedRoleCases.flatMap((entry) => entry.members);
const uniqueOfficialRoles = [...new Set(roleMembers.map((member) => member.officialProfile?.role).filter(Boolean))];

const toolDefinitions = createStructuredToolDefinitions();
const unitBuildDefinition = toolDefinitions.find((entry) => entry.name === "unit_builds");
const unitBatchDefinition = toolDefinitions.find((entry) => entry.name === "unit_builds_batch");
const unitBuildProperties = Object.keys(unitBuildDefinition?.inputSchema?.properties ?? {});
const unitBatchProperties = Object.keys(unitBatchDefinition?.inputSchema?.properties ?? {});

const availabilityProbe = await react("你好", "g5-handler-availability");
const unavailableTools = availabilityProbe.payload.unavailableTools ?? [];

let exclusionProbe = null;
const exclusionAttempts = [];
outer:
for (const composition of compositions.slice(0, 8)) {
  for (const unit of composition.units ?? []) {
    let baseline;
    try {
      baseline = await recommend(`${unit.name}怎么做三件普通装备？`, "g5-baseline");
    } catch (error) {
      exclusionAttempts.push({
        composition: { compId: composition.compId, name: composition.name },
        unit: { apiName: unit.apiName, name: unit.name },
        stage: "baseline",
        error: String(error?.message ?? error).slice(0, 500)
      });
      continue;
    }
    const baselineCard = (baseline.cards ?? []).find((card) => card.items?.length === 3);
    const selectedItem = baselineCard?.items?.find((item) => item.apiName && (item.name ?? item.displayName));
    if (!baselineCard || !selectedItem) {
      exclusionAttempts.push({
        composition: { compId: composition.compId, name: composition.name },
        unit: { apiName: unit.apiName, name: unit.name },
        stage: "baseline",
        error: "no_three_item_card"
      });
      continue;
    }
    const itemName = selectedItem.name ?? selectedItem.displayName;
    let excluded;
    try {
      excluded = await recommend(
        `${unit.name}不要${itemName}，其他三件普通装备怎么带？`,
        "g5-excluded"
      );
    } catch (error) {
      exclusionAttempts.push({
        composition: { compId: composition.compId, name: composition.name },
        unit: { apiName: unit.apiName, name: unit.name },
        excludedItem: { apiName: selectedItem.apiName, name: itemName },
        stage: "constrained",
        error: String(error?.message ?? error).slice(0, 500)
      });
      continue;
    }
    const excludedApiNames = excluded.query?.excludedItems ?? [];
    const excludedCards = excluded.cards ?? [];
    exclusionProbe = {
      dynamicallySelected: true,
      composition: { compId: composition.compId, name: composition.name },
      unit: { apiName: unit.apiName, name: unit.name },
      excludedItem: { apiName: selectedItem.apiName, name: itemName },
      baseline: {
        status: baseline.status ?? null,
        cardCount: baseline.cards?.length ?? 0,
        firstCardItems: baselineCard.items.map((item) => item.apiName)
      },
      constrained: {
        status: excluded.status ?? null,
        queryExcludedItems: excludedApiNames,
        cardCount: excludedCards.length,
        cardItems: excludedCards.map((card) => (card.items ?? []).map((item) => item.apiName))
      },
      excludedItemReachedQuery: excludedApiNames.includes(selectedItem.apiName),
      excludedItemAbsentFromResults: excludedCards.length > 0 && excludedCards.every((card) => (
        !(card.items ?? []).some((item) => item.apiName === selectedItem.apiName)
      ))
    };
    break outer;
  }
}

const report = {
  schemaVersion: "r1-g2r-g5-capability-preflight.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  provenance,
  g2r: {
    dynamicCompositionCandidateCount: compositions.length,
    attemptedCompositionCount: roleCases.length,
    resolvedCompositionCount: resolvedRoleCases.length,
    memberCount: roleMembers.length,
    officialRoleCoverageCount: roleMembers.filter((member) => member.officialProfile?.role).length,
    itemizedCandidateCount: roleMembers.filter((member) => (
      member.relations?.includes("itemized_core_candidate")
    )).length,
    targetStarLevelCoverageCount: roleMembers.filter((member) => member.targetStarLevel != null).length,
    primaryCarrySupportedCount: roleMembers.filter((member) => (
      member.roleEvidence?.primaryCarry === "supported"
    )).length,
    primaryTankSupportedCount: roleMembers.filter((member) => (
      member.roleEvidence?.primaryTank === "supported"
    )).length,
    uniqueOfficialRoles,
    directlySupportedFields: [
      "member_of_comp",
      "officialProfile.role",
      "officialProfile.cost",
      "targetStarLevel",
      "itemized_core_candidate",
      "itemizationEvidence.games",
      "itemizationEvidence.items"
    ],
    unsupportedRoleConclusions: [
      "primary_carry",
      "primary_tank",
      "core_member",
      "flex_slot",
      "frontline_position",
      "backline_position",
      "allocation_priority"
    ],
    cases: roleCases
  },
  g5: {
    registeredUnitBuildConstraintFields: unitBuildProperties.filter((field) => (
      ["lockedItems", "excludedItems", "comparisonItems"].includes(field)
    )),
    registeredUnitBuildBatchConstraintFields: unitBatchProperties.filter((field) => (
      ["lockedItems", "excludedItems", "comparisonItems"].includes(field)
    )),
    runtimeUnavailableTools: unavailableTools,
    productionReactUnitBuildAvailable: !unavailableTools.includes("unit_builds"),
    productionReactUnitBuildBatchAvailable: !unavailableTools.includes("unit_builds_batch"),
    legacyProductionExclusionProbe: exclusionProbe,
    legacyProductionExclusionAttempts: exclusionAttempts,
    preflightConclusion: exclusionProbe?.excludedItemReachedQuery
      && exclusionProbe?.excludedItemAbsentFromResults
      && unavailableTools.includes("unit_builds")
      && !unitBatchProperties.includes("excludedItems")
      ? "legacy_constraint_query_supported_but_react_path_missing"
      : "capability_not_proven"
  }
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  g2r: {
    resolvedCompositionCount: report.g2r.resolvedCompositionCount,
    memberCount: report.g2r.memberCount,
    officialRoleCoverageCount: report.g2r.officialRoleCoverageCount,
    itemizedCandidateCount: report.g2r.itemizedCandidateCount,
    primaryCarrySupportedCount: report.g2r.primaryCarrySupportedCount,
    primaryTankSupportedCount: report.g2r.primaryTankSupportedCount
  },
  g5: {
    unitBuildConstraintFields: report.g5.registeredUnitBuildConstraintFields,
    unitBuildBatchConstraintFields: report.g5.registeredUnitBuildBatchConstraintFields,
    productionReactUnitBuildAvailable: report.g5.productionReactUnitBuildAvailable,
    exclusionProbePassed: Boolean(
      exclusionProbe?.excludedItemReachedQuery && exclusionProbe?.excludedItemAbsentFromResults
    ),
    preflightConclusion: report.g5.preflightConclusion
  }
}, null, 2));

if (
  resolvedRoleCases.length < 3
  || roleMembers.length === 0
  || !exclusionProbe?.excludedItemReachedQuery
  || !exclusionProbe?.excludedItemAbsentFromResults
) process.exitCode = 1;
