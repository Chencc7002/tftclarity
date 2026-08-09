import { normalizeAlias } from "../../core/normalizer.js";

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unitRecord(apiName, details, catalog) {
  return details?.units?.get?.(apiName)
    ?? catalog?.unitByApiName?.get?.(apiName)
    ?? null;
}

function unitTraits(record = {}) {
  const source = record ?? {};
  return [...new Set((source.traitNames ?? source.traits ?? [])
    .map((trait) => typeof trait === "string" ? trait : trait?.name ?? trait?.displayName)
    .map((trait) => String(trait ?? "").trim())
    .filter(Boolean))];
}

function traitRecords(details, catalog) {
  const records = new Map();
  const add = (record, fallbackApiName = null) => {
    if (!record) return;
    const apiName = String(record.apiName ?? fallbackApiName ?? "");
    const names = [
      apiName,
      record.name,
      record.zhName,
      record.displayName,
      ...(record.aliases ?? [])
    ].map(normalizeAlias).filter(Boolean);
    for (const name of names) {
      const existing = records.get(name) ?? null;
      records.set(name, {
        ...(existing ?? {}),
        ...record,
        apiName,
        levels: record.levels ?? existing?.levels,
        effects: record.effects ?? existing?.effects,
        tierCounts: record.tierCounts ?? existing?.tierCounts,
        conditionalTraitSets: record.conditionalTraitSets ?? existing?.conditionalTraitSets
      });
    }
  };
  for (const [apiName, record] of details?.traits ?? []) add(record, apiName);
  for (const [apiName, record] of catalog?.traitByApiName ?? []) add(record, apiName);
  return records;
}

function traitThresholds(record = {}) {
  const rows = [
    ...(record.levels ?? []),
    ...(record.effects ?? []),
    ...(record.tierCounts ?? []).map((units) => ({ units })),
    ...(record.conditionalTraitSets ?? record.conditional_trait_sets ?? [])
  ];
  return [...new Set(rows
    .map((level) => Number(level?.units ?? level?.minUnits ?? level?.min_units))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function breakpointFor(count, thresholds) {
  let tierIndex = -1;
  for (let index = 0; index < thresholds.length; index += 1) {
    if (count >= thresholds[index]) tierIndex = index;
  }
  return {
    active: tierIndex >= 0,
    tierIndex: tierIndex >= 0 ? tierIndex + 1 : 0,
    threshold: tierIndex >= 0 ? thresholds[tierIndex] : null,
    nextThreshold: thresholds.find((threshold) => threshold > count) ?? null
  };
}

function breakpointChange(before, after, countDelta) {
  if (after.tierIndex > before.tierIndex) return before.tierIndex === 0 ? "activated" : "advanced";
  if (after.tierIndex < before.tierIndex) return after.tierIndex === 0 ? "deactivated" : "regressed";
  if (countDelta > 0) return "count_increased";
  if (countDelta < 0) return "count_decreased";
  return "unchanged";
}

function countTraits(memberApiNames, details, catalog) {
  const counts = new Map();
  const displayNames = new Map();
  for (const apiName of memberApiNames) {
    for (const trait of unitTraits(unitRecord(apiName, details, catalog))) {
      const key = normalizeAlias(trait);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      displayNames.set(key, trait);
    }
  }
  return { counts, displayNames };
}

function memberSummary(apiName, record) {
  return {
    apiName,
    name: record?.name ?? record?.zhName ?? record?.displayName ?? apiName,
    cost: record?.cost ?? null,
    officialRole: record?.role ?? null,
    traits: unitTraits(record)
  };
}

const COMPOSITION_CHANGE_OPERATIONS = Object.freeze(["add", "remove", "replace"]);

function normalizeCompositionChangeOperation(value) {
  const operation = String(value ?? "").trim().toLowerCase();
  return COMPOSITION_CHANGE_OPERATIONS.includes(operation) ? operation : null;
}

function mapCompositionChangeFailure(operation, failureReason) {
  if (failureReason === "composition_not_resolved") return "invalid_composition";
  if (
    failureReason === "target_not_member_of_composition"
    || failureReason === "target_api_name_required"
    || failureReason === "official_target_unit_details_missing"
  ) return "invalid_target";
  if (
    failureReason === "incoming_api_name_required"
    || failureReason === "official_incoming_unit_details_missing"
    || failureReason === "incoming_already_in_composition"
    || failureReason === "incoming_matches_target"
  ) return "invalid_incoming";
  return operation ? "invalid_change" : "invalid_operation";
}

export function evaluateCompositionChange(input = {}) {
  const composition = input.composition ?? null;
  const operation = normalizeCompositionChangeOperation(input.operation);
  const targetApiName = String(input.targetApiName ?? "");
  const incomingApiName = String(input.incomingApiName ?? input.replacementApiName ?? "");
  const members = (composition?.members ?? []).map((member) => member.apiName).filter(Boolean);
  const targetRecord = unitRecord(targetApiName, input.details, input.catalog);
  const incomingRecord = unitRecord(incomingApiName, input.details, input.catalog);
  const targetRequired = operation === "remove" || operation === "replace";
  const incomingRequired = operation === "add" || operation === "replace";
  const targetIsMember = members.includes(targetApiName);
  const incomingExists = Boolean(incomingRecord);
  const incomingAlreadyMember = members.includes(incomingApiName) && incomingApiName !== targetApiName;
  let status = "evaluated";
  let failureReason = null;
  if (!operation) failureReason = "unsupported_change_operation";
  else if (!composition?.compositionRef?.compId) failureReason = "composition_not_resolved";
  else if (targetRequired && !targetApiName) failureReason = "target_api_name_required";
  else if (targetRequired && !targetIsMember) failureReason = "target_not_member_of_composition";
  else if (targetRequired && !targetRecord) failureReason = "official_target_unit_details_missing";
  else if (incomingRequired && !incomingApiName) failureReason = "incoming_api_name_required";
  else if (incomingRequired && !incomingExists) failureReason = "official_incoming_unit_details_missing";
  else if (operation === "replace" && targetApiName === incomingApiName) {
    failureReason = "incoming_matches_target";
  } else if (incomingRequired && incomingAlreadyMember) {
    failureReason = "incoming_already_in_composition";
  }
  if (failureReason) status = mapCompositionChangeFailure(operation, failureReason);

  const updatedAt = [
    composition?.source?.updatedAt,
    input.details?.meta?.updatedAt,
    input.details?.meta?.generatedAt,
    new Date().toISOString()
  ].map(isoTimestamp).filter(Boolean).sort().at(-1);
  if (status !== "evaluated") {
    return {
      schemaVersion: "composition-change-evaluation.v1",
      type: "composition_change_evaluation",
      operation,
      status,
      failureReason,
      compositionRef: structuredClone(composition?.compositionRef ?? null),
      target: targetRequired ? memberSummary(targetApiName, targetRecord) : null,
      incoming: incomingRequired ? memberSummary(incomingApiName, incomingRecord) : null,
      membershipValidation: {
        targetRequired,
        incomingRequired,
        targetIsMember,
        targetExists: Boolean(targetRecord),
        incomingExists,
        incomingAlreadyMember
      },
      traitDeltas: [],
      summary: null,
      strengthConclusion: "not_evaluated",
      updatedAt,
      warnings: [failureReason]
    };
  }

  const afterMembers = operation === "add"
    ? [...members, incomingApiName]
    : operation === "remove"
      ? members.filter((apiName) => apiName !== targetApiName)
      : members.map((apiName) => apiName === targetApiName ? incomingApiName : apiName);
  const before = countTraits(members, input.details, input.catalog);
  const after = countTraits(afterMembers, input.details, input.catalog);
  const affectedKeys = [...new Set([
    ...(targetRequired ? unitTraits(targetRecord).map(normalizeAlias) : []),
    ...(incomingRequired ? unitTraits(incomingRecord).map(normalizeAlias) : [])
  ])].filter(Boolean);
  const records = traitRecords(input.details, input.catalog);
  const traitDeltas = affectedKeys.map((key) => {
    const record = records.get(key) ?? null;
    const thresholds = traitThresholds(record);
    const beforeCount = before.counts.get(key) ?? 0;
    const afterCount = after.counts.get(key) ?? 0;
    const beforeBreakpoint = breakpointFor(beforeCount, thresholds);
    const afterBreakpoint = breakpointFor(afterCount, thresholds);
    return {
      traitRef: {
        apiName: record?.apiName ?? null,
        name: record?.name
          ?? record?.zhName
          ?? record?.displayName
          ?? before.displayNames.get(key)
          ?? after.displayNames.get(key)
          ?? key
      },
      beforeCount,
      afterCount,
      countDelta: afterCount - beforeCount,
      thresholds,
      beforeBreakpoint,
      afterBreakpoint,
      breakpointChange: breakpointChange(
        beforeBreakpoint,
        afterBreakpoint,
        afterCount - beforeCount
      )
    };
  }).filter((delta) => delta.countDelta !== 0);
  const summary = {
    activated: traitDeltas.filter((delta) => delta.breakpointChange === "activated").length,
    deactivated: traitDeltas.filter((delta) => delta.breakpointChange === "deactivated").length,
    advanced: traitDeltas.filter((delta) => delta.breakpointChange === "advanced").length,
    regressed: traitDeltas.filter((delta) => delta.breakpointChange === "regressed").length,
    countIncreased: traitDeltas.filter((delta) => delta.countDelta > 0).length,
    countDecreased: traitDeltas.filter((delta) => delta.countDelta < 0).length
  };
  return {
    schemaVersion: "composition-change-evaluation.v1",
    type: "composition_change_evaluation",
    operation,
    status,
    failureReason,
    compositionRef: structuredClone(composition.compositionRef),
    target: targetRequired ? memberSummary(targetApiName, targetRecord) : null,
    incoming: incomingRequired ? memberSummary(incomingApiName, incomingRecord) : null,
    membershipValidation: {
      targetRequired,
      incomingRequired,
      targetIsMember,
      targetExists: Boolean(targetRecord),
      incomingExists,
      incomingAlreadyMember
    },
    memberChange: {
      before: members,
      after: afterMembers
    },
    traitDeltas,
    summary,
    strengthConclusion: "not_evaluated",
    source: {
      composition: structuredClone(composition.source ?? null),
      unitDetails: structuredClone(input.details?.meta ?? null)
    },
    updatedAt,
    warnings: ["composition_change_strength_not_evaluated"]
  };
}

export function evaluateCompositionReplacement(input = {}) {
  const result = evaluateCompositionChange({
    ...input,
    operation: "replace",
    incomingApiName: input.replacementApiName
  });
  const failureReason = result.failureReason === "incoming_already_in_composition"
    ? "replacement_already_in_composition"
    : result.failureReason === "incoming_matches_target"
      ? "replacement_matches_target"
      : ["official_target_unit_details_missing", "official_incoming_unit_details_missing"].includes(
        result.failureReason
      )
        ? "official_unit_details_missing"
        : result.failureReason;
  const status = ["invalid_incoming", "invalid_change"].includes(result.status)
    ? "invalid_replacement"
    : result.status;
  return {
    ...result,
    schemaVersion: "composition-replacement-evaluation.v1",
    type: "composition_replacement_evaluation",
    status,
    failureReason,
    replacement: result.incoming,
    membershipValidation: {
      targetIsMember: result.membershipValidation.targetIsMember,
      replacementExists: result.membershipValidation.incomingExists,
      replacementAlreadyMember: result.membershipValidation.incomingAlreadyMember
    },
    warnings: status === "evaluated" ? ["replacement_strength_not_evaluated"] : [failureReason]
  };
}
