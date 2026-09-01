import { validateToolEvidence } from "../../agent/tool-evidence-validator.js";
import { buildSkillContext, SKILL_DEPENDENCY_TOOLS } from "../../skills/context.js";
import { evaluateSkillProgress } from "../../skills/progress.js";
import { projectSkillCompletion } from "../../skills/validator.js";
import { officialItemEvidenceFailure, officialItemBatchEvidenceFailure } from "../../agent/official-item-evidence.js";

export const UNIT_PLAY_EVIDENCE_ADAPTER_VERSION = "unit-play-evidence-shadow.v1";
const MAX_ENTRIES = 64;
const MAX_OBSERVATIONS = 128;
const MAX_ENTRY_BYTES = 256 * 1024;
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : null;
const sameSet = (a, b) => [...new Set(a)].sort().join("\0") === [...new Set(b)].sort().join("\0");
// MetaTFT ranking sources use epoch milliseconds; other registered tools use ISO.
const timestampMs = (value) => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;

function temporalFailure(entry, now, maxAgeMs) {
  const value = entry.value;
  const metadata = entry.metadata;
  if (entry.toolName === "composition_tactical_details" && !Number.isFinite(timestampMs(value?.formation?.source?.updatedAt))) return "freshness_unknown";
  if ([entry.temporalStatus, metadata?.temporalStatus].includes("historical")) return "historical_evidence";
  if ([metadata?.freshnessStatus, metadata?.freshness?.status].some((status) => ["stale", "expired"].includes(status))
    || metadata?.stale === true || metadata?.cache?.stale === true || value?.cache?.stale === true) return "stale_evidence";
  const timestamps = [entry.updatedAt, metadata?.updatedAt, value?.updatedAt, value?.source?.updatedAt,
    ...(entry.toolName === "composition_tactical_details" ? [value?.formation?.source?.updatedAt] : [])]
    .filter((date) => date !== undefined && date !== null);
  if (!timestamps.length) return "freshness_unknown";
  if (timestamps.some((date) => !Number.isFinite(timestampMs(date)))) return "freshness_unknown";
  if (timestamps.some((date) => now - timestampMs(date) > maxAgeMs || timestampMs(date) > now)) return "stale_evidence";
  const expiresAt = value?.cache?.expiresAt ?? metadata?.cache?.expiresAt;
  if (expiresAt && (!Number.isFinite(timestampMs(expiresAt)) || timestampMs(expiresAt) <= now)) return "stale_evidence";
  return null;
}

function scopeFailure(entry, scope) {
  const value = entry.value;
  const seasons = [value?.seasonContextId, value?.query?.seasonContextId, value?.scope?.seasonContextId].filter(Boolean);
  if (!seasons.length) return "season_scope_missing";
  if (seasons.some((id) => id !== scope.seasonContextId)) return "season_scope_mismatch";
  // Tactical guides are current-pointer observations, never historical-patch
  // facts. Their separate composition/cluster linkage is verified below.
  if (entry.toolName === "composition_tactical_details") return null;
  const patches = [value?.query?.patch, value?.scope?.patch, value?.patch, entry.metadata?.patch].filter(Boolean);
  if (!patches.length) return "patch_scope_missing";
  if (patches.some((patch) => patch !== "current" && patch !== scope.patch)) return "patch_scope_mismatch";
  return null;
}

function compositionFacts(entry, scope) {
  const value = entry.value;
  if (value.schemaVersion !== "composition-resolution.v1" || value.type !== "composition_rankings") return [];
  if (!["resolved", "unfiltered"].includes(value.resolution?.status)) return [];
  const facts = [];
  for (const [index, row] of list(value.results).slice(0, 20).entries()) {
    const members = list(row.members).slice(0, 12);
    const unit = members.find((member) => member.apiName === scope.unitId);
    const others = members.filter((member) => member.apiName !== scope.unitId && text(member.name));
    if (!unit || !list(unit.relations).includes("member_of_comp") || unit.roleEvidence?.memberOfComp !== "supported"
      || !text(unit.name) || !text(row.compositionRef?.name) || !others.length) continue;
    const compName = row.compositionRef.name;
    facts.push({ facetId: "composition_context", evidenceId: entry.evidenceId,
      path: `results[${index}].members`, kind: "composition_membership", tier: "A", claimKind: "current_fact",
      sentences: [
        `来源阵容“${compName}”包含${unit.name}和${others.map((member) => member.name).join("、")}。`,
        `The source composition "${compName}" includes ${unit.name} and ${others.map((member) => member.name).join(", ")}.`
      ] });
  }
  return facts;
}

function tacticalFacts(entry, scope, compositionEntries) {
  const value = entry.value;
  if (value.type !== "composition_tactical_details" || value.formation?.status !== "available") return [];
  const units = list(value.formation.units);
  if (!units.length || units.length > 12 || new Set(units.map((unit) => unit.apiName)).size !== units.length
    || value.formation.source?.endpoint !== "/tft-comps-api/comp_details") return [];
  const unit = units.find((row) => row.apiName === scope.unitId);
  const position = unit?.boardPosition;
  if (!unit || !text(unit.name) || !Number.isInteger(position?.rowFromFront) || position.rowFromFront < 1 || position.rowFromFront > 4
    || !Number.isInteger(position?.columnFromLeft) || position.columnFromLeft < 1 || position.columnFromLeft > 7) return [];
  if (!Number.isInteger(unit.cell) || unit.cell < 1 || unit.cell > 28
    || position.rowFromFront !== 4 - Math.floor((unit.cell - 1) / 7)
    || position.columnFromLeft !== ((unit.cell - 1) % 7) + 1) return [];
  // Match the exact server-authored query plan, including cluster and roster;
  // membership in another composition or merely matching a champion is not enough.
  const matched = compositionEntries.some((comp) => list(comp.value.results).some((row) => {
    const plan = row.tacticalDetailQueryPlan;
    return plan?.schemaVersion === "composition-tactical-detail-query.v1" && plan.status === "ready"
      && plan.seasonContextId === scope.seasonContextId
      && plan.compositionId === value.compId && plan.clusterId === value.clusterId
      && value.compositionRef?.compId === plan.compositionId && value.compositionRef?.clusterId === plan.clusterId
      && plan.compositionId === value.formation.source?.compId && plan.clusterId === value.formation.source?.clusterId
      && list(row.members).some((member) => member.apiName === scope.unitId)
      && sameSet(list(plan.units), units.map((member) => member.apiName));
  }));
  if (!matched) return [];
  return [{ facetId: "positioning", evidenceId: entry.evidenceId,
    path: `formation.units[${units.indexOf(unit)}].boardPosition`, kind: "source_positioning", tier: "B", claimKind: "source_recommendation",
    sentences: [
      `来源站位中，${unit.name}位于从前往后第${position.rowFromFront}排、从左往右第${position.columnFromLeft}列。`,
      `In the source positioning, ${unit.name} is in row ${position.rowFromFront} from the front, column ${position.columnFromLeft} from the left.`
    ] }];
}

function buildRows(value, unitId) {
  if (value?.unit?.apiName !== unitId || value?.query?.unit !== unitId) return [];
  return list(value.cards).slice(0, 20).filter((card) => list(card.items).length > 0
    && card.items.every((item) => text(item.apiName)) && typeof card.stats?.games === "number" && card.stats.games > 0);
}

function officialUnitRoleFacts(entry, scope) {
  const value = entry.value;
  if (value?.schemaVersion !== "official-entity-detail.v1" || value.type !== "unit_details"
    || value.entityType !== "unit" || !["found", "partial"].includes(value.status)
    || value.apiName !== scope.unitId || value.entityRef?.apiName !== scope.unitId
    || !text(value.displayName) || !text(value.facts?.role)) return [];
  return [{ facetId: "unit_role", evidenceId: entry.evidenceId, path: "facts.role",
    kind: "official_unit_role", tier: "A", claimKind: "current_fact",
    sentences: [`官方资料中，${value.displayName}的定位分类为“${value.facts.role}”。`,
      `The official role classification for ${value.displayName} is "${value.facts.role}".`] }];
}

function exactSentences(answer, facts, citedIds) {
  // Conservative lower bound only: full independent lines/sentences, not keyword
  // detection, entity-name co-occurrence or model-provided facet labels. General
  // paraphrases and qualification semantics remain unassessed in this version.
  const sentences = String(answer ?? "").slice(0, 16000).split(/(?<=[。.!?！？])(?:\s+|\n)|\n|(?<=。)/u)
    .map((line) => line.trim()).filter(Boolean);
  return facts.filter((fact) => citedIds.has(fact.evidenceId)
    && fact.sentences.some((sentence) => sentences.includes(sentence)));
}

// Pure read-only projection over a finished ReAct result. It neither retrieves
// data nor changes authorization. Only the application calls it, after the run.
export function analyzeUnitPlaySkillEvidence({ skill, selection, taskFrame, runtimeAvailableTools, toolRegistry, result, scope,
  now = Date.now(), maxAgeMs = 30 * 60 * 1000, tacticalMaxAgeMs = 5 * 60 * 1000 }) {
  // 1.2/1.3 change method instructions only; facet/data contracts stay at 1.1.
  // Opt-in 1.4 additionally recognizes the existing official role detail field.
  if (skill.id !== "unit_play_guidance" || !["1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.5.2", "1.5.3", "1.5.4", "1.5.5", "1.5.6", "1.5.7"].includes(skill.version)) throw new TypeError("Unsupported unit-play Skill adapter version");
  const supportsItemMechanisms = ["1.5.0", "1.5.1", "1.5.2", "1.5.3", "1.5.4", "1.5.5", "1.5.6", "1.5.7"].includes(skill.version);
  if (!text(scope?.unitId) || !text(scope?.seasonContextId) || !text(scope?.patch)
    || !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(tacticalMaxAgeMs) || tacticalMaxAgeMs <= 0) throw new TypeError("Unit-play evidence scope/freshness policy is required");
  const observations = list(result?.observations).slice(0, MAX_OBSERVATIONS);
  const entries = list(result?.evidence).slice(0, MAX_ENTRIES);
  const diagnostics = new Map();
  const note = (code) => diagnostics.set(code, (diagnostics.get(code) ?? 0) + 1);
  const allowed = new Set(skill.allowedTools.filter((tool) => runtimeAvailableTools.includes(tool)));
  const acceptedEntries = [];
  const staleTools = new Set();
  const seenIds = new Set();
  for (const entry of entries) {
    if (!allowed.has(entry?.toolName)) { note("tool_not_allowed"); continue; }
    const definition = toolRegistry.get(entry.toolName);
    const observation = observations.find((item) => item.type === "tool_result" && item.evidenceStatus === "valid"
      && item.status === "completed" && item.evidenceId === entry.evidenceId
      && item.toolCallId === entry.toolCallId && item.tool === entry.toolName);
    if (!definition || !text(entry.evidenceId) || seenIds.has(entry.evidenceId) || !entry.validatedAt || !observation) {
      note("unverified_ledger_entry"); continue;
    }
    seenIds.add(entry.evidenceId);
    if (Buffer.byteLength(JSON.stringify(entry), "utf8") > MAX_ENTRY_BYTES) { note("evidence_size_limit"); continue; }
    const validation = validateToolEvidence({ definition, evidenceContract: {
      source: definition.source, type: definition.evidenceType, requiredFields: ["source", "updatedAt"], allowModelGeneratedStatistics: false
    }, toolResult: { status: "completed", toolName: entry.toolName, metadata: entry.metadata, value: entry.value } });
    if (!validation.valid || entry.type !== definition.evidenceType || entry.source !== definition.source) { note("invalid_evidence_contract"); continue; }
    const temporal = supportsItemMechanisms && entry.toolName === "item_details"
      ? officialItemEvidenceFailure(entry, { now, maxAgeMs, seasonContextId: scope.seasonContextId })
      : supportsItemMechanisms && entry.toolName === "item_details_batch"
        ? officialItemBatchEvidenceFailure(entry, { now, maxAgeMs, seasonContextId: scope.seasonContextId })
        : temporalFailure(entry, now, entry.toolName === "composition_tactical_details" ? tacticalMaxAgeMs : maxAgeMs);
    if (temporal) {
      note(temporal);
      if (temporal === "stale_evidence") staleTools.add(entry.toolName);
      continue;
    }
    const invalidScope = scopeFailure(entry, scope);
    if (invalidScope) { note(invalidScope); continue; }
    acceptedEntries.push(entry);
  }
  const compositionEntries = acceptedEntries.filter((entry) => entry.toolName === "comps_rankings"
    && compositionFacts(entry, scope).length > 0);
  const facts = [];
  const evidenceByTool = new Map();
  let equipmentStatisticsObserved = false;
  for (const entry of acceptedEntries) {
    const value = entry.value;
    let available = false;
    if (entry.toolName === "unit_details" && (skill.version === "1.4.0" || supportsItemMechanisms)) {
      const mapped = officialUnitRoleFacts(entry, scope);
      facts.push(...mapped);
      available = mapped.length > 0;
      if (!available) note("official_role_missing_or_unrelated");
    } else if (entry.toolName === "comps_rankings") {
      const mapped = compositionFacts(entry, scope);
      facts.push(...mapped);
      available = mapped.length > 0;
      if (!available) note("composition_unresolved_or_unrelated");
    } else if (entry.toolName === "composition_tactical_details") {
      const mapped = tacticalFacts(entry, scope, compositionEntries);
      facts.push(...mapped);
      available = mapped.length > 0;
      if (!available) note("positioning_unverified");
    } else if (entry.toolName === "unit_builds") {
      available = buildRows(value, scope.unitId).length > 0;
      equipmentStatisticsObserved ||= available;
      if (available) note("equipment_statistics_not_mechanism");
      else note("equipment_missing_or_unrelated");
    } else if (entry.toolName === "semantic_search") {
      // Current semantic hits have unstructured claim text, without authoritative
      // per-claim champion/facet bindings. Do not infer role or timing by regex.
      note("semantic_facet_binding_unavailable");
    }
    if (available) evidenceByTool.set(entry.toolName, "available");
  }
  if (supportsItemMechanisms) {
    // Require all items of one actual leading recommendation. Do not infer a
    // mechanism from popularity or combine unrelated item effects into coverage.
    const builds = acceptedEntries.filter(entry => entry.toolName === "unit_builds")
      .map(entry => ({ entry, card: buildRows(entry.value, scope.unitId)[0] })).filter(row => row.card);
    const itemEntries = acceptedEntries.flatMap(entry => entry.toolName === "item_details"
      ? [{ evidenceId: entry.evidenceId, toolName: entry.toolName, value: entry.value, path: "facts.effect" }]
      : entry.toolName === "item_details_batch"
        ? list(entry.value?.items).map((item, index) => ({ evidenceId: entry.evidenceId, toolName: entry.toolName, value: item,
          path: `items[${index}].facts.effect` }))
        : []).filter(entry => entry.value.status === "found" && entry.value.facts?.numericFormulaComplete === true
          && list(entry.value.facts?.unresolvedTokens).length === 0
          && typeof entry.value.facts?.effect === "string" && entry.value.facts.effect.trim()
          && entry.value.facts.effect.length <= 4000);
    for (const { entry: build, card } of builds) {
      const items = card.items.map(item => itemEntries.find(entry => entry.value.apiName === item.apiName));
      if (items.some(item => !item)) { note("recommended_item_mechanism_incomplete"); continue; }
      for (const entry of items) facts.push({ facetId: "equipment_logic", evidenceId: entry.evidenceId,
        path: entry.path, kind: "official_recommended_item_effect", tier: "A", claimKind: "mechanism",
        sentences: [`官方资料中，${entry.value.displayName}的效果是：${entry.value.facts.effect}。`] });
      evidenceByTool.set(items[0].toolName, "available");
      // Statistics remain separate provenance and do not themselves cover logic.
      note("recommended_item_mechanism_bound");
      break;
    }
  }
  const dataAvailability = skill.dataDependencies.flatMap(({ id }) => {
    const tool = SKILL_DEPENDENCY_TOOLS[id];
    if (!allowed.has(tool)) return [];
    let status = "unknown";
    let reasonCode = "not_probed";
    if (evidenceByTool.has(tool)) { status = "available"; reasonCode = "observed_data"; }
    else if (staleTools.has(tool)) { status = "stale"; reasonCode = "freshness_failed"; }
    else if (observations.some((entry) => entry.type === "tool_failed" && entry.tool === tool)) reasonCode = "source_failed";
    return [{ schemaVersion: "skill-data-availability.v1", dependencyId: id, status, reasonCode,
      observedAt: reasonCode === "not_probed" ? null : new Date(now).toISOString(), sourceIds: [tool] }];
  });
  const context = buildSkillContext({ skill, selection, taskFrame, runtimeAvailableTools, dataAvailability });
  const claimEvidenceUses = facts.map((fact, index) => ({ schemaVersion: "claim-evidence-use.v1", claimId: `unit-play-source-${index}`,
    evidenceId: fact.evidenceId, tier: fact.tier, claimKind: fact.claimKind, role: "supports", reasonCode: fact.kind,
    supportsFacets: [fact.facetId], freshnessStatus: "fresh", provenance: "tool" }));
  const byId = new Map(acceptedEntries.map((entry) => [entry.evidenceId, entry]));
  const evidenceLedger = { get: (id) => byId.get(id) ?? null };
  const assessEvidenceUse = ({ entry, use, facet }) => {
    const supported = claimEvidenceUses.some((candidate) => candidate.claimId === use.claimId && candidate.evidenceId === entry.evidenceId
      && candidate.supportsFacets.includes(facet.id));
    return { valid: supported, scopeValid: byId.has(entry.evidenceId), freshnessValid: byId.has(entry.evidenceId), supportValid: supported };
  };
  const { progress } = evaluateSkillProgress({ skill, context, evidenceLedger, claimEvidenceUses, assessEvidenceUse });
  const projection = projectSkillCompletion({ skill, progress });
  const citedIds = new Set(list(result?.evidenceIds));
  const answerFacts = exactSentences(result?.answer, facts, citedIds);
  const answerFacets = [...new Set(answerFacts.map(({ facetId }) => facetId))];
  return {
    schemaVersion: UNIT_PLAY_EVIDENCE_ADAPTER_VERSION,
    dataAvailability: Object.fromEntries(context.dataAvailability.map(({ dependencyId, status }) => [dependencyId, status])),
    availabilityReasons: Object.fromEntries(context.dataAvailability.map(({ dependencyId, reasonCode }) => [dependencyId, reasonCode])),
    requiredFacets: [...progress.requiredFacets], coveredFacets: progress.coveredFacets.map(({ facetId }) => facetId),
    missingFacets: [...progress.missingFacets], unsupportedFacets: progress.unsupportedFacets.map(({ facetId }) => facetId),
    completionProjectionStatus: projection.status,
    answerCoverage: { mode: "exact_source_statements_lower_bound", verifiedFacets: answerFacets,
      unassessedFacets: progress.requiredFacets.filter((id) => !answerFacets.includes(id)), completionEvaluated: false },
    equipmentStatisticsObserved, acceptedEvidenceCount: acceptedEntries.length,
    mappedFactCount: facts.length, diagnosticCounts: Object.fromEntries(diagnostics),
    truncated: list(result?.evidence).length > MAX_ENTRIES || list(result?.observations).length > MAX_OBSERVATIONS,
    // Exact sentences stay local to the adapter/test caller, never model guidance
    // or completion approval. The app emits only the bounded telemetry projection.
    sourceStatements: facts.map(({ facetId, evidenceId, path, sentences }) => ({ facetId, evidenceId, path, sentences }))
  };
}
