import { createTaskFrame } from "./task-frame.js";

export const CLARIFICATION_POLICY_VERSION = "clarification-policy.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}
function ambiguityIsMaterial(ambiguity = {}) {
  return ambiguity.affectsToolSelection === true
    || ambiguity.affectsResult === true
    || ["missing_context", "missing_context_reference", "conflicting_constraints", "ambiguous_entity"]
      .includes(ambiguity.code);
}

function questionFor(frame, ambiguity) {
  const missing = array(ambiguity?.missingFields);
  if (missing.includes("query_type")) {
    const unit = array(frame.subjects).find((entity) => entity?.expectedType === "champion");
    const name = unit?.canonicalName ?? unit?.rawText ?? "这个英雄";
    return `你想查询${name}的推荐装备，还是包含${name}的阵容？`;
  }
  if (missing.includes("candidate_group")) {
    return `我理解你要${frame.goal || "继续比较"}，但当前对话里没有可确定的两个候选。请只补充要比较的两个对象。`;
  }
  if (missing.includes("composition")) {
    return `我理解你要${frame.goal || "继续分析"}，但当前对话里没有可继承的阵容。请只补充阵容名称或核心英雄。`;
  }
  if (missing.includes("conversation")) {
    return `我理解你要${frame.goal || "继续上一个问题"}，但当前会话没有可用的上一轮上下文。请只补充本次要查询的对象。`;
  }
  if (ambiguity?.code === "conflicting_constraints") {
    return `我理解你要${frame.goal || "完成查询"}，但两个条件会改变结果。请只确认本次采用哪一个条件。`;
  }
  if (ambiguity?.code === "ambiguous_entity") {
    return `我理解你要${frame.goal || "完成查询"}，但对象有多个可能含义。请只确认你指的是哪一个。`;
  }
  return `我理解你要${frame.goal || "完成查询"}，但还缺少会显著改变结果的一项信息。请只补充该关键信息。`;
}

export function applyClarificationPolicy(taskFrame, contextResolution = {}, options = {}) {
  const frame = createTaskFrame(taskFrame);
  const material = array(frame.ambiguities).filter(ambiguityIsMaterial);
  if (material.length === 0) {
    return {
      schemaVersion: CLARIFICATION_POLICY_VERSION,
      taskFrame: frame,
      needsClarification: false,
      strategy: contextResolution.usedConversation ? "context_resolved" : "answer",
      question: null,
      understoodGoal: frame.goal,
      missingInformation: []
    };
  }

  const first = material[0];
  const parallelCandidates = array(first.candidates);
  const maxParallelCandidates = Math.max(2, Number(options.maxParallelCandidates ?? 3));
  if (
    first.parallelRetrievalAllowed === true
    && parallelCandidates.length > 1
    && parallelCandidates.length <= maxParallelCandidates
  ) {
    return {
      schemaVersion: CLARIFICATION_POLICY_VERSION,
      taskFrame: frame,
      needsClarification: false,
      strategy: "candidate_parallel_retrieval",
      question: null,
      understoodGoal: frame.goal,
      missingInformation: [],
      candidates: parallelCandidates.map((candidate) => structuredClone(candidate))
    };
  }

  if (first.safeAssumption && first.affectsToolSelection !== true) {
    const assumption = String(first.safeAssumption);
    const assumedFrame = createTaskFrame({
      ...frame,
      assumptions: [...frame.assumptions, assumption],
      ambiguities: frame.ambiguities.filter((entry) => entry !== first),
      understandingStatus: "understood_and_supported"
    });
    return {
      schemaVersion: CLARIFICATION_POLICY_VERSION,
      taskFrame: assumedFrame,
      needsClarification: false,
      strategy: "answer_with_explicit_assumption",
      question: null,
      understoodGoal: frame.goal,
      missingInformation: [],
      assumption
    };
  }

  const missingInformation = array(first.missingFields).length
    ? array(first.missingFields).map(String)
    : [String(first.code ?? "material_ambiguity")];
  return {
    schemaVersion: CLARIFICATION_POLICY_VERSION,
    taskFrame: createTaskFrame({
      ...frame,
      understandingStatus: frame.understandingStatus === "ambiguous"
        ? "ambiguous"
        : "understood_but_missing_context"
    }),
    needsClarification: true,
    strategy: "ask_one_key_question",
    question: questionFor(frame, first),
    understoodGoal: frame.goal,
    missingInformation
  };
}
