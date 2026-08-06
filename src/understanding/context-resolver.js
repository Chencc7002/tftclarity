import { createTaskFrame } from "./task-frame.js";

export const CONTEXT_RESOLUTION_VERSION = "task-context-resolution.v1";

const LEGACY_ACTIONS = Object.freeze({
  unit_best_3_items: "recommend",
  unit_build_rankings: "recommend",
  unit_build_completion: "recommend",
  unit_item_rankings: "rank",
  unit_emblem_rankings: "rank",
  unit_item_comparison: "compare",
  item_carrier_rankings: "rank",
  unit_item_availability: "search",
  unit_details: "explain",
  item_details: "explain",
  trait_details: "explain",
  comp_rankings: "rank",
  comp_trends: "analyze",
  comp_analysis: "analyze"
});

const DEICTIC_REFERENCE = /(?:\u90a3(?:\u5979|\u4ed6|\u5b83|\u4ef6|\u5957|\u4e2a|\u8fd9\u4fe9)|\u8fd9(?:\u5f20\u5361|\u4ef6|\u4fe9|\u5957|\u4e2a\u73a9\u6cd5)|该羁绊|这个羁绊|这个族|里面|其中|\u5b83|\u5979|\u4ed6|\u521a\u624d|\u4e0a\u4e00\u4e2a|\u53e6\u4e00\u4e2a|\u7ee7\u7eed|\u518d\u6765|\u6309\u521a\u624d)/u;
const DEICTIC_ENTITY = /^(?:那(?:她|他|它|件|套|个)|这(?:张卡|件|俩|套|个玩法)|该羁绊|这个羁绊|这个族|里面|其中|它|她|他|另一个|另一件装备|这俩)$/u;

const PLURAL_REFERENCE = /这(?:两|2)个|這(?:兩|2)個|这俩|這倆|那(?:两|2)个|那(?:兩|2)個|它们|它們/u;
const COMPOSITION_REFERENCE = /(?:这|這|那|刚才|剛才|之前).{0,4}(?:套|阵容|陣容)/u;
const SPECIFIC_CONTINUATION = /^(?:那|再看|还有|還有|换成|換成|改成).{1,20}(?:呢|怎么样|怎麼樣|如何)?[？?]?$/u;
const GENERIC_CONTINUATION = /^(?:那|再|继续|繼續|还是|還是|然后|然後)|(?:呢|再看|继续|繼續)[？?]?$/u;

function array(value) {
  return Array.isArray(value) ? value : [];
}
function uniqueEntities(values) {
  const seen = new Set();
  return array(values).filter((entity) => {
    const key = `${entity?.expectedType ?? "unknown"}:${entity?.resolvedId ?? entity?.rawText ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entity) => structuredClone(entity));
}

function entitiesFromLegacy(query = {}, type, values = []) {
  return array(values).filter(Boolean).map((value) => ({
    rawText: String(value),
    expectedType: type,
    resolvedId: String(value),
    confidence: 1,
    source: "conversation_query"
  }));
}

function frameFromLegacyQuery(query = {}) {
  if (!query?.intent) return null;
  const unit = query.unit
    ? entitiesFromLegacy(query, "champion", [query.unit])
    : [];
  const items = entitiesFromLegacy(query, "item", [
    ...array(query.comparisonItems),
    ...array(query.lockedItems ?? query.ownedItems)
  ]);
  const traits = entitiesFromLegacy(query, "trait", query.traitFilters);
  const composition = query.comp?.value?.name || query.comp?.value?.id
    ? entitiesFromLegacy(query, "composition", [query.comp.value.name ?? query.comp.value.id])
    : [];
  const constraints = {};
  for (const key of ["patch", "days", "queue", "rankFilter", "starLevel", "itemCount", "minSamples", "sort"]) {
    if (query[key] !== undefined && query[key] !== null) constraints[key] = structuredClone(query[key]);
  }
  return createTaskFrame({
    domain: "tft",
    action: LEGACY_ACTIONS[query.intent] ?? "unknown",
    subjects: unit,
    candidates: items,
    concepts: [...traits, ...composition],
    constraints,
    goal: query.intent,
    expectedOutput: [],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function conversationFrame(entry) {
  if (entry?.taskFrame) return createTaskFrame(entry.taskFrame);
  if (entry?.frame) return createTaskFrame(entry.frame);
  if (entry?.query) return frameFromLegacyQuery(entry.query);
  if (entry?.intent) return frameFromLegacyQuery(entry);
  return null;
}

function latestFrame(conversation) {
  for (let index = array(conversation).length - 1; index >= 0; index -= 1) {
    const frame = conversationFrame(conversation[index]);
    if (frame) return { frame, turnIndex: index };
  }
  return null;
}

function referenceKinds(input) {
  const text = String(input ?? "").trim();
  return {
    plural: (
      PLURAL_REFERENCE.test(text)
      || /(?:\u8fd9|\u90a3)(?:\u4fe9|\u4e24\u4e2a)|\u5b83\u4eec|\u8fd9\u4e9b|\u90a3\u4e9b/u.test(text)
    ) && !/(?:\u4e09\u4ef6\u5957|\u4e09\u4ef6\u88c5\u5907)/u.test(text),
    composition: COMPOSITION_REFERENCE.test(text)
      && !/(?:\u4e09\u4ef6\u5957|\u88c5\u5907\u5957\u88c5)/u.test(text),
    specific: SPECIFIC_CONTINUATION.test(text),
    generic: GENERIC_CONTINUATION.test(text),
    deictic: DEICTIC_REFERENCE.test(text)
  };
}

function materialMissingContext(code, fields) {
  return {
    code,
    affectsResult: true,
    affectsToolSelection: true,
    missingFields: fields
  };
}

function inheritedConstraintEntries(previous, current, shouldInherit) {
  const constraints = structuredClone(current ?? {});
  const fieldSources = Object.fromEntries(Object.keys(constraints).map((key) => [key, "explicit"]));
  if (shouldInherit) {
    for (const [key, value] of Object.entries(previous ?? {})) {
      if (constraints[key] !== undefined) continue;
      constraints[key] = structuredClone(value);
      fieldSources[key] = "conversation";
    }
  }
  return { constraints, fieldSources };
}

function applyDefaults(constraints, fieldSources, defaults) {
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (constraints[key] !== undefined) continue;
    constraints[key] = structuredClone(value);
    fieldSources[key] = "system_default";
  }
}

export function resolveTaskFrameContext(taskFrame, options = {}) {
  const input = String(options.input ?? "");
  const references = referenceKinds(input);
  const prior = latestFrame(options.conversation);
  const wantsContext = Object.values(references).some(Boolean);
  const current = createTaskFrame(taskFrame);
  const inheritedFields = [];
  const resolvedReferences = [];
  let subjects = uniqueEntities(current.subjects);
  let candidates = uniqueEntities(current.candidates);
  let concepts = uniqueEntities(current.concepts);
  let action = current.action;
  let domain = current.domain;
  let understandingStatus = current.understandingStatus;
  let ambiguities = array(current.ambiguities).map((entry) => structuredClone(entry));

  if (wantsContext && prior) {
    const isPlaceholder = (entity) => (
      !entity?.resolvedId && DEICTIC_ENTITY.test(String(entity?.rawText ?? "").trim())
    );
    const removedPlaceholders = [
      ...subjects.filter(isPlaceholder),
      ...candidates.filter(isPlaceholder),
      ...concepts.filter(isPlaceholder)
    ];
    subjects = subjects.filter((entity) => !isPlaceholder(entity));
    candidates = candidates.filter((entity) => !isPlaceholder(entity));
    concepts = concepts.filter((entity) => !isPlaceholder(entity));
    if (removedPlaceholders.length > 0) {
      ambiguities = ambiguities.filter((entry) => (
        entry?.code !== "ambiguous_entity"
        || array(entry.candidates).some((candidate) => !DEICTIC_ENTITY.test(
          String(candidate?.rawText ?? "").trim()
        ))
      ));
    }
    const previous = prior.frame;
    if (references.deictic && concepts.every((entity) => entity.expectedType !== "trait")) {
      const previousTraits = uniqueEntities([
        ...previous.concepts,
        ...previous.subjects,
        ...previous.candidates
      ].filter((entity) => entity?.expectedType === "trait" && entity?.resolvedId));
      if (previousTraits.length === 1) {
        concepts = uniqueEntities([...concepts, ...previousTraits]);
        inheritedFields.push("concepts");
      } else if (previousTraits.length > 1) {
        ambiguities = [
          ...ambiguities,
          {
            code: "ambiguous_entity",
            inputFragment: "该羁绊",
            affectsResult: true,
            affectsToolSelection: false,
            candidates: previousTraits
          }
        ];
        understandingStatus = "ambiguous";
      }
    }
    const previousCandidatePool = uniqueEntities([
      ...previous.candidates,
      ...previous.concepts.filter((entity) => (
        ["champion", "item"].includes(entity?.expectedType)
      ))
    ]);
    if (domain === "out_of_domain" && previous.domain === "tft") {
      domain = "tft";
      understandingStatus = previous.understandingStatus === "out_of_domain"
        ? "understood_and_supported"
        : previous.understandingStatus;
      inheritedFields.push("domain");
    }
    if (subjects.length === 0 && previous.subjects.length > 0) {
      subjects = uniqueEntities(previous.subjects);
      inheritedFields.push("subjects");
    }
    if (references.plural && candidates.length === 0 && previousCandidatePool.length >= 2) {
      candidates = previousCandidatePool;
      const candidateKeys = new Set(candidates.map((entity) => (
        `${entity?.expectedType}:${entity?.resolvedId ?? entity?.rawText}`
      )));
      concepts = concepts.filter((entity) => !candidateKeys.has(
        `${entity?.expectedType}:${entity?.resolvedId ?? entity?.rawText}`
      ));
      inheritedFields.push("candidates");
    } else if (
      (references.deictic || references.generic)
      && candidates.length === 0
      && previous.candidates.length > 0
    ) {
      candidates = uniqueEntities(previous.candidates);
      inheritedFields.push("candidates");
    } else if (references.specific && candidates.length > 0 && previous.candidates.length > 0) {
      candidates = uniqueEntities([...previous.candidates, ...candidates]).slice(0, 5);
      inheritedFields.push("candidates");
    }
    if (references.composition && concepts.every((entity) => entity.expectedType !== "composition")) {
      const previousCompositions = previous.concepts.filter((entity) => entity.expectedType === "composition");
      if (previousCompositions.length > 0) {
        concepts = uniqueEntities([...concepts, ...previousCompositions]);
        inheritedFields.push("concepts");
      }
    } else if (
      (references.deictic || references.generic)
      && previous.concepts.length > 0
      && concepts.every((entity) => (
        !entity?.resolvedId
        && /^(?:阵容|陣容|体系|玩法)$/u.test(String(entity?.rawText ?? ""))
      ))
    ) {
      concepts = uniqueEntities([...concepts, ...previous.concepts]);
      inheritedFields.push("concepts");
    }
    if (
      (references.generic || references.composition || references.plural || references.deictic)
      && action === "unknown"
    ) {
      action = previous.action;
      inheritedFields.push("action");
    }
    resolvedReferences.push({
      type: references.plural ? "candidate_group" : references.composition ? "composition" : "conversation",
      sourceTurn: prior.turnIndex,
      fields: [...new Set(inheritedFields)]
    });
  }

  const shouldInheritConstraints = Boolean(prior && wantsContext);
  const inheritedConstraints = inheritedConstraintEntries(
    prior?.frame?.constraints,
    current.constraints,
    shouldInheritConstraints
  );
  for (const [key, source] of Object.entries(inheritedConstraints.fieldSources)) {
    if (source === "conversation") inheritedFields.push(`constraints.${key}`);
  }
  applyDefaults(inheritedConstraints.constraints, inheritedConstraints.fieldSources, options.defaults);

  const missingFields = [];
  const explicitResolvedEntities = [...subjects, ...candidates, ...concepts]
    .filter((entity) => Boolean(entity?.resolvedId));
  const deicticAlreadyGrounded = references.deictic
    && (
      explicitResolvedEntities.length >= 1
      || (
        current.action === "compare"
        && candidates.filter((entity) => Boolean(entity?.resolvedId)).length >= 2
      )
    );
  if (wantsContext && !prior && !deicticAlreadyGrounded) missingFields.push("conversation");
  if (references.plural && candidates.length < 2) missingFields.push("candidate_group");
  if (references.composition && concepts.every((entity) => entity.expectedType !== "composition")) {
    missingFields.push("composition");
  }
  if (missingFields.length > 0) {
    ambiguities = [
      ...ambiguities.filter((entry) => entry?.code !== "missing_context"),
      materialMissingContext("missing_context_reference", [...new Set(missingFields)])
    ];
  } else if (resolvedReferences.length > 0) {
    ambiguities = ambiguities.filter((entry) => !["missing_context", "missing_context_reference"].includes(entry?.code));
  }
  if (
    references.plural
    && prior
    && current.action === "compare"
    && candidates.filter((entity) => Boolean(entity?.resolvedId)).length >= 2
  ) {
    ambiguities = ambiguities.filter((entry) => (
      entry?.code === "conflicting_constraints"
      || !entry?.affectsToolSelection
    ));
    understandingStatus = "understood_and_supported";
  }

  const taskFrameValue = createTaskFrame({
    ...current,
    domain,
    action,
    subjects,
    candidates,
    concepts,
    constraints: inheritedConstraints.constraints,
    contextReferences: [...array(current.contextReferences), ...resolvedReferences],
    ambiguities,
    understandingStatus: missingFields.length > 0
      ? "understood_but_missing_context"
      : understandingStatus === "understood_but_missing_context" && resolvedReferences.length > 0
        ? "understood_and_supported"
        : understandingStatus === "ambiguous"
          && resolvedReferences.length > 0
          && ambiguities.length === 0
          ? "understood_and_supported"
        : understandingStatus
  });

  return {
    schemaVersion: CONTEXT_RESOLUTION_VERSION,
    taskFrame: taskFrameValue,
    resolved: missingFields.length === 0,
    usedConversation: resolvedReferences.length > 0,
    references,
    inheritedFields: [...new Set(inheritedFields)],
    fieldSources: {
      subjects: inheritedFields.includes("subjects") ? "conversation" : subjects.length ? "explicit" : null,
      candidates: inheritedFields.includes("candidates") ? "conversation" : candidates.length ? "explicit" : null,
      concepts: inheritedFields.includes("concepts") ? "conversation" : concepts.length ? "explicit" : null,
      constraints: inheritedConstraints.fieldSources
    },
    missingFields: [...new Set(missingFields)]
  };
}
