export const LIVE_EXECUTION_PLANNER_PROMPT_VERSION = "live-execution-planner-contract.v1";

const EXECUTION_PLANNER_CONTRACT = [
  "Return exactly one JSON object matching execution-plan.v1. Do not use Markdown.",
  'schemaVersion must be "execution-plan.v1" and route must be "controlled_planner".',
  "Use only tools present in toolCatalog and only arguments allowed by each tool inputSchema.",
  "Never emit null for an optional tool argument. Omit optional arguments that have no concrete non-null value in taskFrame; omit empty optional arrays unless the schema requires them.",
  "Use between one and constraints.maxSteps steps and never exceed constraints.maxToolCalls.",
  "Every step requires id, tool, arguments, dependsOn, argumentBindings, onFailure, and evidenceContract.",
  "Each evidenceContract must copy the selected tool evidenceType into type and source into source, and include requiredFields [source, updatedAt, results].",
  "A dependent argument uses argumentBindings entries with argument, stepId, and path; the dependency stepId must also appear in dependsOn.",
  "Do not invent entity ids, statistics, tools, evidence types, sources, or schema fields.",
  "resultPolicy must be a registered result policy; use {type: identity} unless another policy is necessary.",
  "finalEvidenceContract must set required true, copy the final tool evidence type and source, require source/updatedAt/results, and set allowModelGeneratedStatistics false.",
  "For a task that first filters trait members and then compares their builds, call entity_catalog_query first and bind its results to unit_builds_batch.entities in the second step.",
  "Keep the plan concise and deterministic. Never include prose outside the JSON object."
].join("\n");

function contentFromPayload(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? part?.content ?? "").join("");
  }
  return content;
}

function parseJsonContent(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text) throw new TypeError("execution planner response was empty");
  try {
    return JSON.parse(text);
  } catch {
    const withoutFence = text
      .replace(/^```(?:json)?\s*/iu, "")
      .replace(/\s*```$/u, "")
      .trim();
    const first = withoutFence.indexOf("{");
    const last = withoutFence.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
    throw new TypeError("execution planner response did not contain valid JSON");
  }
}

function normalizePlanArguments(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return plan;
  const normalized = structuredClone(plan);
  normalized.steps = Array.isArray(normalized.steps)
    ? normalized.steps.map((step) => {
      const boundArguments = new Set(
        (Array.isArray(step?.argumentBindings) ? step.argumentBindings : [])
          .map((binding) => String(binding?.argument ?? ""))
          .filter(Boolean)
      );
      return {
        ...step,
        arguments: Object.fromEntries(
          Object.entries(
            step?.arguments && typeof step.arguments === "object" && !Array.isArray(step.arguments)
              ? step.arguments
              : {}
          ).filter(([key, value]) => value !== null && !boundArguments.has(key))
        )
      };
    })
    : normalized.steps;
  return normalized;
}

function normalizedUsage(payload = {}) {
  const usage = payload.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cachedInputTokens = Number(
    usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.cached_input_tokens
    ?? 0
  );
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    cachedInputTokens: Math.max(0, cachedInputTokens),
    uncachedInputTokens: Math.max(0, promptTokens - cachedInputTokens),
    outputTokens: Math.max(0, outputTokens)
  };
}

function plannerError(error, telemetry) {
  const normalized = error?.name === "AbortError"
    ? new Error(`execution planner timed out after ${telemetry.timeoutMs}ms`)
    : error;
  normalized.plannerTelemetry = {
    ...telemetry,
    status: "error",
    error: String(normalized?.message ?? normalized ?? "unknown error").slice(0, 500)
  };
  return normalized;
}

export function createChatExecutionPlannerProvider(options = {}) {
  if (!options.endpoint) throw new TypeError("createChatExecutionPlannerProvider requires endpoint");
  if (!options.model) throw new TypeError("createChatExecutionPlannerProvider requires model");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createChatExecutionPlannerProvider requires fetch or fetchImpl");
  }

  const provider = async function chatExecutionPlannerProvider(request = {}) {
    const startedAt = performance.now();
    const timeoutMs = Math.max(1, Number(options.timeoutMs ?? 45000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let usage = null;
    let rawProviderContent = null;
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: EXECUTION_PLANNER_CONTRACT },
            {
              role: "user",
              content: JSON.stringify({
                promptVersion: LIVE_EXECUTION_PLANNER_PROMPT_VERSION,
                taskFrame: request.taskFrame,
                toolCatalog: request.toolCatalog,
                constraints: request.constraints
              })
            }
          ],
          temperature: Number(options.temperature ?? 0),
          max_tokens: Math.max(200, Math.min(1200, Number(options.maxTokens ?? 900))),
          ...(options.includeResponseFormat === false
            ? {}
            : { response_format: { type: "json_object" } }),
          ...(options.thinkingMode ? { thinking: { type: options.thinkingMode } } : {})
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const responseText = typeof response.text === "function" ? await response.text() : "";
        throw new Error(`execution planner returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
      }
      const payload = await response.json();
      usage = normalizedUsage(payload);
      rawProviderContent = contentFromPayload(payload);
      const executionPlan = normalizePlanArguments(parseJsonContent(rawProviderContent));
      const telemetry = {
        status: "ok",
        model: options.model,
        durationMs: Math.max(0, performance.now() - startedAt),
        usage
      };
      options.onRequestLog?.({
        ...telemetry,
        rawStructuredOutput: executionPlan
      });
      return { executionPlan, telemetry };
    } catch (error) {
      const normalized = plannerError(error, {
        model: options.model,
        timeoutMs,
        durationMs: Math.max(0, performance.now() - startedAt),
        usage
      });
      options.onRequestLog?.({
        ...normalized.plannerTelemetry,
        rawStructuredOutput: rawProviderContent
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  };
  provider.plannerKind = "llm";
  provider.model = options.model;
  return provider;
}
