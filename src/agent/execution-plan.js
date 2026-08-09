import { validateToolInput } from "./tools/contracts.js";
import { resolveConceptCapability } from "../understanding/concept-capability-map.js";
import { validateResultPolicy } from "./result-policy-executor.js";

export const EXECUTION_PLAN_SCHEMA_VERSION = "execution-plan.v1";
export const EXECUTION_PLAN_VALIDATION_VERSION = "execution-plan-validation.v1";

const MAX_EXECUTION_STEPS = 3;
const ALLOWED_ROUTES = new Set([
  "deterministic_fast_path",
  "controlled_planner",
  "legacy_equivalent",
  "semantic_correction"
]);
function array(value) {
  return Array.isArray(value) ? value : [];
}

function baseTraitId(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function frameTraitIds(taskFrame) {
  const ids = new Set();
  for (const entity of [
    ...(taskFrame?.subjects ?? []),
    ...(taskFrame?.candidates ?? []),
    ...(taskFrame?.concepts ?? [])
  ]) {
    if (entity?.expectedType === "trait" && entity?.resolvedId) {
      ids.add(baseTraitId(entity.resolvedId));
    }
  }
  for (const value of taskFrame?.constraints?.traitFilters ?? []) {
    const id = typeof value === "string" ? value : value?.resolvedId;
    if (id) ids.add(baseTraitId(id));
  }
  return ids;
}

function executionPlanTraitConsistencyErrors(plan, taskFrame) {
  if (plan?.route !== "controlled_planner") return [];
  const frameTraits = frameTraitIds(taskFrame);
  if (!frameTraits.size) return [];
  const errors = [];
  for (const step of plan.steps ?? []) {
    if (step?.tool !== "entity_catalog_query") continue;
    const planTraits = array(step?.arguments?.filters?.traits).map(baseTraitId);
    if (!planTraits.length) {
      errors.push(`entity_catalog_query omits trait filters required by the task frame`);
      continue;
    }
    if (planTraits.some((traitId) => !frameTraits.has(traitId))) {
      errors.push(`entity_catalog_query trait filter conflicts with the task frame`);
    }
  }
  return errors;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function sanitizeStep(step = {}) {
  return {
    id: String(step.id ?? ""),
    tool: String(step.tool ?? ""),
    arguments: object(step.arguments),
    dependsOn: array(step.dependsOn).map(String),
    argumentBindings: array(step.argumentBindings).map((binding) => ({
      argument: String(binding?.argument ?? ""),
      stepId: String(binding?.stepId ?? ""),
      path: String(binding?.path ?? "")
    })),
    onFailure: step.onFailure === "degrade" ? "degrade" : "stop",
    evidenceContract: step.evidenceContract && typeof step.evidenceContract === "object"
      ? structuredClone(step.evidenceContract)
      : null
  };
}

function hasCycle(steps) {
  const graph = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

function trustedReadOnlyTool(definition) {
  return Boolean(
    definition
    && definition.trustTier === "first_party"
    && definition.readOnly === true
    && definition.sideEffect === "none"
    && definition.requiresApproval === false
  );
}

function validateEvidenceContract(contract, label, errors) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    errors.push(`${label} is required`);
    return;
  }
  if (!String(contract.type ?? "").trim()) errors.push(`${label}.type is required`);
  if (!String(contract.source ?? "").trim()) errors.push(`${label}.source is required`);
  if (!array(contract.requiredFields).length) {
    errors.push(`${label}.requiredFields must not be empty`);
  }
}

export function validateExecutionPlan(plan, options = {}) {
  const errors = [];
  const registry = options.registry;
  const budget = {
    maxSteps: Math.min(
      MAX_EXECUTION_STEPS,
      Math.max(1, Number(options.budget?.maxSteps ?? MAX_EXECUTION_STEPS))
    ),
    maxToolCalls: Math.min(
      MAX_EXECUTION_STEPS,
      Math.max(0, Number(options.budget?.maxToolCalls ?? MAX_EXECUTION_STEPS))
    ),
    maxPlanTokens: Math.max(64, Number(options.budget?.maxPlanTokens ?? 800))
  };
  if (plan?.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${EXECUTION_PLAN_SCHEMA_VERSION}`);
  }
  if (!ALLOWED_ROUTES.has(plan?.route)) errors.push("route is not supported");
  const steps = array(plan?.steps).map(sanitizeStep);
  if (steps.length < 1 || steps.length > budget.maxSteps) {
    errors.push(`steps must contain 1-${budget.maxSteps} entries`);
  }
  if (steps.length > budget.maxToolCalls) errors.push("tool call budget exceeded");

  const ids = new Set();
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) errors.push("step ids must be unique and non-empty");
    ids.add(step.id);
    const definition = registry?.get?.(step.tool);
    if (!definition) {
      errors.push(`tool is not registered: ${step.tool}`);
      continue;
    }
    if (!trustedReadOnlyTool(definition)) {
      errors.push(`tool is not an allowlisted first-party read-only tool: ${step.tool}`);
    }
    try {
      const boundArguments = new Set(step.argumentBindings.map((binding) => binding.argument));
      const planningSchema = {
        ...definition.inputSchema,
        required: array(definition.inputSchema.required)
          .filter((field) => !boundArguments.has(field))
      };
      validateToolInput(step.arguments, planningSchema, step.tool);
    } catch (error) {
      errors.push(
        `invalid arguments for ${step.tool}: ${error?.details?.errors?.join(", ") ?? error.message}`
      );
    }
    validateEvidenceContract(step.evidenceContract, `evidence contract for ${step.tool}`, errors);
    if (step.evidenceContract?.type !== definition.evidenceType) {
      errors.push(`evidence type mismatch for ${step.tool}`);
    }
    if (step.evidenceContract?.source !== definition.source) {
      errors.push(`evidence source mismatch for ${step.tool}`);
    }
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency) || dependency === step.id) {
        errors.push(`invalid dependency ${dependency} for ${step.id}`);
      }
    }
    for (const binding of step.argumentBindings) {
      if (
        !binding.argument
        || !binding.stepId
        || !binding.path
        || !step.dependsOn.includes(binding.stepId)
      ) {
        errors.push(`invalid argument binding for ${step.id}`);
      }
    }
  }
  if (hasCycle(steps)) errors.push("plan dependencies must be acyclic");

  const resultPolicy = plan?.resultPolicy ?? { type: "identity" };
  const resultPolicyValidation = validateResultPolicy(resultPolicy);
  errors.push(...resultPolicyValidation.errors);
  const finalEvidenceContract = plan?.finalEvidenceContract;
  validateEvidenceContract(finalEvidenceContract, "finalEvidenceContract", errors);
  if (finalEvidenceContract?.required !== true) {
    errors.push("finalEvidenceContract.required must be true");
  }
  if (finalEvidenceContract?.allowModelGeneratedStatistics !== false) {
    errors.push("finalEvidenceContract must forbid model-generated statistics");
  }
  const estimatedTokens = Math.ceil(JSON.stringify({
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    route: plan?.route,
    steps,
    resultPolicy,
    finalEvidenceContract
  }).length / 3);
  if (estimatedTokens > budget.maxPlanTokens) errors.push("execution plan token budget exceeded");
  return {
    schemaVersion: EXECUTION_PLAN_VALIDATION_VERSION,
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? {
      schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
      route: plan.route,
      conceptMapping: plan.conceptMapping ?? null,
      steps,
      resultPolicy: structuredClone(resultPolicyValidation.value),
      finalEvidenceContract: structuredClone(finalEvidenceContract)
    } : null,
    budget,
    estimatedTokens
  };
}

function defaultEvidenceContract(definition) {
  return {
    type: definition.evidenceType,
    source: definition.source,
    requiredFields: ["source", "updatedAt"]
  };
}

function defaultFinalEvidenceContract(definition) {
  return {
    required: true,
    type: definition.evidenceType,
    source: definition.source,
    requiredFields: ["source", "updatedAt"],
    allowModelGeneratedStatistics: false
  };
}

function allEntities(frame) {
  return [...array(frame?.subjects), ...array(frame?.candidates), ...array(frame?.concepts)];
}

function resolvedIds(values, type = null) {
  return [...new Set(array(values)
    .filter((entity) => !type || entity?.expectedType === type)
    .map((entity) => entity?.resolvedId ?? entity?.rawText)
    .filter(Boolean)
    .map(String))];
}

function resolvedConstraintIds(values) {
  return [...new Set(array(values)
    .map((value) => typeof value === "string"
      ? value
      : value?.resolvedId ?? value?.rawText)
    .filter(Boolean)
    .map(String))];
}

function allowlistedArguments(tool, frame) {
  const entities = allEntities(frame);
  const constraints = frame?.constraints ?? {};
  if (tool === "unit_builds") {
    return {
      unit: resolvedIds(entities, "champion")[0],
      ...(resolvedIds(entities, "item").length
        ? { comparisonItems: resolvedIds(entities, "item") }
        : {}),
      ...Object.fromEntries(
        ["days", "patch", "queue", "rank", "starLevel", "itemCount", "minSamples"]
          .filter((key) => constraints[key] !== undefined)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (tool === "unit_builds_batch") {
    const batchConstraints = {
      lockedItems: resolvedConstraintIds(constraints.lockedItems ?? constraints.ownedItems),
      excludedItems: resolvedConstraintIds(constraints.excludedItems)
    };
    const hasBatchConstraints = Object.values(batchConstraints).some((values) => values.length > 0);
    return {
      entities: entities
        .filter((entity) => entity?.expectedType === "champion" && entity?.resolvedId)
        .slice(0, 5)
        .map((entity) => ({
          apiName: entity.resolvedId,
          name: entity.canonicalName ?? entity.rawText ?? entity.resolvedId
        })),
      ...(hasBatchConstraints ? { constraints: batchConstraints } : {}),
      ...Object.fromEntries(
        ["days", "patch", "rank", "minSamples"]
          .filter((key) => constraints[key] !== undefined && constraints[key] !== null)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (["comps_rankings", "comps_trends", "comps_analysis"].includes(tool)) {
    return {
      ...(resolvedIds(entities, "champion")[0]
        ? { unit: resolvedIds(entities, "champion")[0] }
        : {}),
      ...Object.fromEntries(
        ["days", "patch", "queue", "rank", "minSamples", "metrics", "limit", "strategy"]
          .filter((key) => constraints[key] !== undefined && constraints[key] !== null)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (tool === "item_carrier_rankings") {
    return {
      item: resolvedIds(entities, "item")[0],
      ...Object.fromEntries(
        ["days", "patch", "queue", "rank", "minSamples", "limit", "buildLimit", "positiveOnly", "sort"]
          .filter((key) => constraints[key] !== undefined && constraints[key] !== null)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (["unit_details", "item_details", "trait_details"].includes(tool)) {
    const type = tool === "unit_details" ? "champion" : tool.replace("_details", "");
    return { apiName: resolvedIds(entities, type)[0] };
  }
  if (tool === "entity_catalog_query") {
    const target = constraints.targetEntityType === "item"
      ? "item"
      : constraints.targetEntityType === "trait"
        ? "trait"
        : "unit";
    const traits = resolvedIds(entities, "trait");
    return {
      entityType: target,
      filters: {
        ...(constraints.cost !== undefined ? { cost: constraints.cost } : {}),
        ...(traits.length ? { traits } : {}),
        current: constraints.current ?? true
      },
      ...(constraints.projection ? { projection: structuredClone(constraints.projection) } : {}),
      ...(constraints.sort ? { sort: constraints.sort } : {}),
      ...(constraints.limit ? { limit: constraints.limit } : {})
    };
  }
  if (tool === "composition_member_statistics") {
    return {
      trait: resolvedIds(entities, "trait")[0],
      memberMode: "non_trait_members",
      aggregateBy: "unit",
      ...Object.fromEntries(
        ["days", "patch", "queue", "rank", "minSamples", "limit"]
          .filter((key) => constraints[key] !== undefined && constraints[key] !== null)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (tool === "unit_comp_candidates") {
    return {
      unit: resolvedIds(entities, "champion")[0],
      mention: resolvedIds(entities, "composition")[0]
    };
  }
  if (tool === "semantic_search") {
    return {
      query: entities.map((entity) => entity.rawText).filter(Boolean).join(" ") || frame.goal,
      documentTypes: frame.action === "recommend" ? ["comp"] : ["entity", "intent_sample"],
      patch: constraints.patch ?? "current",
      locale: "zh-CN",
      topK: 8
    };
  }
  return {};
}

function deterministicCandidate(taskFrame, capabilityMatch, mapping, registry) {
  const selected = mapping ? { tool: mapping.tool } : capabilityMatch.selected[0];
  const definition = registry.get(selected.tool);
  return {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    route: "deterministic_fast_path",
    conceptMapping: mapping ? {
      schemaVersion: mapping.schemaVersion,
      conceptId: mapping.conceptId,
      mention: mapping.mention
    } : null,
    steps: [{
      id: "execute",
      tool: selected.tool,
      arguments: {
        ...allowlistedArguments(selected.tool, taskFrame),
        ...(mapping?.argumentTemplate ?? {})
      },
      dependsOn: [],
      evidenceContract: mapping?.evidenceContract
        ? { ...structuredClone(mapping.evidenceContract), type: definition.evidenceType }
        : defaultEvidenceContract(definition)
    }],
    resultPolicy: structuredClone(mapping?.resultPolicy ?? { type: "identity" }),
    finalEvidenceContract: mapping?.finalEvidenceContract
      ? structuredClone(mapping.finalEvidenceContract)
      : defaultFinalEvidenceContract(definition)
  };
}

export function compileExecutionPlan(taskFrame, capabilityMatch, legacyTaskPlanningOrOptions, options = {}) {
  const legacyCall = Boolean(
    legacyTaskPlanningOrOptions?.plan
    || legacyTaskPlanningOrOptions?.validation
  );
  const actualOptions = legacyCall ? options : legacyTaskPlanningOrOptions ?? {};
  if (
    taskFrame?.schemaVersion !== "task-frame.v1"
    || taskFrame.understandingStatus !== "understood_and_supported"
    || capabilityMatch?.status !== "understood_and_supported"
    || capabilityMatch?.mode !== "single_tool"
  ) {
    return {
      status: "understood_but_unsupported",
      plan: null,
      validation: {
        schemaVersion: EXECUTION_PLAN_VALIDATION_VERSION,
        valid: false,
        errors: ["execution planning gates did not pass"]
      }
    };
  }
  const mapping = resolveConceptCapability(taskFrame);
  const candidate = deterministicCandidate(
    taskFrame,
    capabilityMatch,
    mapping,
    actualOptions.registry
  );
  if (legacyCall) {
    candidate.route = mapping ? "semantic_correction" : "legacy_equivalent";
  }
  const validation = validateExecutionPlan(candidate, actualOptions);
  return {
    status: validation.valid ? "understood_and_supported" : "understood_but_unsupported",
    plan: validation.value,
    validation,
    conceptMapping: mapping
  };
}

export async function planExecution(taskFrame, capabilityMatch, options = {}) {
  if (capabilityMatch?.mode !== "composite") {
    return {
      ...compileExecutionPlan(taskFrame, capabilityMatch, options),
      plannerInvoked: false
    };
  }
  if (typeof options.planner !== "function") {
    return {
      status: "understood_but_unsupported",
      plan: null,
      plannerInvoked: false,
      validation: {
        schemaVersion: EXECUTION_PLAN_VALIDATION_VERSION,
        valid: false,
        errors: ["controlled planner is unavailable"]
      }
    };
  }
  const plannerRequest = {
    taskFrame: structuredClone(taskFrame),
    toolCatalog: capabilityMatch.selected.map(({ tool, capability }) => ({
      name: tool,
      description: options.registry.get(tool).description,
      capability: structuredClone(capability),
      inputSchema: structuredClone(options.registry.get(tool).inputSchema),
      source: options.registry.get(tool).source,
      evidenceType: options.registry.get(tool).evidenceType
    })),
    constraints: {
      schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
      route: "controlled_planner",
      maxSteps: MAX_EXECUTION_STEPS,
      maxToolCalls: MAX_EXECUTION_STEPS,
      registeredToolsOnly: true,
      readOnlyOnly: true,
      allowModelGeneratedStatistics: false
    }
  };
  const llmPlanner = options.planner.plannerKind === "llm";
  const plannerInvocation = {
    attempted: true,
    llm: llmPlanner,
    model: options.planner.model ?? null,
    succeeded: false,
    accepted: false,
    corrected: false,
    correctionReason: null,
    durationMs: null,
    usage: null,
    validationErrors: []
  };
  let candidate;
  let validation;
  try {
    const providerResult = await options.planner(plannerRequest);
    candidate = providerResult?.executionPlan ?? providerResult;
    plannerInvocation.succeeded = true;
    plannerInvocation.durationMs = providerResult?.telemetry?.durationMs ?? null;
    plannerInvocation.usage = providerResult?.telemetry?.usage ?? null;
    validation = validateExecutionPlan(candidate, options);
    const consistencyErrors = executionPlanTraitConsistencyErrors(candidate, taskFrame);
    if (consistencyErrors.length) {
      validation = {
        ...validation,
        valid: false,
        errors: [...validation.errors, ...consistencyErrors]
      };
    }
    plannerInvocation.validationErrors = [...validation.errors];
  } catch (error) {
    plannerInvocation.durationMs = error?.plannerTelemetry?.durationMs ?? null;
    plannerInvocation.usage = error?.plannerTelemetry?.usage ?? null;
    plannerInvocation.validationErrors = [String(error?.message ?? error ?? "planner_failed")];
    validation = {
      schemaVersion: EXECUTION_PLAN_VALIDATION_VERSION,
      valid: false,
      errors: [...plannerInvocation.validationErrors],
      value: null
    };
  }
  if (!validation.valid && typeof options.plannerFallback === "function") {
    const fallbackCandidate = await options.plannerFallback(plannerRequest);
    const fallbackValidation = validateExecutionPlan(
      fallbackCandidate?.executionPlan ?? fallbackCandidate,
      options
    );
    if (fallbackValidation.valid) {
      validation = fallbackValidation;
      plannerInvocation.corrected = true;
      plannerInvocation.correctionReason = plannerInvocation.succeeded
        ? "invalid_execution_plan"
        : "planner_provider_error";
    }
  }
  plannerInvocation.accepted = validation.valid && !plannerInvocation.corrected;
  return {
    status: validation.valid ? "understood_and_supported" : "understood_but_unsupported",
    plan: validation.value,
    plannerInvoked: true,
    plannerInvocation,
    validation
  };
}

export function finalizeExecutionPlanArguments(plan, tool, argumentsValue, options = {}) {
  const candidate = structuredClone(plan);
  const step = candidate?.steps?.find((entry) => entry.tool === tool);
  if (!step) {
    return {
      status: "understood_but_unsupported",
      plan: null,
      validation: {
        schemaVersion: EXECUTION_PLAN_VALIDATION_VERSION,
        valid: false,
        errors: [`ExecutionPlan does not contain tool: ${tool}`]
      }
    };
  }
  step.arguments = {
    ...step.arguments,
    ...object(argumentsValue)
  };
  const validation = validateExecutionPlan(candidate, options);
  return {
    status: validation.valid ? "understood_and_supported" : "understood_but_unsupported",
    plan: validation.value,
    validation
  };
}
