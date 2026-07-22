export const PROMOTABLE_SEASON_CONTENT_TYPES = Object.freeze([
  "aliases",
  "comp_profiles",
  "theme",
  "patch_notes",
  "wallpapers"
]);

export class SeasonContentPromotionError extends Error {
  constructor(message, code = "invalid_season_content_promotion") {
    super(message);
    this.name = "SeasonContentPromotionError";
    this.code = code;
  }
}

export function buildSeasonContentPromotionPlan(options = {}) {
  const source = options.sourceContext;
  const target = options.targetContext;
  if (!source?.id || !target?.id) {
    throw new SeasonContentPromotionError("Source and target SeasonContexts are required");
  }
  if (source.id === target.id) {
    throw new SeasonContentPromotionError("Source and target SeasonContexts must be different");
  }
  if (source.environment !== "pbe" || target.environment !== "live") {
    throw new SeasonContentPromotionError(
      "Content promotion is only designed for an explicit PBE to Live copy",
      "unsupported_season_content_promotion"
    );
  }
  if (source.season !== target.season) {
    throw new SeasonContentPromotionError(
      "PBE and Live SeasonContexts must represent the same set",
      "season_content_promotion_mismatch"
    );
  }
  const requestedTypes = options.contentTypes ?? PROMOTABLE_SEASON_CONTENT_TYPES;
  const contentTypes = [...new Set(requestedTypes.map((value) => String(value).trim()).filter(Boolean))];
  const unsupported = contentTypes.filter((type) => !PROMOTABLE_SEASON_CONTENT_TYPES.includes(type));
  if (!contentTypes.length || unsupported.length) {
    throw new SeasonContentPromotionError(
      unsupported.length ? `Unsupported content types: ${unsupported.join(", ")}` : "At least one content type is required"
    );
  }

  return {
    version: 1,
    status: "design_only",
    executable: false,
    dryRun: true,
    requiresExplicitApproval: true,
    sourceSeasonContextId: source.id,
    targetSeasonContextId: target.id,
    contentTypes,
    operations: contentTypes.map((contentType) => ({
      contentType,
      strategy: "reviewed_snapshot_copy",
      overwrite: false,
      preserveSource: true,
      targetNamespace: target.catalogNamespace
    })),
    invariants: [
      "No mutable content is shared between SeasonContexts",
      "No provider facts or query cache entries are copied",
      "Every copied record requires review and an audit event",
      "Execution remains disabled until a protected admin workflow is implemented"
    ]
  };
}
