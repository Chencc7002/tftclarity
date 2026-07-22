import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const COMP_PROFILE_FIELDS = Object.freeze([
  "difficulty",
  "beginnerFriendly",
  "pivotDifficulty",
  "positionDifficulty",
  "contestTolerance",
  "econDifficulty",
  "notes"
]);
export const COMP_PROFILE_DEFAULTS = Object.freeze({
  difficulty: null,
  beginnerFriendly: null,
  pivotDifficulty: null,
  positionDifficulty: null,
  contestTolerance: null,
  econDifficulty: null,
  notes: []
});
export const COMP_STRATEGY_ALGORITHM_VERSION = "comp-strategy-v1";
export const COMP_STRATEGY_OVERRIDE_VERSION = "comp-strategy-binding-override-v1";
export const LINEUP_SIGNATURE_VERSION = "lineup-signature-v1";
export const MIN_PROFILE_MATCH_CONFIDENCE = 0.8;

const SEED_DATA = JSON.parse(readFileSync(new URL("../data/comp-profiles.json", import.meta.url), "utf8"));
const VERIFIED_BINDING_STATUSES = new Set(["verified", "matched"]);
const COMP_STRATEGIES = new Set(["reroll", "fast8", "fast9", "automatic"]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function baseTrait(value) {
  return String(value ?? "").replace(/_\d+$/u, "");
}

function profileValidationError(message, field = null) {
  const error = new TypeError(message);
  error.code = "invalid_comp_profile";
  error.statusCode = 400;
  error.field = field;
  return error;
}

function rating(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw profileValidationError(`${field} 必须是 1 到 5 的整数或 null`, field);
  }
  return number;
}

function strategyOverride(value, field = "strategyOverride") {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!COMP_STRATEGIES.has(normalized)) {
    throw profileValidationError(`${field} 必须是 automatic、reroll、fast8、fast9 或 null`, field);
  }
  return normalized;
}

export function validateCompProfile(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw profileValidationError("profile 必须是对象");
  }
  const unknownFields = Object.keys(value).filter((field) => !COMP_PROFILE_FIELDS.includes(field));
  if (unknownFields.length) {
    throw profileValidationError(`Profile 包含未定义字段：${unknownFields.join(", ")}`, unknownFields[0]);
  }
  if (value.beginnerFriendly !== undefined
    && value.beginnerFriendly !== null
    && typeof value.beginnerFriendly !== "boolean") {
    throw profileValidationError("beginnerFriendly 必须是 boolean 或 null", "beginnerFriendly");
  }
  if (value.notes !== undefined && !Array.isArray(value.notes)) {
    throw profileValidationError("notes 必须是字符串数组", "notes");
  }
  const notes = array(value.notes).map((note) => {
    if (typeof note !== "string" || !note.trim()) {
      throw profileValidationError("notes 只能包含非空字符串", "notes");
    }
    if (note.trim().length > 200) throw profileValidationError("单条 notes 不能超过 200 字", "notes");
    return note.trim();
  });
  if (notes.length > 20) throw profileValidationError("notes 最多 20 条", "notes");
  return {
    difficulty: rating(value.difficulty, "difficulty"),
    beginnerFriendly: value.beginnerFriendly ?? null,
    pivotDifficulty: rating(value.pivotDifficulty, "pivotDifficulty"),
    positionDifficulty: rating(value.positionDifficulty, "positionDifficulty"),
    contestTolerance: rating(value.contestTolerance, "contestTolerance"),
    econDifficulty: rating(value.econDifficulty, "econDifficulty"),
    notes
  };
}

export function normalizeCompProfileRecord(value = {}, options = {}) {
  const profileKey = String(value.profileKey ?? value.profile_key ?? options.profileKey ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(profileKey)) {
    throw profileValidationError("profileKey 必须是 2 到 80 位的小写字母、数字、下划线或连字符", "profileKey");
  }
  const metadataFields = new Set([
    "profileKey", "profile_key", "seasonContextId", "season_context_id", "profile",
    "enabled", "source", "createdAt", "created_at", "updatedAt", "updated_at"
  ]);
  const unknownRootFields = Object.keys(value).filter((field) => (
    !metadataFields.has(field) && !COMP_PROFILE_FIELDS.includes(field)
  ));
  if (unknownRootFields.length) {
    throw profileValidationError(`Comp Profile 记录包含未定义字段：${unknownRootFields.join(", ")}`, unknownRootFields[0]);
  }
  const suppliedProfile = value.profile ?? Object.fromEntries(
    COMP_PROFILE_FIELDS.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]])
  );
  const profile = validateCompProfile(suppliedProfile);
  return {
    seasonContextId: String(value.seasonContextId ?? value.season_context_id ?? options.seasonContextId ?? "set17-live"),
    profileKey,
    ...profile,
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    source: String(value.source ?? options.source ?? "admin")
  };
}

function unitApiNames(comp) {
  return uniqueSorted(array(comp?.units).map((unit) => unit?.apiName ?? unit));
}

function coreUnitApiNames(comp) {
  const explicit = array(comp?.units)
    .filter((unit) => unit?.core || Number(unit?.targetStarLevel) >= 3)
    .map((unit) => unit?.apiName ?? unit);
  const buildUnits = array(comp?.coreBuilds).map((build) => build?.unitApiName ?? build?.unit);
  const values = uniqueSorted([...explicit, ...buildUnits]);
  return values.length ? values : unitApiNames(comp);
}

function traitApiNames(comp) {
  const traits = array(comp?.traits).map((trait) => ({
    id: baseTrait(trait?.filterId ?? trait?.apiName ?? trait),
    tier: Number(trait?.tier ?? String(trait?.filterId ?? trait).match(/_(\d+)$/u)?.[1] ?? 0)
  }));
  const major = traits.filter((trait) => trait.tier >= 2).map((trait) => trait.id);
  return uniqueSorted(major.length ? major : traits.map((trait) => trait.id));
}

export function createLineupSignature(comp = {}) {
  const units = coreUnitApiNames(comp);
  const traits = traitApiNames(comp);
  const canonical = JSON.stringify({ version: LINEUP_SIGNATURE_VERSION, units, traits });
  return {
    value: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    version: LINEUP_SIGNATURE_VERSION,
    units,
    traits
  };
}

export function deriveCompStrategy(comp = {}) {
  const units = array(comp.units);
  const rosterSize = uniqueSorted(units.map((unit) => unit?.apiName ?? unit)).length;
  const targetThreeStars = units.filter((unit) => Number(unit?.targetStarLevel) >= 3);
  const rollTiming = String(comp.rollTiming ?? comp.levelAndRoll ?? comp.metadata?.rollTiming ?? "").toLowerCase();
  if (targetThreeStars.length || /(?:6|7)\s*(?:人口|level)?.*(?:d|roll)/iu.test(rollTiming)) {
    return {
      strategy: "reroll",
      reason: [
        targetThreeStars.length ? `包含 ${targetThreeStars.length} 个追三星核心` : "低人口集中刷新",
        rosterSize ? `${rosterSize} 人口阵容骨架` : "Roll Timing 指向低人口成型"
      ],
      algorithmVersion: COMP_STRATEGY_ALGORITHM_VERSION,
      confidence: targetThreeStars.length ? 0.9 : 0.78
    };
  }
  if (rosterSize >= 9 || /9\s*(?:人口|level)/iu.test(rollTiming)) {
    return {
      strategy: "fast9",
      reason: ["9人口成型", `最终阵容包含 ${rosterSize} 名棋子`],
      algorithmVersion: COMP_STRATEGY_ALGORITHM_VERSION,
      confidence: rosterSize >= 9 ? 0.86 : 0.74
    };
  }
  return {
    strategy: "fast8",
    reason: [rosterSize >= 8 ? "8人口阵容骨架" : "未发现追三星或9人口成型信号", `最终阵容包含 ${rosterSize} 名棋子`],
    algorithmVersion: COMP_STRATEGY_ALGORITHM_VERSION,
    confidence: rosterSize >= 8 ? 0.82 : 0.58
  };
}

function profileValue(record) {
  if (!record) return null;
  return Object.fromEntries(COMP_PROFILE_FIELDS.map((field) => [
    field,
    field === "notes" ? [...array(record[field])] : record[field] ?? COMP_PROFILE_DEFAULTS[field]
  ]));
}

function seedRecords(seedData, seasonContextId, key) {
  return array(seedData?.[key]).filter((record) => String(record.seasonContextId ?? "set17-live") === seasonContextId);
}

export class CompEnrichmentService {
  constructor(options = {}) {
    this.cacheStore = options.cacheStore ?? null;
    this.seedData = options.seedData ?? SEED_DATA;
  }

  async effectiveProfiles(seasonContextId) {
    const profiles = new Map(seedRecords(this.seedData, seasonContextId, "profiles").map((record) => {
      const normalized = normalizeCompProfileRecord(record, { seasonContextId, source: "seed" });
      return [normalized.profileKey, normalized];
    }));
    const overrides = await this.cacheStore?.listCompProfiles?.({ seasonContextId }) ?? [];
    for (const record of overrides) {
      if (record.enabled) profiles.set(record.profileKey, normalizeCompProfileRecord(record, { seasonContextId }));
      else profiles.delete(record.profileKey);
    }
    return profiles;
  }

  async effectiveBindings(seasonContextId, provider) {
    const bindings = new Map(seedRecords(this.seedData, seasonContextId, "bindings")
      .filter((record) => !provider || record.provider === provider)
      .map((record) => [`${record.profileKey}\u0000${record.provider}`, { ...record }]));
    const overrides = await this.cacheStore?.listCompProfileBindings?.({ seasonContextId, provider }) ?? [];
    for (const record of overrides) {
      const key = `${record.profileKey}\u0000${record.provider}`;
      const seeded = bindings.get(key);
      bindings.set(key, {
        ...record,
        strategyOverride: record.strategyOverride ?? seeded?.strategyOverride ?? null
      });
    }
    return [...bindings.values()];
  }

  async saveProfile(value, options = {}) {
    const record = normalizeCompProfileRecord(value, options);
    return this.cacheStore.upsertCompProfile(record);
  }

  async deleteProfile(profileKey, options = {}) {
    return this.cacheStore?.deleteCompProfile?.(profileKey, options) ?? null;
  }

  async bindProfile(value = {}) {
    const signature = value.lineupSignature?.value ?? value.lineupSignature;
    const signatureVersion = value.signatureVersion
      ?? value.lineupSignature?.version
      ?? LINEUP_SIGNATURE_VERSION;
    if (!signature) throw profileValidationError("绑定必须包含 lineupSignature", "lineupSignature");
    const confidence = Number(value.matchConfidence ?? 1);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw profileValidationError("matchConfidence 必须在 0 到 1 之间", "matchConfidence");
    }
    const normalizedStrategyOverride = strategyOverride(
      value.strategyOverride ?? value.strategy_override
    );
    return this.cacheStore.upsertCompProfileBinding({
      ...value,
      lineupSignature: signature,
      signatureVersion,
      strategyOverride: normalizedStrategyOverride,
      matchConfidence: confidence,
      matchStatus: value.matchStatus ?? (confidence >= MIN_PROFILE_MATCH_CONFIDENCE ? "verified" : "low_confidence")
    });
  }

  async enrichComp(comp, options = {}) {
    const seasonContextId = String(options.seasonContextId ?? "set17-live");
    const provider = String(options.provider ?? "metatft-live");
    const profiles = options.profiles ?? await this.effectiveProfiles(seasonContextId);
    const bindings = options.bindings ?? await this.effectiveBindings(seasonContextId, provider);
    const signature = createLineupSignature(comp);
    const clusterId = String(comp?.source?.clusterId ?? comp?.clusterId ?? comp?.compId?.replace(/^cluster:/u, "") ?? "");
    const clusterBindings = bindings.filter((binding) => String(binding.clusterId) === clusterId);
    const signatureBindings = bindings.filter((binding) => binding.lineupSignature === signature.value
      && (binding.signatureVersion ?? LINEUP_SIGNATURE_VERSION) === signature.version);
    const exact = clusterBindings.filter((binding) => signatureBindings.includes(binding));
    let matchStatus = "unmatched";
    let binding = null;
    if (exact.length > 1) matchStatus = "multiple_profiles";
    else if (exact.length === 1) {
      [binding] = exact;
      matchStatus = Number(binding.matchConfidence) < MIN_PROFILE_MATCH_CONFIDENCE
        ? "low_confidence"
        : VERIFIED_BINDING_STATUSES.has(binding.matchStatus)
          ? "matched"
          : binding.matchStatus;
    } else if (clusterBindings.length) matchStatus = "signature_drift";
    else if (signatureBindings.length === 1) {
      [binding] = signatureBindings;
      matchStatus = "cluster_changed";
    } else if (signatureBindings.length > 1) matchStatus = "multiple_candidates";

    const canApply = matchStatus === "matched" && binding && profiles.has(binding.profileKey);
    const automaticStrategy = deriveCompStrategy(comp);
    const configuredStrategyOverride = canApply ? strategyOverride(binding.strategyOverride) : null;
    const appliedStrategyOverride = configuredStrategyOverride === "automatic" ? null : configuredStrategyOverride;
    const strategy = appliedStrategyOverride ?? automaticStrategy.strategy;
    const strategySource = appliedStrategyOverride
      ? "tftclarity_verified_binding_override"
      : "tftclarity_automatic_derivation";
    return {
      ...comp,
      strategy,
      strategyDerivation: {
        ...automaticStrategy,
        strategy,
        automaticStrategy: automaticStrategy.strategy,
        ...(appliedStrategyOverride ? {
          reason: [`已验证绑定将自动推导 ${automaticStrategy.strategy} 覆盖为 ${appliedStrategyOverride}`],
          automaticReason: automaticStrategy.reason,
          automaticConfidence: automaticStrategy.confidence,
          confidence: Number(binding.matchConfidence ?? 1),
          overrideVersion: COMP_STRATEGY_OVERRIDE_VERSION
        } : {}),
        source: strategySource
      },
      lineupSignature: signature,
      profileKey: canApply ? binding.profileKey : null,
      profile: canApply ? profileValue(profiles.get(binding.profileKey)) : null,
      profileSource: canApply ? "tftclarity_profile" : null,
      profileBinding: {
        status: matchStatus,
        confidence: binding?.matchConfidence ?? null,
        profileKey: binding?.profileKey ?? null,
        strategyOverride: appliedStrategyOverride,
        strategyOverrideConfigured: canApply ? configuredStrategyOverride : null,
        lastVerifiedAt: binding?.lastVerifiedAt ?? null,
        clusterId,
        reviewRequired: matchStatus !== "matched"
      },
      enrichmentSources: {
        facts: "metatft",
        strategy: strategySource,
        profile: canApply ? "tftclarity_profile" : null
      }
    };
  }

  async enrichRankingResult(result, options = {}) {
    const seasonContextId = String(options.seasonContextId ?? result?.query?.seasonContextId ?? "set17-live");
    const provider = String(options.provider ?? "metatft-live");
    const profiles = await this.effectiveProfiles(seasonContextId);
    const bindings = await this.effectiveBindings(seasonContextId, provider);
    const all = [
      ...array(result?.candidates),
      ...Object.values(result?.rankings ?? {}).flat(),
      ...array(result?.rising),
      ...array(result?.falling),
      ...array(result?.improving),
      ...array(result?.references)
    ];
    const enrichedById = new Map();
    for (const comp of all) {
      if (!comp?.compId || enrichedById.has(comp.compId)) continue;
      enrichedById.set(comp.compId, await this.enrichComp(comp, {
        seasonContextId,
        provider,
        profiles,
        bindings
      }));
    }
    const currentBySignature = new Map();
    for (const comp of enrichedById.values()) {
      const key = `${comp.lineupSignature.version}\u0000${comp.lineupSignature.value}`;
      const values = currentBySignature.get(key) ?? [];
      values.push(comp);
      currentBySignature.set(key, values);
    }
    for (const [signatureKey, comps] of currentBySignature) {
      const [signatureVersion, lineupSignature] = signatureKey.split("\u0000");
      const relevantBindings = bindings.filter((binding) => (
        binding.lineupSignature === lineupSignature
        && (binding.signatureVersion ?? LINEUP_SIGNATURE_VERSION) === signatureVersion
      ));
      const profileKeys = new Set(relevantBindings.map((binding) => binding.profileKey));
      const conflictStatus = profileKeys.size > 1
        ? "multiple_profiles"
        : comps.length > 1 && profileKeys.size === 1
          ? "multiple_candidates"
          : null;
      if (!conflictStatus) continue;
      for (const comp of comps) {
        if (comp.enrichmentSources.strategy === "tftclarity_verified_binding_override") {
          const automaticStrategy = {
            strategy: comp.strategyDerivation.automaticStrategy,
            reason: comp.strategyDerivation.automaticReason,
            algorithmVersion: comp.strategyDerivation.algorithmVersion,
            confidence: comp.strategyDerivation.automaticConfidence
          };
          comp.strategy = automaticStrategy.strategy;
          comp.strategyDerivation = {
            ...automaticStrategy,
            automaticStrategy: automaticStrategy.strategy,
            source: "tftclarity_automatic_derivation"
          };
          comp.enrichmentSources.strategy = "tftclarity_automatic_derivation";
        }
        comp.profileKey = null;
        comp.profile = null;
        comp.profileSource = null;
        comp.enrichmentSources.profile = null;
        comp.profileBinding = {
          ...comp.profileBinding,
          status: conflictStatus,
          profileKey: profileKeys.size === 1 ? [...profileKeys][0] : null,
          strategyOverride: null,
          strategyOverrideConfigured: null,
          reviewRequired: true
        };
      }
    }
    const replace = (records) => array(records).map((comp) => {
      const enrichedComp = enrichedById.get(comp.compId);
      if (!enrichedComp) return comp;
      return comp.lowSample && !enrichedComp.lowSample
        ? { ...enrichedComp, lowSample: true }
        : enrichedComp;
    });
    const rankings = Object.fromEntries(Object.entries(result?.rankings ?? {}).map(([key, records]) => [key, replace(records)]));
    const enriched = [...enrichedById.values()];
    const matched = enriched.filter((comp) => comp.profileBinding.status === "matched").length;
    const strategySources = uniqueSorted(enriched.map((comp) => comp.enrichmentSources?.strategy));
    const currentClusterIds = new Set(enriched.map((comp) => comp.profileBinding.clusterId));
    const reviewQueue = enriched
      .filter((comp) => comp.profileBinding.reviewRequired)
      .map((comp) => ({
        compId: comp.compId,
        name: comp.name,
        clusterId: comp.profileBinding.clusterId,
        lineupSignature: comp.lineupSignature,
        matchStatus: comp.profileBinding.status,
        profileKey: comp.profileBinding.profileKey
      }));
    for (const binding of bindings) {
      if (!currentClusterIds.has(String(binding.clusterId))) reviewQueue.push({
        compId: null,
        name: null,
        clusterId: binding.clusterId,
        lineupSignature: {
          value: binding.lineupSignature,
          version: binding.signatureVersion ?? LINEUP_SIGNATURE_VERSION
        },
        matchStatus: "source_missing",
        profileKey: binding.profileKey
      });
    }
    return {
      ...result,
      candidates: replace(result?.candidates),
      rankings,
      rising: replace(result?.rising),
      falling: replace(result?.falling),
      improving: replace(result?.improving),
      references: replace(result?.references),
      enrichment: {
        sourceFacts: "metatft",
        automaticSource: "tftclarity_automatic_derivation",
        strategySources,
        profileSource: "tftclarity_profile",
        profiles: profiles.size,
        currentComps: enriched.length,
        matched,
        coverage: enriched.length ? matched / enriched.length : 0,
        reviewQueue
      }
    };
  }
}

export function createCompEnrichmentService(options = {}) {
  return new CompEnrichmentService(options);
}
