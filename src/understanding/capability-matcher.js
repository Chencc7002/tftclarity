export const CAPABILITY_MATCH_VERSION = "capability-match.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean).map(String))];
}

function frameEntityTypes(frame) {
  return unique([
    ...array(frame?.subjects).map((entity) => entity?.expectedType),
    ...array(frame?.candidates).map((entity) => entity?.expectedType),
    ...array(frame?.concepts).map((entity) => entity?.expectedType)
  ]);
}

function includesAll(container, required) {
  const values = new Set(array(container));
  return array(required).every((value) => values.has(value));
}

function scoreCapability(frame, definition, capability) {
  const entityTypes = frameEntityTypes(frame);
  const allowed = array(capability.allowedEntityTypes);
  const required = array(capability.requiredEntityTypes);
  if (capability.action !== frame.action) return null;
  if (entityTypes.length === 0 && capability.allowNoEntities !== true && required.length > 0) return null;
  if (allowed.length > 0 && entityTypes.some((type) => !allowed.includes(type))) return null;
  if (!includesAll(entityTypes, required)) return null;
  if (!array(capability.requiredConstraints).every((key) => frame?.constraints?.[key] !== undefined)) {
    return null;
  }
  if (!includesAll(capability.features, frame?.capabilityRequirements)) return null;

  const goals = array(capability.goals);
  const outputs = array(capability.outputs);
  const expectedOutputs = array(frame.expectedOutput);
  const outputMatches = expectedOutputs.filter((output) => outputs.includes(output)).length;
  const goalMatch = goals.length === 0 || goals.includes(frame.goal);
  const score = 50
    + (goalMatch ? 20 : 0)
    + required.length * 5
    + array(capability.requiredConstraints).length * 8
    + outputMatches * 4
    + (definition.trustTier === "first_party" ? 5 : 0)
    + (definition.readOnly ? 3 : 0);
  return {
    tool: definition.name,
    capability: structuredClone(capability),
    score,
    outputCoverage: expectedOutputs.length ? outputMatches / expectedOutputs.length : 1,
    trustTier: definition.trustTier,
    readOnly: definition.readOnly,
    sideEffect: definition.sideEffect,
    requiresApproval: definition.requiresApproval,
    evidenceType: definition.evidenceType
  };
}

function unsupported(frame, considered) {
  return {
    schemaVersion: CAPABILITY_MATCH_VERSION,
    status: "understood_but_unsupported",
    mode: "unsupported",
    action: frame?.action ?? "unknown",
    goal: frame?.goal ?? "understand_request",
    selected: [],
    considered
  };
}

export function matchTaskCapabilities(taskFrame, registry, options = {}) {
  if (!registry?.list) throw new TypeError("Capability Matcher requires a ToolRegistry");
  if (
    taskFrame?.domain === "out_of_domain"
    || [
      "out_of_domain",
      "ambiguous",
      "understood_but_missing_context",
      "understood_but_unsupported"
    ].includes(taskFrame?.understandingStatus)
  ) {
    return unsupported(taskFrame, []);
  }
  const matches = [];
  const considered = [];
  for (const definition of registry.list()) {
    for (const capability of definition.capabilities ?? []) {
      considered.push({ tool: definition.name, action: capability.action });
      const match = scoreCapability(taskFrame, definition, capability);
      if (match) matches.push(match);
    }
  }
  matches.sort((left, right) => right.score - left.score || left.tool.localeCompare(right.tool));
  if (matches.length === 0) return unsupported(taskFrame, considered);

  const selected = [matches[0]];
  const compositeTools = unique(options.compositeTools);
  if (compositeTools.length > 1) {
    const selectedComposite = compositeTools.map((tool) => matches.find((match) => match.tool === tool));
    if (selectedComposite.every(Boolean)) {
      return {
        schemaVersion: CAPABILITY_MATCH_VERSION,
        status: "understood_and_supported",
        mode: "composite",
        action: taskFrame.action,
        goal: taskFrame.goal,
        selected: selectedComposite,
        considered
      };
    }
  }
  return {
    schemaVersion: CAPABILITY_MATCH_VERSION,
    status: "understood_and_supported",
    mode: "single_tool",
    action: taskFrame.action,
    goal: taskFrame.goal,
    selected,
    alternatives: matches.slice(1, 5),
    considered
  };
}
