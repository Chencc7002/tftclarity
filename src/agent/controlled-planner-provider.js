function entities(frame, type) {
  return [...(frame?.subjects ?? []), ...(frame?.candidates ?? []), ...(frame?.concepts ?? [])]
    .filter((entity) => entity?.expectedType === type)
    .map((entity) => entity.resolvedId)
    .filter(Boolean);
}

function constraintTraitIds(frame) {
  return (frame?.constraints?.traitFilters ?? []).map((value) => {
    if (typeof value === "string") return value;
    if (value?.resolvedId) return value.resolvedId;
    return /^TFT\d+_/u.test(String(value?.rawText ?? "")) ? value.rawText : null;
  }).filter(Boolean);
}

function baseTraitId(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function evidence(tool) {
  return {
    type: tool.evidenceType,
    source: tool.source,
    requiredFields: ["source", "updatedAt", "results"]
  };
}

export function createTftControlledPlannerProvider() {
  const provider = async function controlledPlanner({ taskFrame, toolCatalog }) {
    const byName = new Map(toolCatalog.map((tool) => [tool.name, tool]));
    const catalogTool = byName.get("entity_catalog_query");
    const batchTool = byName.get("unit_builds_batch");
    if (!catalogTool || !batchTool) {
      throw new TypeError("No safe controlled plan is available for the selected tools");
    }
    const constraints = taskFrame.constraints ?? {};
    const traitIds = [...new Set([
      ...entities(taskFrame, "trait"),
      ...constraintTraitIds(taskFrame)
    ].map(baseTraitId))];
    return {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [
        {
          id: "find-entities",
          tool: "entity_catalog_query",
          arguments: {
            entityType: "unit",
            filters: {
              ...(constraints.cost !== undefined ? { cost: constraints.cost } : {}),
              ...(traitIds.length ? { traits: traitIds } : {}),
              current: true
            },
            projection: ["apiName", "name", "cost", "traits", "traitNames"],
            limit: Math.min(5, Number(constraints.candidateLimit ?? 5))
          },
          dependsOn: [],
          argumentBindings: [],
          onFailure: "stop",
          evidenceContract: evidence(catalogTool)
        },
        {
          id: "compare-builds",
          tool: "unit_builds_batch",
          arguments: {
            ...(Number.isInteger(constraints.days) ? { days: constraints.days } : {}),
            ...(typeof constraints.patch === "string" && constraints.patch.trim()
              ? { patch: constraints.patch }
              : {}),
            ...(Array.isArray(constraints.rank) ? { rank: constraints.rank } : {}),
            ...(Number.isInteger(constraints.minSamples)
              ? { minSamples: constraints.minSamples }
              : {})
          },
          dependsOn: ["find-entities"],
          argumentBindings: [{
            argument: "entities",
            stepId: "find-entities",
            path: "results"
          }],
          onFailure: "stop",
          evidenceContract: evidence(batchTool)
        }
      ],
      resultPolicy: { type: "identity" },
      finalEvidenceContract: {
        required: true,
        ...evidence(batchTool),
        allowModelGeneratedStatistics: false
      }
    };
  };
  provider.plannerKind = "deterministic";
  provider.model = null;
  return provider;
}
