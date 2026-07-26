import { validateToolInput } from "../agent/tools/contracts.js";

export const TASK_PLAN_SCHEMA_VERSION = "task-plan.v1";

const MAX_PLAN_STEPS = 3;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function resolvedIds(values, type = null) {
  return array(values)
    .filter((entity) => !type || entity?.expectedType === type)
    .map((entity) => entity?.resolvedId ?? entity?.rawText)
    .filter(Boolean)
    .map(String);
}

function allEntities(frame) {
  return [...array(frame?.subjects), ...array(frame?.candidates), ...array(frame?.concepts)];
}

function allowlistedArguments(tool, frame) {
  const entities = allEntities(frame);
  const constraints = frame?.constraints ?? {};
  if (tool === "unit_builds") {
    return {
      unit: resolvedIds(entities, "champion")[0],
      ...(resolvedIds(entities, "item").length ? { comparisonItems: resolvedIds(entities, "item") } : {}),
      ...Object.fromEntries(
        ["days", "patch", "queue", "rank", "starLevel", "itemCount", "minSamples", "sort"]
          .filter((key) => constraints[key] !== undefined)
          .map((key) => [key, structuredClone(constraints[key])])
      )
    };
  }
  if (["comps_rankings", "comps_trends", "comps_analysis"].includes(tool)) {
    return Object.fromEntries(
      ["days", "patch", "queue", "rank", "minSamples", "metrics", "limit"]
        .filter((key) => constraints[key] !== undefined)
        .map((key) => [key, structuredClone(constraints[key])])
    );
  }
  if (["unit_details", "item_details", "trait_details"].includes(tool)) {
    const type = tool.replace("_details", "") === "unit" ? "champion" : tool.replace("_details", "");
    return { apiName: resolvedIds(entities, type)[0] };
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

function sanitizeStep(step = {}) {
  return {
    id: String(step.id ?? ""),
    tool: String(step.tool ?? ""),
    arguments: step.arguments && typeof step.arguments === "object" && !Array.isArray(step.arguments)
      ? structuredClone(step.arguments)
      : {},
    dependsOn: array(step.dependsOn).map(String),
    ...(array(step.argumentsFrom).length ? { argumentsFrom: array(step.argumentsFrom).map(String) } : {})
  };
}

function hasCycle(steps) {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

function policyAllowed(definition, options) {
  if (
    definition.trustTier === "first_party"
    && definition.readOnly
    && definition.sideEffect === "none"
    && !definition.requiresApproval
  ) return true;
  return options.policyCheck?.({
    tool: definition.name,
    trustTier: definition.trustTier,
    readOnly: definition.readOnly,
    sideEffect: definition.sideEffect,
    requiresApproval: definition.requiresApproval,
    permissions: definition.permissions,
    credentialScope: definition.credentialScope
  })?.allowed === true;
}

export function validateTaskPlan(plan, options = {}) {
  const errors = [];
  const registry = options.registry;
  const budget = {
    maxSteps: Math.min(MAX_PLAN_STEPS, Math.max(1, Number(options.budget?.maxSteps ?? MAX_PLAN_STEPS))),
    maxToolCalls: Math.max(0, Number(options.budget?.maxToolCalls ?? MAX_PLAN_STEPS)),
    maxPlannerTokens: Math.max(32, Number(options.budget?.maxPlannerTokens ?? 600))
  };
  if (plan?.planVersion !== TASK_PLAN_SCHEMA_VERSION) errors.push(`planVersion must be ${TASK_PLAN_SCHEMA_VERSION}`);
  const steps = array(plan?.steps).map(sanitizeStep);
  if (steps.length < 1 || steps.length > budget.maxSteps) errors.push(`steps must contain 1-${budget.maxSteps} entries`);
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
    if (!policyAllowed(definition, options)) errors.push(`tool policy denied: ${step.tool}`);
    try {
      validateToolInput(step.arguments, definition.inputSchema, step.tool);
    } catch (error) {
      errors.push(`invalid arguments for ${step.tool}: ${error?.details?.errors?.join(", ") ?? error.message}`);
    }
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency) || dependency === step.id) {
        errors.push(`invalid dependency ${dependency} for ${step.id}`);
      }
    }
  }
  if (hasCycle(steps)) errors.push("plan dependencies must be acyclic");
  const estimatedTokens = Math.ceil(JSON.stringify({ planVersion: TASK_PLAN_SCHEMA_VERSION, steps }).length / 3);
  if (estimatedTokens > budget.maxPlannerTokens) errors.push("planner token budget exceeded");
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? { planVersion: TASK_PLAN_SCHEMA_VERSION, steps } : null,
    budget,
    estimatedTokens
  };
}

function safePlannerCatalog(match, registry) {
  return match.selected.map(({ tool, capability }) => {
    const definition = registry.get(tool);
    return {
      name: definition.name,
      capabilities: [structuredClone(capability)],
      inputSchema: structuredClone(definition.inputSchema),
      trustTier: definition.trustTier,
      readOnly: definition.readOnly,
      sideEffect: definition.sideEffect,
      requiresApproval: definition.requiresApproval
    };
  });
}

export async function planTask(taskFrame, match, options = {}) {
  if (match?.status !== "understood_and_supported" || !array(match.selected).length) {
    return {
      status: "understood_but_unsupported",
      plan: null,
      plannerInvoked: false,
      validation: null
    };
  }
  let candidatePlan;
  let plannerInvoked = false;
  if (match.mode === "single_tool") {
    const tool = match.selected[0].tool;
    candidatePlan = {
      planVersion: TASK_PLAN_SCHEMA_VERSION,
      steps: [{
        id: "execute",
        tool,
        arguments: allowlistedArguments(tool, taskFrame),
        dependsOn: []
      }]
    };
  } else {
    if (typeof options.planner !== "function") {
      return {
        status: "understood_but_unsupported",
        plan: null,
        plannerInvoked: false,
        validation: { valid: false, errors: ["composite planner is unavailable"] }
      };
    }
    plannerInvoked = true;
    candidatePlan = await options.planner({
      taskFrame: structuredClone(taskFrame),
      toolCatalog: safePlannerCatalog(match, options.registry),
      constraints: {
        planVersion: TASK_PLAN_SCHEMA_VERSION,
        maxSteps: Math.min(MAX_PLAN_STEPS, Number(options.budget?.maxSteps ?? MAX_PLAN_STEPS)),
        registeredToolsOnly: true
      }
    });
  }
  const validation = validateTaskPlan(candidatePlan, options);
  return {
    status: validation.valid ? "understood_and_supported" : "understood_but_unsupported",
    plan: validation.value,
    plannerInvoked,
    validation
  };
}
