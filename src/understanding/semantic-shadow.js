import { createAgentStateBar } from "./context-policy.js";
import { parseSemanticTask } from "./semantic-task-parser.js";
import { matchTaskCapabilities } from "./capability-matcher.js";
import { createStructuredToolDefinitions } from "../agent/tools/definitions.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { planExecution } from "../agent/execution-plan.js";
import { statusAfterPlanning } from "../agent/status-protocol.js";
import { planTask } from "../legacy/task-planner.js";

export const SEMANTIC_SHADOW_EVENT_VERSION = "semantic-shadow-event.v1";
const DEFAULT_TOOL_REGISTRY = new ToolRegistry(createStructuredToolDefinitions());

const LEGACY_ACTIONS = Object.freeze({
  unit_best_3_items: "recommend",
  unit_build_rankings: "recommend",
  unit_build_completion: "recommend",
  unit_item_rankings: "rank",
  unit_emblem_rankings: "rank",
  unit_item_comparison: "compare",
  unit_item_availability: "search",
  unit_details: "explain",
  item_details: "explain",
  trait_details: "explain",
  comp_rankings: "rank",
  comp_trends: "analyze",
  comp_analysis: "analyze",
  clarification: "unknown"
});

function safeEmit(agentRun, event) {
  try {
    agentRun?.emit?.(event);
  } catch {
    // Shadow observability cannot change production behavior.
  }
}

function legacySummary(parsed = {}) {
  return {
    intent: String(parsed.intent ?? "unknown"),
    action: LEGACY_ACTIONS[parsed.intent] ?? "unknown",
    domain: "tft",
    needsClarification: Boolean(
      parsed.needsClarification
      || parsed.parser?.unresolvedEntityHints?.length
      || parsed.parser?.entityAmbiguities?.length
    )
  };
}

export function compareSemanticShadow(legacyParsed, semanticResult) {
  const legacy = legacySummary(legacyParsed);
  const frame = semanticResult?.taskFrame ?? {};
  return {
    actionChanged: legacy.action !== frame.action,
    domainChanged: legacy.domain !== frame.domain,
    clarificationChanged: legacy.needsClarification !== [
      "understood_but_missing_context",
      "ambiguous"
    ].includes(frame.understandingStatus),
    legacy,
    semantic: {
      schemaVersion: frame.schemaVersion ?? null,
      action: frame.action ?? "unknown",
      domain: frame.domain ?? "out_of_domain",
      understandingStatus: frame.understandingStatus ?? "ambiguous",
      confidence: Number(frame.confidence ?? 0)
    }
  };
}

export async function runSemanticShadow(input, legacyParsed, options = {}) {
  const parser = options.parser ?? parseSemanticTask;
  try {
    const resolve = () => parser(input, {
        conversation: options.conversation,
        dynamicContext: options.dynamicContext,
        exampleStore: options.exampleStore,
        provider: options.provider,
        budget: options.budget
      });
    const semanticResult = options.agentRun?.stage
      ? await options.agentRun.stage("resolving", resolve)
      : await resolve();
    const toolRegistry = options.toolRegistry ?? DEFAULT_TOOL_REGISTRY;
    const plan = async () => {
      const capabilityMatch = matchTaskCapabilities(semanticResult.taskFrame, toolRegistry, {
        compositeTools: options.compositeTools
      });
      const executionPlanning = await planExecution(semanticResult.taskFrame, capabilityMatch, {
        registry: toolRegistry,
        planner: options.planner,
        budget: {
          maxSteps: Math.min(3, Number(options.agentRun?.budget?.maxSteps ?? 3)),
          maxToolCalls: Math.min(3, Number(options.agentRun?.budget?.maxToolCalls ?? 3)),
          maxPlanTokens: Number(options.executionPlanTokenBudget ?? 800)
        }
      });
      return { capabilityMatch, executionPlanning };
    };
    const { capabilityMatch, executionPlanning } = options.agentRun?.stage
      ? await options.agentRun.stage("planning", plan)
      : await plan();
    const taskPlanning = options.legacyTaskPlanCompatibility === false
      ? null
      : await planTask(semanticResult.taskFrame, capabilityMatch, {
        registry: toolRegistry,
        planner: options.planner,
        policyCheck: options.policyCheck,
        budget: {
          maxSteps: 3,
          maxToolCalls: 3,
          maxPlannerTokens: Number(options.plannerTokenBudget ?? 600)
        }
      });
    const statusProtocol = statusAfterPlanning(
      semanticResult.taskFrame,
      capabilityMatch,
      executionPlanning
    );
    const difference = compareSemanticShadow(legacyParsed, semanticResult);
    const stateBar = createAgentStateBar({
      ...semanticResult.stateBar,
      remainingBudget: {
        steps: Math.max(0, Number(options.agentRun?.budget?.maxSteps ?? 0) - Number(options.agentRun?.stepCount ?? 0)),
        toolCalls: Math.max(0, Number(options.agentRun?.budget?.maxToolCalls ?? 0) - Number(options.agentRun?.toolCallCount ?? 0)),
        inputTokens: Math.max(
          0,
          semanticResult.telemetry.budget.maxInputTokens
            - semanticResult.telemetry.usage.cachedInputTokens
            - semanticResult.telemetry.usage.uncachedInputTokens
        ),
        outputTokens: Math.max(
          0,
          semanticResult.telemetry.budget.maxOutputTokens - semanticResult.telemetry.usage.outputTokens
        ),
        deadlineMs: semanticResult.telemetry.budget.maxLatencyMs
      }
    });
    safeEmit(options.agentRun, {
      type: "semantic_shadow_completed",
      stage: "resolving",
      durationMs: semanticResult.telemetry.durationMs,
      data: {
        schemaVersion: SEMANTIC_SHADOW_EVENT_VERSION,
        difference,
        contextResolution: semanticResult.contextResolution,
        clarificationPolicy: semanticResult.clarificationPolicy,
        capabilityMatch,
        taskPlan: taskPlanning?.plan ?? null,
        taskPlanValidation: taskPlanning?.validation ?? null,
        executionPlan: executionPlanning.plan,
        executionPlanValidation: executionPlanning.validation,
        statusProtocol,
        usage: semanticResult.telemetry.usage,
        parserBudget: semanticResult.telemetry.budget,
        exampleIds: semanticResult.telemetry.exampleIds,
        stateBar
      }
    });
    return {
      status: "completed",
      semanticResult,
      difference,
      stateBar,
      capabilityMatch,
      taskPlanning,
      executionPlanning,
      statusProtocol
    };
  } catch (error) {
    safeEmit(options.agentRun, {
      type: "semantic_shadow_failed",
      stage: "resolving",
      data: {
        schemaVersion: SEMANTIC_SHADOW_EVENT_VERSION,
        error: String(error?.code ?? error?.name ?? "semantic_shadow_error")
      }
    });
    return {
      status: "failed",
      error: String(error?.code ?? error?.name ?? "semantic_shadow_error"),
      semanticResult: null,
      difference: null,
      stateBar: null
    };
  }
}
