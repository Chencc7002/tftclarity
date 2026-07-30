import { sha256, stableStringify } from "./mechanic-atom-extractor.js";
import { FACTOR_SCHEMA_VERSION } from "./mechanism-discovery.js";

const OBSERVATION_LISTS = Object.freeze([
  ["unitObservations", "unit_factor"],
  ["itemObservations", "item_factor"],
  ["relationshipCandidates", "relationship"],
  ["statisticalObservations", "statistical_observation"],
  ["unknownFactors", "unknown"]
]);

function compactObservation(caseId, kind, entry, index) {
  const observationId = `observation:${sha256(stableStringify({
    caseId,
    kind,
    index,
    label: entry.label,
    sourceRefs: entry.sourceRefs
  })).slice(0, 24)}`;
  return {
    observationId,
    caseId,
    kind,
    label: entry.label,
    description: entry.description,
    sourceRefs: entry.sourceRefs,
    claimType: entry.claimType,
    confidence: entry.confidence,
    itemApiName: entry.itemApiName ?? null,
    relationType: entry.relationType ?? null,
    conditions: entry.conditions ?? [],
    failureConditions: entry.failureConditions ?? [],
    formulaStatus: entry.formulaStatus ?? null,
    causal: entry.causal ?? null
  };
}

export function collectFactorObservations(candidates) {
  const observations = [];
  for (const candidate of candidates ?? []) {
    for (const [field, kind] of OBSERVATION_LISTS) {
      (candidate?.[field] ?? []).forEach((entry, index) => {
        observations.push(compactObservation(candidate.caseId, kind, entry, index));
      });
    }
  }
  return observations;
}

function containsEntityName(text, entityNames) {
  const normalized = String(text ?? "");
  return entityNames.some((name) => {
    if (name.length > 1) return normalized.includes(name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(
      `(?:^|[，。；：、\\s（(]|英雄|棋子|单位)${escaped}(?:$|[，。；：、\\s）)]|的技能|必须|携带)`,
      "u"
    ).test(normalized);
  });
}

function validateIdList(errors, value, path, knownIds, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path}:must_be_array`);
    return;
  }
  if (options.required && value.length === 0) errors.push(`${path}:required`);
  for (const id of value) {
    if (!knownIds.has(id)) errors.push(`${path}:unknown:${id}`);
  }
}

export function validateNormalizedFactorSchema(schema, observations, options = {}) {
  const errors = [];
  const knownIds = new Set(observations.map((entry) => entry.observationId));
  const entityNames = [...new Set(options.entityNames ?? [])].filter(Boolean);
  if (schema?.schemaVersion !== FACTOR_SCHEMA_VERSION) errors.push("schemaVersion:invalid");
  if (!Array.isArray(schema?.factors)) {
    errors.push("factors:must_be_array");
  } else {
    const factorIds = new Set();
    schema.factors.forEach((factor, index) => {
      const path = `factors[${index}]`;
      if (!/^factor:[a-z0-9][a-z0-9:_-]*$/u.test(String(factor?.factorId ?? ""))) {
        errors.push(`${path}.factorId:invalid`);
      } else if (factorIds.has(factor.factorId)) {
        errors.push(`${path}.factorId:duplicate`);
      } else {
        factorIds.add(factor.factorId);
      }
      if (!String(factor?.name ?? "").trim()) errors.push(`${path}.name:required`);
      if (!String(factor?.definition ?? "").trim()) errors.push(`${path}.definition:required`);
      validateIdList(errors, factor?.positiveObservationIds, `${path}.positiveObservationIds`, knownIds, { required: true });
      validateIdList(
        errors,
        factor?.negativeObservationIds,
        `${path}.negativeObservationIds`,
        knownIds,
        { required: options.requireNegativeExamples !== false }
      );
      const overlap = (factor?.positiveObservationIds ?? [])
        .filter((id) => (factor?.negativeObservationIds ?? []).includes(id));
      if (overlap.length) errors.push(`${path}:positive_negative_overlap`);
      if (!Array.isArray(factor?.adjacentFactors)) errors.push(`${path}.adjacentFactors:must_be_array`);
      if (!Array.isArray(factor?.conditions)) errors.push(`${path}.conditions:must_be_array`);
      if (!["candidate", "needs_review", "unmapped"].includes(factor?.reviewStatus)) {
        errors.push(`${path}.reviewStatus:invalid`);
      }
      if (containsEntityName(`${factor?.name ?? ""} ${factor?.definition ?? ""}`, entityNames)) {
        errors.push(`${path}:contains_entity_name`);
      }
    });
  }

  if (!Array.isArray(schema?.theoryCandidates)) {
    errors.push("theoryCandidates:must_be_array");
  } else {
    const theoryIds = new Set();
    schema.theoryCandidates.forEach((theory, index) => {
      const path = `theoryCandidates[${index}]`;
      if (!/^theory:[a-z0-9][a-z0-9:_-]*$/u.test(String(theory?.theoryId ?? ""))) {
        errors.push(`${path}.theoryId:invalid`);
      } else if (theoryIds.has(theory.theoryId)) {
        errors.push(`${path}.theoryId:duplicate`);
      } else {
        theoryIds.add(theory.theoryId);
      }
      if (!String(theory?.statement ?? "").trim()) errors.push(`${path}.statement:required`);
      validateIdList(errors, theory?.supportingObservationIds, `${path}.supportingObservationIds`, knownIds, { required: true });
      validateIdList(
        errors,
        theory?.counterObservationIds,
        `${path}.counterObservationIds`,
        knownIds,
        { required: options.requireNegativeExamples !== false }
      );
      if (!Array.isArray(theory?.conditions)) errors.push(`${path}.conditions:must_be_array`);
      if (!Array.isArray(theory?.failureConditions)) errors.push(`${path}.failureConditions:must_be_array`);
      if (!["not_applicable", "qualitative_only", "hypothesis"].includes(theory?.formulaStatus)) {
        errors.push(`${path}.formulaStatus:invalid`);
      }
      if (theory?.causal !== false) errors.push(`${path}.causal:must_be_false`);
      if (containsEntityName(theory?.statement, entityNames)) errors.push(`${path}:contains_entity_name`);
    });
  }

  if (!Array.isArray(schema?.unmappedFactors)) {
    errors.push("unmappedFactors:must_be_array");
  } else {
    schema.unmappedFactors.forEach((unmapped, index) => {
      const path = `unmappedFactors[${index}]`;
      if (!/^unmapped:[a-z0-9][a-z0-9:_-]*$/u.test(String(unmapped?.unmappedId ?? ""))) {
        errors.push(`${path}.unmappedId:invalid`);
      }
      if (!String(unmapped?.label ?? "").trim()) errors.push(`${path}.label:required`);
      if (!String(unmapped?.reason ?? "").trim()) errors.push(`${path}.reason:required`);
      validateIdList(errors, unmapped?.observationIds, `${path}.observationIds`, knownIds, { required: true });
      if (unmapped?.reviewStatus !== "unmapped") errors.push(`${path}.reviewStatus:invalid`);
      if (containsEntityName(`${unmapped?.label ?? ""} ${unmapped?.reason ?? ""}`, entityNames)) {
        errors.push(`${path}:contains_entity_name`);
      }
    });
  }
  if (/(?:必须|必出|必备|只能出|一定要).{0,12}(?:装备|件|装)/u.test(JSON.stringify(schema))) {
    errors.push("contains_fixed_build_answer");
  }
  return errors;
}

export function buildFactorSchemaEnvelope(normalized, observations, metadata = {}) {
  return {
    ...normalized,
    schemaVersion: FACTOR_SCHEMA_VERSION,
    season: metadata.season ?? "S17",
    patch: metadata.patch ?? null,
    sourceSnapshotId: metadata.sourceSnapshotId ?? null,
    discoverySplitHash: metadata.discoverySplitHash ?? null,
    sampleHash: metadata.sampleHash ?? null,
    model: metadata.model ?? null,
    promptVersion: metadata.promptVersion ?? null,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    observationCount: observations.length,
    evidenceIndex: Object.fromEntries(observations.map((entry) => [
      entry.observationId,
      {
        caseId: entry.caseId,
        kind: entry.kind,
        sourceRefs: entry.sourceRefs,
        claimType: entry.claimType
      }
    ]))
  };
}
