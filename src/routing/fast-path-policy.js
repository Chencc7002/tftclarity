export const FAST_PATH_POLICY_VERSION = "fast-path-policy.v1";

const FAST_PATHS = Object.freeze({
  external_support_clarification: Object.freeze({
    kind: "clarification",
    ambiguityCodes: Object.freeze(["ambiguous_game_concept"])
  }),
  entity_catalog: Object.freeze({
    kind: "answer",
    requiresPureCatalogRequest: true,
    actions: Object.freeze(["search"]),
    outputs: Object.freeze(["results", "entity_details", "evidence"]),
    capabilities: Object.freeze(["entity_catalog_listing"])
  }),
  entity_details: Object.freeze({
    kind: "answer",
    actions: Object.freeze(["explain"]),
    outputs: Object.freeze(["explanation", "evidence"]),
    capabilities: Object.freeze(["entity_details"])
  }),
  item_details: Object.freeze({
    kind: "answer",
    actions: Object.freeze(["explain"]),
    outputs: Object.freeze(["explanation", "evidence"]),
    capabilities: Object.freeze(["item_details"])
  }),
  rag: Object.freeze({
    kind: "answer",
    actions: Object.freeze(["search", "recommend", "explain", "analyze", "summarize"]),
    outputs: Object.freeze([
      "results",
      "recommendation",
      "explanation",
      "analysis",
      "summary",
      "evidence"
    ]),
    capabilities: Object.freeze(["semantic_knowledge_retrieval"])
  }),
  composition_entity_clarification: Object.freeze({
    kind: "clarification",
    blockingReasons: Object.freeze([
      "missing_specific_emblem",
      "unsupported_comp_entity_filter"
    ])
  })
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean).map(String))];
}

function coverage(required, provided) {
  const available = new Set(unique(provided));
  return unique(required).filter((value) => !available.has(value));
}

export function capabilityCoversExpectedOutput(expectedOutput, capabilityOutputs) {
  return coverage(expectedOutput, capabilityOutputs).length === 0;
}

function pureCatalogContract(taskFrame) {
  return {
    ...taskFrame,
    action: "search",
    expectedOutput: ["results", "evidence"],
    capabilityRequirements: ["entity_catalog_listing"]
  };
}

export function evaluateFastPathEligibility(options = {}) {
  const definition = typeof options.fastPath === "string"
    ? FAST_PATHS[options.fastPath]
    : options.fastPath;
  if (!definition) throw new TypeError(`Unknown fast path: ${options.fastPath ?? "missing"}`);

  const rawFrame = options.taskFrame ?? {};
  const frame = options.pureCatalogRequest === true
    ? pureCatalogContract(rawFrame)
    : rawFrame;
  const result = {
    schemaVersion: FAST_PATH_POLICY_VERSION,
    fastPath: typeof options.fastPath === "string" ? options.fastPath : options.id ?? "custom",
    kind: definition.kind,
    eligible: false,
    decision: "defer",
    reason: null,
    missingOutputs: [],
    missingCapabilities: []
  };

  if (definition.kind === "clarification") {
    const ambiguityCodes = new Set(array(frame.ambiguities).map((entry) => entry?.code).filter(Boolean));
    const ambiguityMatch = array(definition.ambiguityCodes).some((code) => ambiguityCodes.has(code));
    const blockingReasonMatch = Boolean(options.blockingReason)
      && array(definition.blockingReasons).includes(options.blockingReason);
    if (
      (frame.understandingStatus === "ambiguous" && ambiguityMatch)
      || blockingReasonMatch
    ) {
      return {
        ...result,
        eligible: true,
        decision: "clarify",
        reason: ambiguityMatch ? "blocking_ambiguity" : "blocking_unsupported_constraint"
      };
    }
    return {
      ...result,
      reason: "clarification_not_blocking"
    };
  }

  const ambiguities = array(frame.ambiguities);
  const canResolveEntity = options.canResolveEntity === true
    && frame.understandingStatus === "ambiguous"
    && ambiguities.length > 0
    && ambiguities.every((entry) => entry?.code === "ambiguous_entity");
  if (frame.understandingStatus !== "understood_and_supported" && !canResolveEntity) {
    return {
      ...result,
      reason: "request_not_fully_understood"
    };
  }
  if (definition.requiresPureCatalogRequest === true && options.pureCatalogRequest !== true) {
    return {
      ...result,
      reason: "composite_catalog_request"
    };
  }
  if (array(definition.actions).length && !definition.actions.includes(frame.action)) {
    return {
      ...result,
      reason: "action_not_covered"
    };
  }

  const expectedOutput = unique([
    ...array(frame.expectedOutput),
    ...array(options.requiredOutputs)
  ]);
  const requiredCapabilities = unique([
    ...array(frame.capabilityRequirements),
    ...array(options.requiredCapabilities)
  ]);
  result.missingOutputs = coverage(expectedOutput, definition.outputs);
  result.missingCapabilities = coverage(requiredCapabilities, definition.capabilities);
  if (result.missingOutputs.length || result.missingCapabilities.length) {
    return {
      ...result,
      reason: result.missingOutputs.length
        ? "expected_output_not_covered"
        : "required_capability_not_covered"
    };
  }
  return {
    ...result,
    eligible: true,
    decision: "answer",
    reason: "fully_covered"
  };
}

export function isPureEntityCatalogRequest(input, entityType) {
  let text = String(input ?? "").toLowerCase().replace(/\s+/gu, "");
  const patterns = entityType === "trait"
    ? [
      /(?:全部|所有|完整)(?:的)?羁绊/gu,
      /羁绊(?:大全|一览|列表|图鉴)/gu,
      /(?:all|every)(?:trait|traits)|trait(?:list|catalog)/gu
    ]
    : [
      /(?:全部|所有|完整)(?:的)?(?:棋子|英雄)/gu,
      /(?:棋子|英雄)(?:大全|一览|列表|图鉴)/gu,
      /(?:all|every)(?:champion|champions|unit|units)|(?:champion|unit)(?:list|catalog)/gu
    ];
  for (const pattern of patterns) text = text.replace(pattern, "");
  text = text
    .replace(/(?:当前|本赛季|这个赛季|请|麻烦|帮我|给我|返回|看看|查看|展示|列出|有哪些|是什么|呢|吗)/gu, "")
    .replace(/[，。！？?,.;:：；、]/gu, "");
  return text.length === 0;
}

export function fastPathDefinition(id) {
  const definition = FAST_PATHS[id];
  return definition ? structuredClone(definition) : null;
}
