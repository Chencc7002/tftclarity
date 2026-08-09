import { validateExecutionPlan } from "./execution-plan.js";
import {
  ResultPolicyExecutor,
  resolveResultPath
} from "./result-policy-executor.js";
import { runtimeError } from "./runtime-errors.js";
import { validateToolEvidence } from "./tool-evidence-validator.js";

export const EXECUTION_TRACE_SCHEMA_VERSION = "execution-trace.v1";
export const EVIDENCE_VALIDATION_SCHEMA_VERSION = "evidence-validation.v2";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function cloneObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function resolvePath(value, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce(
    (current, key) => current == null ? undefined : current[key],
    value
  );
}

function materializeArguments(step, completed) {
  const argumentsValue = cloneObject(step.arguments);
  for (const binding of array(step.argumentBindings)) {
    const source = completed.get(String(binding.stepId));
    const value = resolvePath(source?.value, binding.path);
    if (value === undefined) {
      throw runtimeError(
        "execution_dependency_output_missing",
        `Execution step ${step.id} could not resolve ${binding.stepId}.${binding.path}`
      );
    }
    argumentsValue[String(binding.argument)] = structuredClone(value);
  }
  return argumentsValue;
}

function dependencyOrder(steps) {
  const pending = new Map(steps.map((step) => [step.id, step]));
  const completed = new Set();
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((step) => (
      array(step.dependsOn).every((dependency) => completed.has(dependency))
    ));
    if (!ready.length) {
      throw runtimeError("invalid_execution_plan", "ExecutionPlan dependencies cannot be scheduled");
    }
    for (const step of ready) {
      pending.delete(step.id);
      completed.add(step.id);
      ordered.push(step);
    }
  }
  return ordered;
}

function evidenceField(value, metadata, path) {
  if (path === "source") return metadata?.source;
  if (path === "updatedAt") return metadata?.updatedAt;
  if (String(path).startsWith("metadata.")) {
    return resolvePath(metadata, String(path).slice("metadata.".length));
  }
  const direct = resolvePath(value, path);
  if (direct !== undefined && direct !== null) return direct;
  return resolvePath(metadata, path);
}

function missing(value) {
  return value === undefined || value === null || value === "";
}

function validateRequiredFields(value, metadata, fields, label, errors) {
  for (const field of array(fields)) {
    if (missing(evidenceField(value, metadata, field))) {
      errors.push(`${label} missing required field ${field}`);
    }
  }
}

export function validateExecutionEvidence(plan, toolResults, options = {}) {
  const stepErrors = [];
  const finalErrors = [];
  const resultsByStep = new Map(toolResults.map((entry) => [entry.stepId, entry]));
  const completedResults = [];
  for (const step of plan.steps) {
    const result = resultsByStep.get(step.id);
    if (!result || result.status !== "completed") {
      stepErrors.push(`missing completed ToolResult for ${step.id}`);
      continue;
    }
    completedResults.push(result);
    const contract = step.evidenceContract;
    const metadata = result.toolResult?.metadata;
    const validation = validateToolEvidence({
      definition: { name: step.tool, source: contract.source, evidenceType: contract.type },
      toolResult: result.toolResult,
      evidenceContract: contract
    });
    stepErrors.push(...validation.errors.map((error) => `evidence for ${step.id}: ${error}`));
  }

  const finalContract = plan.finalEvidenceContract;
  const finalResult = options.finalResult;
  const finalPending = options.finalPending === true;
  if (!finalPending) {
    const lastMetadata = completedResults.at(-1)?.toolResult?.metadata;
    if (lastMetadata?.evidenceType !== finalContract.type) {
      finalErrors.push("final evidence type mismatch");
    }
    if (lastMetadata?.source !== finalContract.source) {
      finalErrors.push("final evidence source mismatch");
    }
    if (
      finalContract.allowModelGeneratedStatistics === false
      && lastMetadata?.modelGeneratedStatistics === true
    ) {
      finalErrors.push("model-generated statistics are forbidden");
    }
    validateRequiredFields(
      finalResult,
      lastMetadata,
      finalContract.envelopeRequiredFields ?? (
        finalContract.collectionPath ? [] : finalContract.requiredFields
      ),
      "final evidence",
      finalErrors
    );
    if (finalContract.collectionPath) {
      const collection = resolveResultPath(finalResult, finalContract.collectionPath);
      if (!Array.isArray(collection)) {
        finalErrors.push(`final evidence collection is missing: ${finalContract.collectionPath}`);
      } else {
        if (collection.length === 0 && finalContract.allowEmpty !== true) {
          finalErrors.push("final evidence collection must not be empty");
        }
        collection.forEach((entry, index) => validateRequiredFields(
          entry,
          lastMetadata,
          finalContract.requiredFields,
          `final evidence ${finalContract.collectionPath}[${index}]`,
          finalErrors
        ));
      }
    }
  }
  const errors = [...stepErrors, ...finalErrors];
  return {
    schemaVersion: EVIDENCE_VALIDATION_SCHEMA_VERSION,
    sufficient: !finalPending && errors.length === 0,
    pending: finalPending,
    stepSufficient: stepErrors.length === 0,
    finalSufficient: !finalPending && finalErrors.length === 0,
    stepErrors,
    finalErrors,
    errors
  };
}

export class ExecutionPlanExecutor {
  constructor(options = {}) {
    if (!options.registry) throw new TypeError("ExecutionPlanExecutor requires a ToolRegistry");
    if (!options.toolExecutor) throw new TypeError("ExecutionPlanExecutor requires a ToolExecutor");
    this.registry = options.registry;
    this.toolExecutor = options.toolExecutor;
    this.resultPolicyExecutor = options.resultPolicyExecutor ?? new ResultPolicyExecutor();
    this.now = options.now ?? Date.now;
  }

  finalizeResult(execution, result, options = {}) {
    if (!execution?.plan) throw new TypeError("Execution result must contain a validated plan");
    let resultPolicyExecution;
    try {
      resultPolicyExecution = this.resultPolicyExecutor.execute(execution.plan, result);
    } catch (error) {
      resultPolicyExecution = {
        schemaVersion: "result-policy-execution.v1",
        status: "failed",
        policyType: execution.plan.resultPolicy?.type ?? null,
        error: String(error?.message ?? "result policy failed"),
        value: null
      };
    }
    const evidenceValidation = validateExecutionEvidence(
      execution.plan,
      execution.results,
      { finalResult: resultPolicyExecution.value }
    );
    if (resultPolicyExecution.status !== "applied") {
      evidenceValidation.finalErrors.push(resultPolicyExecution.error);
      evidenceValidation.errors.push(resultPolicyExecution.error);
      evidenceValidation.finalSufficient = false;
      evidenceValidation.sufficient = false;
    }
    const status = execution.status === "completed"
      && resultPolicyExecution.status === "applied"
      && evidenceValidation.sufficient
      ? "completed"
      : execution.status === "degraded"
        ? "degraded"
        : "failed";
    const trace = {
      ...execution.trace,
      status,
      resultPolicy: {
        type: resultPolicyExecution.policyType,
        status: resultPolicyExecution.status,
        inputCount: resultPolicyExecution.inputCount ?? null,
        matchedCount: resultPolicyExecution.matchedCount ?? null,
        outputCount: resultPolicyExecution.outputCount ?? null
      },
      evidenceStatus: evidenceValidation.sufficient ? "sufficient" : "insufficient"
    };
    options.run?.emit?.({
      type: "execution_result_policy_completed",
      stage: "retrieving",
      data: {
        route: execution.plan.route,
        status: resultPolicyExecution.status,
        policyType: resultPolicyExecution.policyType,
        evidenceSufficient: evidenceValidation.sufficient
      }
    });
    return {
      ...execution,
      status,
      result: resultPolicyExecution.value,
      resultPolicyExecution,
      evidenceValidation,
      trace
    };
  }

  finalizeCachedResult(plan, result, options = {}) {
    const validation = validateExecutionPlan(plan, {
      registry: this.registry,
      budget: { maxSteps: 3, maxToolCalls: 3, maxPlanTokens: 800 }
    });
    if (!validation.valid) {
      throw runtimeError("invalid_execution_plan", validation.errors.join("; "));
    }
    if (validation.value.steps.length !== 1) {
      throw runtimeError(
        "cached_composite_plan_unsupported",
        "Cached ExecutionPlan finalization currently requires one deterministic step"
      );
    }
    const step = validation.value.steps[0];
    const metadata = {
      source: options.source ?? step.evidenceContract.source,
      evidenceType: step.evidenceContract.type,
      updatedAt: options.updatedAt ?? null,
      patch: options.patch ?? step.arguments.patch ?? null,
      cache: { hit: true },
      modelGeneratedStatistics: false
    };
    const execution = {
      status: "completed",
      plan: validation.value,
      results: [{
        stepId: step.id,
        tool: step.tool,
        status: "completed",
        toolResult: {
          schemaVersion: "agent_tool_result.v1",
          toolCallId: `cache:${step.id}`,
          toolName: step.tool,
          status: "completed",
          startedAt: null,
          completedAt: null,
          durationMs: 0,
          attempts: 1,
          value: result,
          error: null,
          metadata
        }
      }],
      evidence: [{
        stepId: step.id,
        tool: step.tool,
        type: step.evidenceContract.type,
        value: result,
        metadata
      }],
      trace: {
        schemaVersion: EXECUTION_TRACE_SCHEMA_VERSION,
        route: validation.value.route,
        source: "execution_plan_cache",
        status: "completed",
        stepCount: 1,
        toolCallCount: 0,
        durationMs: 0,
        resultPolicy: {
          type: validation.value.resultPolicy.type,
          status: "deferred"
        },
        evidenceStatus: "pending",
        steps: [{
          id: step.id,
          tool: step.tool,
          status: "cache_hit",
          startedAt: null,
          completedAt: null,
          durationMs: 0,
          error: null
        }]
      }
    };
    return this.finalizeResult(execution, result, options);
  }

  async execute(plan, options = {}) {
    if (options.run?.stage && options.stageManaged !== true) {
      return options.run.stage("retrieving", () => this.execute(plan, {
        ...options,
        stageManaged: true
      }));
    }
    const validation = validateExecutionPlan(plan, {
      registry: this.registry,
      budget: {
        maxSteps: Math.min(3, Number(options.run?.budget?.maxToolCalls ?? 3)),
        maxToolCalls: Math.min(3, Number(options.run?.budget?.maxToolCalls ?? 3)),
        maxPlanTokens: Number(options.maxPlanTokens ?? 800)
      }
    });
    if (!validation.valid) {
      throw runtimeError("invalid_execution_plan", validation.errors.join("; "));
    }
    const validatedPlan = validation.value;
    const startedAt = Number(this.now());
    const completed = new Map();
    const stepStates = validatedPlan.steps.map((step) => ({
      id: step.id,
      tool: step.tool,
      status: "pending",
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      error: null
    }));
    const stateById = new Map(stepStates.map((state) => [state.id, state]));
    const results = [];
    let executionStatus = "completed";

    for (const step of dependencyOrder(validatedPlan.steps)) {
      options.run?.assertActive?.();
      const state = stateById.get(step.id);
      state.status = "running";
      state.startedAt = new Date(this.now()).toISOString();
      const stepStartedAt = Number(this.now());
      try {
        const handler = options.handlers?.[step.tool]
          ?? options.resolveHandler?.(step.tool, step)
          ?? null;
        const toolResult = await this.toolExecutor.execute(
          step.tool,
          materializeArguments(step, completed),
          {
            source: this.registry.get(step.tool).source,
            handler,
            run: options.run,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            maxRetriesPerTool: options.maxRetriesPerTool,
            intent: options.intent,
            executionPlanRoute: validatedPlan.route,
            executionStepId: step.id
          }
        );
        const entry = {
          stepId: step.id,
          tool: step.tool,
          status: "completed",
          toolResult
        };
        completed.set(step.id, toolResult);
        results.push(entry);
        state.status = "completed";
      } catch (error) {
        state.status = "failed";
        state.error = String(error?.code ?? error?.name ?? "tool_failed");
        results.push({
          stepId: step.id,
          tool: step.tool,
          status: "failed",
          toolResult: error?.toolResult ?? null,
          error: state.error
        });
        executionStatus = step.onFailure === "degrade" ? "degraded" : "failed";
        if (step.onFailure !== "degrade") break;
      } finally {
        state.completedAt = new Date(this.now()).toISOString();
        state.durationMs = Math.max(0, Number(this.now()) - stepStartedAt);
      }
    }

    for (const state of stepStates) {
      if (state.status === "pending") state.status = "skipped";
    }
    const finalPending = executionStatus === "completed" && options.deferResultPolicy === true;
    const policyInput = results.filter((entry) => entry.status === "completed")
      .at(-1)?.toolResult?.value;
    let resultPolicyExecution = null;
    let finalResult;
    if (executionStatus === "completed" && !finalPending) {
      try {
        resultPolicyExecution = this.resultPolicyExecutor.execute(validatedPlan, policyInput);
        finalResult = resultPolicyExecution.value;
      } catch (error) {
        executionStatus = "failed";
        resultPolicyExecution = {
          schemaVersion: "result-policy-execution.v1",
          status: "failed",
          policyType: validatedPlan.resultPolicy.type,
          error: String(error?.message ?? "result policy failed"),
          value: null
        };
      }
    }
    const evidenceValidation = validateExecutionEvidence(validatedPlan, results, {
      finalPending,
      finalResult
    });
    if (resultPolicyExecution?.status === "failed") {
      evidenceValidation.finalErrors.push(resultPolicyExecution.error);
      evidenceValidation.errors.push(resultPolicyExecution.error);
      evidenceValidation.finalSufficient = false;
      evidenceValidation.sufficient = false;
    }
    if (executionStatus === "completed" && !finalPending && !evidenceValidation.sufficient) {
      executionStatus = "failed";
    }
    if (executionStatus === "completed" && finalPending && !evidenceValidation.stepSufficient) {
      executionStatus = "failed";
    }
    const trace = {
      schemaVersion: EXECUTION_TRACE_SCHEMA_VERSION,
      route: validatedPlan.route,
      source: "execution_plan",
      status: executionStatus,
      stepCount: validatedPlan.steps.length,
      toolCallCount: results.filter((result) => result.toolResult).length,
      durationMs: Math.max(0, Number(this.now()) - startedAt),
      resultPolicy: {
        type: validatedPlan.resultPolicy.type,
        status: finalPending ? "deferred" : resultPolicyExecution?.status ?? "not_applied"
      },
      evidenceStatus: finalPending
        ? "pending"
        : evidenceValidation.sufficient ? "sufficient" : "insufficient",
      steps: stepStates
    };
    options.run?.emit?.({
      type: "execution_plan_completed",
      stage: "retrieving",
      durationMs: trace.durationMs,
      data: trace
    });
    return {
      status: executionStatus,
      plan: validatedPlan,
      results,
      result: finalResult,
      resultPolicyExecution,
      evidence: results
        .filter((result) => result.status === "completed")
        .map((result) => ({
          stepId: result.stepId,
          tool: result.tool,
          type: validatedPlan.steps.find((step) => step.id === result.stepId)?.evidenceContract?.type,
          value: result.toolResult.value,
          metadata: result.toolResult.metadata
        })),
      evidenceValidation,
      trace
    };
  }
}
