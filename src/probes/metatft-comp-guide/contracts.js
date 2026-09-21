import { createHash } from "node:crypto";

export const RAW_SCHEMA_VERSION = "metatft-comp-guide-probe-raw.v1";
export const NORMALIZED_SCHEMA_VERSION = "comp-guide-snapshot.v1";
export const STABLE_COMP_ID_VERSION = "metatft-lineup-signature-v1";
export const NORMALIZED_COMP_IDENTITY_VERSION = "metatft-comp-signature.v1";
export const IDENTITY_NORMALIZATION_RULE = "sort_unique_exact_api_names_utf8_json_v1";
export const NORMALIZER_VERSION = "metatft-comp-guide-normalizer.v2";

export const PATCH_ROLES = Object.freeze(["current", "previous"]);
export const FACET_NAMES = Object.freeze([
  "earlyBoards",
  "leveling",
  "reroll",
  "firstCarouselComponents",
  "recommendedAugments",
  "positioning"
]);
export const FACET_STATUSES = Object.freeze([
  "observed",
  "not_available",
  "not_applicable",
  "parse_failed",
  "mapping_failed"
]);
export const ENTITY_MAPPING_STATUSES = Object.freeze(["resolved", "explicitly_unmapped"]);
export const GUIDE_BINDINGS = Object.freeze(["current_unversioned", "unavailable_for_requested_patch"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function canonicalResponseHash(response, volatileKeys = ["updated"]) {
  if (!isObject(response)) return null;
  const copy = { ...response };
  for (const key of volatileKeys) delete copy[key];
  return sha256(copy);
}

export function responseDocument(url, response, options = {}) {
  return {
    url: String(url),
    status: Number(options.status ?? 200),
    contentType: String(options.contentType ?? "application/json"),
    responseSha256: sha256(response),
    canonicalResponseSha256: canonicalResponseHash(response),
    response
  };
}

export function splitApiNames(value, separator = /\s*,\s*/u) {
  return [...new Set(String(value ?? "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

export function lineupSignature(definition) {
  const units = splitApiNames(definition?.units_string).sort();
  const traits = splitApiNames(definition?.traits_string).sort();
  const signature = {
    version: STABLE_COMP_ID_VERSION,
    units,
    traits
  };
  return {
    ...signature,
    stableCompId: `metatft:${sha256(signature)}`
  };
}

export function normalizedCompIdentity({
  tftSet,
  queue,
  sourceCompId,
  sourceClusterId,
  units,
  traits
}) {
  const canonicalUnits = [...new Set((units ?? []).map(String).filter(Boolean))].sort();
  const canonicalTraits = [...new Set((traits ?? []).map(String).filter(Boolean))].sort();
  const signature = {
    identityVersion: NORMALIZED_COMP_IDENTITY_VERSION,
    set: String(tftSet ?? ""),
    units: canonicalUnits,
    traits: canonicalTraits
  };
  return {
    compId: `metatft:${sha256(signature)}`,
    identityVersion: NORMALIZED_COMP_IDENTITY_VERSION,
    set: signature.set,
    queue: String(queue ?? ""),
    sourceAliases: {
      clusterId: String(sourceClusterId ?? ""),
      sourceCompId: String(sourceCompId ?? "")
    },
    signature: {
      normalizationRule: IDENTITY_NORMALIZATION_RULE,
      units: canonicalUnits,
      traits: canonicalTraits,
      hashInput: stableJson(signature)
    }
  };
}

function addError(errors, condition, path, message) {
  if (!condition) errors.push({ path, message });
}

function validateResponseDocument(document, path, errors, { nullable = false } = {}) {
  if (document === null && nullable) return;
  addError(errors, isObject(document), path, "must be an object");
  if (!isObject(document)) return;
  addError(errors, typeof document.url === "string" && document.url.startsWith("https://"), `${path}.url`, "must be an HTTPS URL");
  addError(errors, document.status === 200, `${path}.status`, "must be HTTP 200");
  addError(errors, typeof document.contentType === "string" && document.contentType.includes("application/json"), `${path}.contentType`, "must be JSON");
  addError(errors, /^[a-f0-9]{64}$/u.test(String(document.responseSha256 ?? "")), `${path}.responseSha256`, "must be a SHA-256 hex digest");
  addError(errors, isObject(document.response), `${path}.response`, "must be an object");
  if (isObject(document.response) && typeof document.responseSha256 === "string") {
    addError(errors, sha256(document.response) === document.responseSha256, `${path}.responseSha256`, "does not match response body");
  }
}

export function validateRawProbeFixture(raw) {
  const errors = [];
  addError(errors, isObject(raw), "$", "must be an object");
  if (!isObject(raw)) return { valid: false, errors };

  addError(errors, raw.schemaVersion === RAW_SCHEMA_VERSION, "$.schemaVersion", `must equal ${RAW_SCHEMA_VERSION}`);
  addError(errors, raw.parserVersion === "metatft-comp-guide-normalizer.v1", "$.parserVersion", "must bind the parser version");
  addError(errors, raw.payloadKind === "metatft_comp_guide_probe", "$.payloadKind", "must bind the payload kind");
  addError(errors, Number.isFinite(Date.parse(raw.capturedAt)), "$.capturedAt", "must be an ISO timestamp");
  addError(errors, isObject(raw.source), "$.source", "must be an object");
  addError(errors, raw.source?.provider === "MetaTFT", "$.source.provider", "must equal MetaTFT");
  addError(errors, raw.source?.pageUrl === "https://www.metatft.com/comps", "$.source.pageUrl", "must equal the audited page URL");
  addError(errors, String(raw.source?.queue) === "1100", "$.source.queue", "must equal 1100");
  addError(errors, /^TFTSet\d+$/u.test(String(raw.source?.tftSet ?? "")), "$.source.tftSet", "must be a TFT set id");

  addError(errors, isObject(raw.patch), "$.patch", "must be an object");
  addError(errors, PATCH_ROLES.includes(raw.patch?.role), "$.patch.role", `must be one of ${PATCH_ROLES.join(", ")}`);
  addError(errors, /^\d+\.\d+$/u.test(String(raw.patch?.label ?? "")), "$.patch.label", "must be a numeric patch");
  addError(errors, typeof raw.patch?.bPatch === "string", "$.patch.bPatch", "must be a string");

  addError(errors, isObject(raw.identity), "$.identity", "must be an object");
  addError(errors, /^\d+$/u.test(String(raw.identity?.sourceCompId ?? "")), "$.identity.sourceCompId", "must be a numeric source comp id");
  addError(errors, /^\d+$/u.test(String(raw.identity?.sourceClusterId ?? "")), "$.identity.sourceClusterId", "must be a numeric source cluster id");
  addError(errors, /^metatft:[a-f0-9]{64}$/u.test(String(raw.identity?.stableCompId ?? "")), "$.identity.stableCompId", "must be a stable lineup id");
  addError(errors, Array.isArray(raw.identity?.units) && raw.identity.units.length > 0, "$.identity.units", "must contain units");
  addError(errors, Array.isArray(raw.identity?.traits) && raw.identity.traits.length > 0, "$.identity.traits", "must contain traits");

  addError(errors, isObject(raw.endpoints), "$.endpoints", "must be an object");
  if (isObject(raw.endpoints)) {
    validateResponseDocument(raw.endpoints.patchDiscovery, "$.endpoints.patchDiscovery", errors);
    validateResponseDocument(raw.endpoints.compsData, "$.endpoints.compsData", errors);
    validateResponseDocument(raw.endpoints.compsStats, "$.endpoints.compsStats", errors);
    validateResponseDocument(raw.endpoints.compDetails, "$.endpoints.compDetails", errors, { nullable: raw.patch?.role === "previous" });
    validateResponseDocument(raw.endpoints.compAugmentTiers, "$.endpoints.compAugmentTiers", errors, { nullable: raw.patch?.role === "previous" });
  }

  addError(errors, isObject(raw.patchBinding), "$.patchBinding", "must be an object");
  if (raw.patch?.role === "current") {
    addError(errors, raw.patchBinding?.details === "current_pointer", "$.patchBinding.details", "current details must use current_pointer");
    addError(errors, raw.patchBinding?.augments === "current_pointer", "$.patchBinding.augments", "current augments must use current_pointer");
  } else if (raw.patch?.role === "previous") {
    addError(errors, raw.patchBinding?.details === "unbound", "$.patchBinding.details", "previous details must be unbound");
    addError(errors, raw.patchBinding?.augments === "unbound", "$.patchBinding.augments", "previous augments must be unbound");
    addError(errors, raw.endpoints?.compDetails === null, "$.endpoints.compDetails", "unbound details must not be active evidence");
    addError(errors, raw.endpoints?.compAugmentTiers === null, "$.endpoints.compAugmentTiers", "unbound augments must not be active evidence");
    addError(errors, isObject(raw.bindingProbes), "$.bindingProbes", "must retain patch-binding evidence");
    validateResponseDocument(raw.bindingProbes?.compDetails, "$.bindingProbes.compDetails", errors);
    validateResponseDocument(raw.bindingProbes?.compAugmentTiers, "$.bindingProbes.compAugmentTiers", errors);
  }

  return { valid: errors.length === 0, errors };
}

export function validateRawProbePair(rawFixtures) {
  const errors = [];
  addError(errors, Array.isArray(rawFixtures) && rawFixtures.length === 2, "$", "must contain exactly two fixtures");
  if (!Array.isArray(rawFixtures) || rawFixtures.length !== 2) return { valid: false, errors };
  rawFixtures.forEach((raw, index) => {
    const result = validateRawProbeFixture(raw);
    for (const error of result.errors) errors.push({ ...error, path: `$[${index}]${error.path.slice(1)}` });
  });
  if (errors.length > 0) return { valid: false, errors };

  const current = rawFixtures.find((raw) => raw.patch.role === "current");
  const previous = rawFixtures.find((raw) => raw.patch.role === "previous");
  addError(errors, Boolean(current), "$", "must contain a current fixture");
  addError(errors, Boolean(previous), "$", "must contain a previous fixture");
  if (!current || !previous) return { valid: false, errors };

  addError(errors, current.patch.label !== previous.patch.label, "$.patch", "patch labels must differ");
  addError(errors, current.identity.stableCompId === previous.identity.stableCompId, "$.identity.stableCompId", "fixtures must describe the same stable comp");
  addError(errors, current.identity.sourceCompId === previous.identity.sourceCompId, "$.identity.sourceCompId", "source comp ids must match");
  addError(errors, current.identity.sourceClusterId === previous.identity.sourceClusterId, "$.identity.sourceClusterId", "source cluster ids must match");
  addError(errors, current.endpoints.compsStats.responseSha256 !== previous.endpoints.compsStats.responseSha256, "$.endpoints.compsStats", "patch statistics must be distinct");
  addError(errors, previous.bindingProbes.compDetails.canonicalResponseSha256 === current.endpoints.compDetails.canonicalResponseSha256, "$.bindingProbes.compDetails", "details unbound verdict requires an identical canonical response");
  addError(errors, previous.bindingProbes.compAugmentTiers.canonicalResponseSha256 === current.endpoints.compAugmentTiers.canonicalResponseSha256, "$.bindingProbes.compAugmentTiers", "augment unbound verdict requires an identical canonical response");

  const previousStatsUrl = new URL(previous.endpoints.compsStats.url);
  addError(errors, previousStatsUrl.searchParams.get("patch") === previous.patch.label, "$.endpoints.compsStats.url", "previous stats request must bind the requested patch");
  addError(errors, previousStatsUrl.searchParams.has("b_patch"), "$.endpoints.compsStats.url", "previous stats request must include b_patch");
  return { valid: errors.length === 0, errors };
}

function entityReferences(normalized) {
  const refs = [];
  const add = (apiName, entityType) => {
    if (typeof apiName === "string" && apiName) refs.push(`${entityType}:${apiName}`);
  };
  const facets = normalized.guide?.facets;
  for (const board of facets?.earlyBoards?.data ?? []) {
    for (const apiName of board.units ?? []) add(apiName, "unit");
  }
  for (const entry of facets?.firstCarouselComponents?.data ?? []) add(entry.apiName, "item");
  for (const entry of facets?.recommendedAugments?.data ?? []) add(entry.apiName, "augment");
  for (const entry of facets?.positioning?.data ?? []) add(entry.apiName, "unit");
  return [...new Set(refs)].sort();
}

export function validateNormalizedProbe(normalized) {
  const errors = [];
  addError(errors, isObject(normalized), "$", "must be an object");
  if (!isObject(normalized)) return { valid: false, errors };
  addError(errors, normalized.schemaVersion === NORMALIZED_SCHEMA_VERSION, "$.schemaVersion", `must equal ${NORMALIZED_SCHEMA_VERSION}`);
  addError(errors, Number.isFinite(Date.parse(normalized.capturedAt)), "$.capturedAt", "must be an ISO timestamp");
  addError(errors, !("patch" in normalized), "$.patch", "top-level patch is forbidden because guide and statistics have different bindings");
  addError(errors, !("scope" in normalized), "$.scope", "legacy scope is forbidden because it implied one patch for the entire snapshot");

  addError(errors, isObject(normalized.identity), "$.identity", "must be an object");
  addError(errors, /^metatft:[a-f0-9]{64}$/u.test(String(normalized.identity?.compId ?? "")), "$.identity.compId", "must be a stable lineup id");
  addError(errors, normalized.identity?.identityVersion === NORMALIZED_COMP_IDENTITY_VERSION, "$.identity.identityVersion", `must equal ${NORMALIZED_COMP_IDENTITY_VERSION}`);
  addError(errors, /^TFTSet\d+$/u.test(String(normalized.identity?.set ?? "")), "$.identity.set", "must be a TFT set id");
  addError(errors, normalized.identity?.signature?.normalizationRule === IDENTITY_NORMALIZATION_RULE, "$.identity.signature.normalizationRule", "must bind the normalization rule");
  addError(errors, Array.isArray(normalized.identity?.signature?.units) && normalized.identity.signature.units.length > 0, "$.identity.signature.units", "must contain canonical units");
  addError(errors, Array.isArray(normalized.identity?.signature?.traits) && normalized.identity.signature.traits.length > 0, "$.identity.signature.traits", "must contain canonical traits");
  if (isObject(normalized.identity)) {
    const expectedIdentity = normalizedCompIdentity({
      tftSet: normalized.identity.set,
      queue: normalized.identity.queue,
      sourceCompId: normalized.identity.sourceAliases?.sourceCompId,
      sourceClusterId: normalized.identity.sourceAliases?.clusterId,
      units: normalized.identity.signature?.units,
      traits: normalized.identity.signature?.traits
    });
    addError(errors, normalized.identity.compId === expectedIdentity.compId, "$.identity.compId", "does not match the versioned Set-scoped signature");
    addError(errors, normalized.identity.signature?.hashInput === expectedIdentity.signature.hashInput, "$.identity.signature.hashInput", "does not match the canonical hash input");
  }

  addError(errors, isObject(normalized.statistics), "$.statistics", "must be an object");
  addError(errors, normalized.statistics?.binding === "patch", "$.statistics.binding", "must equal patch");
  addError(errors, normalized.statistics?.status === "observed", "$.statistics.status", "must equal observed");
  addError(errors, /^\d+\.\d+$/u.test(String(normalized.statistics?.patch ?? "")), "$.statistics.patch", "must be a numeric patch");
  addError(errors, PATCH_ROLES.includes(normalized.statistics?.patchRole), "$.statistics.patchRole", "must be current or previous");
  addError(errors, normalized.statistics?.verification?.status === "verified", "$.statistics.verification.status", "must be verified");

  addError(errors, isObject(normalized.guide), "$.guide", "must be an object");
  addError(errors, GUIDE_BINDINGS.includes(normalized.guide?.binding), "$.guide.binding", `must be one of ${GUIDE_BINDINGS.join(", ")}`);
  if (normalized.statistics?.patchRole === "current") {
    addError(errors, normalized.guide?.binding === "current_unversioned", "$.guide.binding", "current guide must be current_unversioned");
    addError(errors, normalized.guide?.observedDuringPatch === normalized.statistics?.patch, "$.guide.observedDuringPatch", "must record the runtime patch during observation");
  } else if (normalized.statistics?.patchRole === "previous") {
    addError(errors, normalized.guide?.binding === "unavailable_for_requested_patch", "$.guide.binding", "historical guide must fail closed");
    addError(errors, normalized.guide?.observedDuringPatch === null, "$.guide.observedDuringPatch", "must not imply a historical observation");
  }

  addError(errors, isObject(normalized.guide?.facets), "$.guide.facets", "must be an object");
  if (isObject(normalized.guide?.facets)) {
    const emittedFacetNames = Object.keys(normalized.guide.facets).sort();
    addError(errors, stableJson(emittedFacetNames) === stableJson([...FACET_NAMES].sort()), "$.guide.facets", "must contain exactly the six contracted facets");
  }
  for (const name of FACET_NAMES) {
    const facet = normalized.guide?.facets?.[name];
    addError(errors, isObject(facet), `$.guide.facets.${name}`, "must be an object");
    addError(errors, facet?.binding === normalized.guide?.binding, `$.guide.facets.${name}.binding`, "must match guide binding");
    addError(errors, FACET_STATUSES.includes(facet?.status), `$.guide.facets.${name}.status`, `must be one of ${FACET_STATUSES.join(", ")}`);
    addError(errors, Array.isArray(facet?.data), `$.guide.facets.${name}.data`, "must be an array");
    if (normalized.guide?.binding === "unavailable_for_requested_patch") {
      addError(errors, facet?.status !== "observed", `$.guide.facets.${name}.status`, "historical guide facets cannot be observed from an unbound endpoint");
    }
    if (facet?.status !== "observed") {
      addError(errors, facet?.data?.length === 0, `$.guide.facets.${name}.data`, "non-observed facets must not expose data");
      addError(errors, typeof facet?.reason === "string" && facet.reason.length > 0, `$.guide.facets.${name}.reason`, "non-observed facets need a reason");
    }
  }
  const carousel = normalized.guide?.facets?.firstCarouselComponents;
  if (carousel?.status === "observed") {
    addError(errors, carousel.semantics === "observed_frequency", "$.guide.facets.firstCarouselComponents.semantics", "must remain a non-causal observation");
    for (const [index, entry] of (carousel.data ?? []).entries()) {
      addError(errors, Number.isFinite(entry?.observedFrequency) && entry.observedFrequency >= 0 && entry.observedFrequency <= 1, `$.guide.facets.firstCarouselComponents.data[${index}].observedFrequency`, "must be a frequency in [0, 1]");
    }
    const frequencyTotal = (carousel.data ?? []).reduce((sum, entry) => sum + Number(entry?.observedFrequency ?? 0), 0);
    addError(errors, Math.abs(frequencyTotal - 1) < 1e-12, "$.guide.facets.firstCarouselComponents.data", "observed frequencies must sum to 1");
  }
  const augments = normalized.guide?.facets?.recommendedAugments;
  if (augments?.status === "observed") {
    addError(errors, augments.semantics === "source_recommendation", "$.guide.facets.recommendedAugments.semantics", "must remain a source recommendation");
  }

  addError(errors, isObject(normalized.sourceMetadata), "$.sourceMetadata", "must be an object");
  addError(errors, normalized.sourceMetadata?.normalizerVersion === NORMALIZER_VERSION, "$.sourceMetadata.normalizerVersion", `must equal ${NORMALIZER_VERSION}`);

  addError(errors, Array.isArray(normalized.entityMappings), "$.entityMappings", "must be an array");
  const mappings = new Map();
  for (const [index, mapping] of (normalized.entityMappings ?? []).entries()) {
    const path = `$.entityMappings[${index}]`;
    addError(errors, isObject(mapping), path, "must be an object");
    addError(errors, ["unit", "item", "augment"].includes(mapping?.entityType), `${path}.entityType`, "must be unit, item, or augment");
    addError(errors, mapping?.providerRef?.provider === "MetaTFT", `${path}.providerRef.provider`, "must preserve the provider");
    addError(errors, typeof mapping?.providerRef?.apiName === "string" && mapping.providerRef.apiName.length > 0, `${path}.providerRef.apiName`, "must preserve the provider reference");
    addError(errors, ENTITY_MAPPING_STATUSES.includes(mapping?.status), `${path}.status`, `must be one of ${ENTITY_MAPPING_STATUSES.join(", ")}`);
    addError(errors, mapping?.guessed === false, `${path}.guessed`, "guessed mappings are forbidden");
    if (mapping?.status === "resolved") addError(errors, typeof mapping?.canonicalId === "string" && mapping.canonicalId.length > 0, `${path}.canonicalId`, "resolved mappings need a canonical id");
    if (mapping?.status === "explicitly_unmapped") addError(errors, mapping?.canonicalId === null, `${path}.canonicalId`, "unmapped references must retain a null canonical id");
    if (mapping?.entityType && mapping?.providerRef?.apiName) mappings.set(`${mapping.entityType}:${mapping.providerRef.apiName}`, mapping);
  }
  for (const reference of entityReferences(normalized)) {
    addError(errors, mappings.has(reference), "$.entityMappings", `missing mapping classification for ${reference}`);
  }
  addError(errors, mappings.size === (normalized.entityMappings ?? []).length, "$.entityMappings", "duplicate mapping classifications are forbidden");
  return { valid: errors.length === 0, errors };
}

export function assertValid(result, message) {
  if (result.valid) return;
  const details = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  const failure = new Error(`${message}: ${details}`);
  failure.code = "PROBE_SCHEMA_INVALID";
  failure.validationErrors = result.errors;
  throw failure;
}
