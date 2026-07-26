export const RESULT_POLICY_EXECUTION_VERSION = "result-policy-execution.v1";
export const RESULT_POLICY_VALIDATION_VERSION = "result-policy-validation.v1";

export const RESULT_POLICY_TYPES = Object.freeze([
  "identity",
  "filter_by_strategy",
  "registered"
]);

const TYPE_SET = new Set(RESULT_POLICY_TYPES);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function resolveResultPath(value, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce(
    (current, key) => current == null ? undefined : current[key],
    value
  );
}

function setResultPath(value, path, nextValue) {
  const keys = String(path ?? "").split(".").filter(Boolean);
  if (!keys.length) return structuredClone(nextValue);
  let current = value;
  for (const key of keys.slice(0, -1)) {
    if (!object(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys.at(-1)] = structuredClone(nextValue);
  return value;
}

function policyLimit(policy, plan) {
  if (policy.limitArgument) {
    for (const step of plan.steps ?? []) {
      const value = Number(step.arguments?.[policy.limitArgument]);
      if (Number.isInteger(value) && value > 0) return Math.min(100, value);
    }
  }
  return Math.min(100, Math.max(1, Number(policy.limit ?? policy.defaultLimit ?? 3)));
}

function policyArgument(policy, plan) {
  if (policy.value !== undefined) return policy.value;
  for (const step of plan.steps ?? []) {
    if (step.arguments?.[policy.argument] !== undefined) {
      return step.arguments[policy.argument];
    }
  }
  return undefined;
}

function compareValues(left, right, direction) {
  const leftMissing = left === undefined || left === null;
  const rightMissing = right === undefined || right === null;
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }
  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === "desc" ? -comparison : comparison;
}

function sortRecords(records, sort) {
  return records
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      for (const rule of sort) {
        const comparison = compareValues(
          resolveResultPath(left.value, rule.path),
          resolveResultPath(right.value, rule.path),
          rule.direction
        );
        if (comparison !== 0) return comparison;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.value);
}

export function validateResultPolicy(policy) {
  const errors = [];
  if (!object(policy)) {
    return {
      schemaVersion: RESULT_POLICY_VALIDATION_VERSION,
      valid: false,
      errors: ["result policy must be an object"],
      value: null
    };
  }
  if (!TYPE_SET.has(policy.type)) {
    errors.push(`result policy is not allowlisted: ${policy.type ?? "missing"}`);
  }
  if (policy.type === "filter_by_strategy") {
    for (const field of ["argument", "collectionPath", "filterPath", "outputPath"]) {
      if (!String(policy[field] ?? "").trim()) errors.push(`${field} is required`);
    }
    if (!array(policy.sort).length) errors.push("sort must contain at least one rule");
    for (const rule of array(policy.sort)) {
      if (!String(rule?.path ?? "").trim()) errors.push("sort path is required");
      if (!["asc", "desc"].includes(rule?.direction)) {
        errors.push("sort direction must be asc or desc");
      }
    }
    if (
      policy.limit !== undefined
      && (!Number.isInteger(policy.limit) || policy.limit < 1 || policy.limit > 100)
    ) {
      errors.push("limit must be an integer from 1 to 100");
    }
  }
  if (policy.type === "registered") {
    if (!String(policy.policyId ?? "").trim()) errors.push("policyId is required");
    if (policy.payload !== undefined && !object(policy.payload)) {
      errors.push("registered policy payload must be an object");
    }
  }
  return {
    schemaVersion: RESULT_POLICY_VALIDATION_VERSION,
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? structuredClone(policy) : null
  };
}

export class ResultPolicyExecutor {
  constructor(options = {}) {
    this.handlers = new Map(Object.entries(options.handlers ?? {}));
  }

  execute(plan, input) {
    const validation = validateResultPolicy(plan?.resultPolicy ?? { type: "identity" });
    if (!validation.valid) {
      throw new TypeError(`Invalid result policy: ${validation.errors.join("; ")}`);
    }
    const policy = validation.value;
    if (policy.type === "identity") {
      return {
        schemaVersion: RESULT_POLICY_EXECUTION_VERSION,
        status: "applied",
        policyType: policy.type,
        inputCount: Array.isArray(input) ? input.length : 1,
        matchedCount: Array.isArray(input) ? input.length : 1,
        outputCount: Array.isArray(input) ? input.length : 1,
        value: structuredClone(input)
      };
    }
    if (policy.type === "registered") {
      const handler = this.handlers.get(policy.policyId);
      if (typeof handler !== "function") {
        throw new TypeError(`Result policy handler is not registered: ${policy.policyId}`);
      }
      const handled = handler(structuredClone(input), structuredClone(policy.payload ?? {}), {
        plan: structuredClone(plan)
      });
      if (handled && typeof handled.then === "function") {
        throw new TypeError(`Result policy handler must be synchronous: ${policy.policyId}`);
      }
      const value = handled?.value ?? handled;
      return {
        schemaVersion: RESULT_POLICY_EXECUTION_VERSION,
        status: "applied",
        policyType: policy.type,
        policyId: policy.policyId,
        inputCount: handled?.inputCount ?? null,
        matchedCount: handled?.matchedCount ?? null,
        outputCount: handled?.outputCount ?? null,
        value: structuredClone(value)
      };
    }

    const source = resolveResultPath(input, policy.collectionPath);
    if (!Array.isArray(source)) {
      throw new TypeError(`Result policy collection is missing: ${policy.collectionPath}`);
    }
    const expected = policyArgument(policy, plan);
    if (expected === undefined || expected === null || expected === "") {
      throw new TypeError(`Result policy argument is missing: ${policy.argument}`);
    }
    const matched = source.filter((entry) => (
      resolveResultPath(entry, policy.filterPath) === expected
    ));
    const sorted = sortRecords(matched, policy.sort);
    const selected = sorted.slice(0, policyLimit(policy, plan));
    let value = structuredClone(input);
    value = setResultPath(value, policy.collectionPath, sorted);
    for (const path of array(policy.clearPaths)) value = setResultPath(value, path, []);
    value = setResultPath(value, policy.outputPath, selected);
    return {
      schemaVersion: RESULT_POLICY_EXECUTION_VERSION,
      status: "applied",
      policyType: policy.type,
      inputCount: source.length,
      matchedCount: matched.length,
      outputCount: selected.length,
      value
    };
  }
}
