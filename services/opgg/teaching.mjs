/**
 * Phase 4 LLM teaching commentary on top of Phase 3 structured reviews.
 *
 * The LLM only receives the desensitized structured evidence bundle (no
 * PUUIDs, no other-player identities). Every reason/alternative must cite
 * evidenceIds that exist in the bundle; claims about round-by-round
 * operations (level-up/roll timings, transition boards, positioning) are
 * detected and rejected. When the LLM is disabled or fails validation, a
 * deterministic rule-based teaching text is returned instead.
 */

const TEACHING_SYSTEM_PROMPT = `你是 tftclarity 的中文 TFT 复盘教练。输入是 OP.GG 对局终局状态的结构化证据包（EvidenceBundle JSON）。

必须遵守：
1. 只能使用证据包中的事实（名次、等级、金币、淘汰回合、羁绊、棋子星级、装备、阵容签名、近期统计、样本量）。
2. 可以解释阵容完成度、装备分配、核心棋子质量、近期阵容偏好和样本含义。
3. 严禁编造逐回合过程：不得声称某回合升级/拉人口、某回合搜牌、中期过渡阵容、站位调整。证据只包含对局结束时的最终状态。
4. 样本不足时（sampleTier 为 recent_only / recent_attempts / insufficient / no_data）必须在 warnings 中说明，不得输出长期稳定风格结论。
5. 每条 reason/alternative 的 evidenceIds 必须引用证据包中真实存在的 evidenceId（match:xxx / comp:N / stat:xxx）。
6. citations 只能使用证据包中的 matchId。
7. 即使作为教学建议，也不得使用「搜牌」「站位」「过渡阵容」「X-X 回合」等逐回合操作表述；建议只能基于终局证据（核心星级、装备完整度、阵容完成度、样本量）。
8. 返回严格 JSON，不要 Markdown 代码块，不要解释。

输出 JSON 必须完全匹配以下结构（不要增减顶层字段）：
{
  "schemaVersion": "coach_answer.v1",
  "status": "ok",
  "headline": "一句话标题",
  "text": "教学点评正文",
  "currentRecommendation": null,
  "reasons": [
    { "dimension": "维度名", "evidenceIds": ["stat:xxx"], "text": "理由" }
  ],
  "alternatives": [
    { "dimension": "维度名", "evidenceIds": ["stat:xxx"], "text": "建议", "conditions": ["条件"] }
  ],
  "citations": ["matchId"],
  "warnings": ["提示"]
}`;

const STAT_EVIDENCE_IDS = [
  "stat:avgPlacement",
  "stat:top4Rate",
  "stat:avgLevel",
  "stat:bestPlacement",
  "stat:worstPlacement",
  "stat:complete",
  "stat:sample"
];

const BANNED_CLAIM_PATTERNS = [
  {
    pattern: /[0-9](?:-[0-9])?\s*(?:升|拉)\s*[0-9]/u,
    label: "round level-up/roll timing"
  },
  {
    pattern: /(?:搜牌|搜卡|搜出|D牌|刷牌)/u,
    label: "rolling claim"
  },
  {
    pattern: /(?:站位|换位|摆位|调位)/u,
    label: "positioning claim"
  },
  {
    pattern: /(?:过渡阵容|中期过渡|前期过渡)/u,
    label: "transition board claim"
  },
  {
    pattern: /[2-6]-[1-7]/u,
    label: "specific round stage"
  }
];

function mostPlayedUnitName(review) {
  const counts = new Map();
  for (const entry of review?.matches ?? []) {
    for (const unit of entry?.facts?.units ?? []) {
      const id = unit?.displayName ?? unit?.characterId ?? unit?.name ?? null;
      if (!id) continue;
      const name = String(id).replace(/^TFT\d+_/u, "");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return null;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function resolveChampionPlaceholders(comments, review) {
  const championName = mostPlayedUnitName(review);
  if (!championName || !Array.isArray(comments)) {
    return comments ?? [];
  }
  return comments.map((comment) => ({
    name: String(comment?.name ?? "").replaceAll("{championName}", championName),
    description: String(comment?.description ?? "").replaceAll(
      "{championName}",
      championName
    )
  }));
}

function buildTeachingEvidence(
  review,
  { playerId, displayName, poolId, region }
) {
  const matches = review.matches.map((entry) => {
    const facts = entry.facts;
    return {
      evidenceId: `match:${facts.matchId}`,
      matchId: facts.matchId,
      gameDatetime: facts.gameDatetime,
      patchLabel: facts.patchLabel,
      placement: facts.placement,
      level: facts.level,
      goldLeft: facts.goldLeft,
      lastRound: facts.lastRound,
      playersEliminated: facts.playersEliminated,
      compFamilySignature:
        facts.displaySignature ?? facts.compFamilySignature,
      traits: facts.traits,
      units: facts.units,
      vsRecentAverage: facts.vsRecentAverage,
      conclusions: entry.conclusions.map((item) => item.conclusion)
    };
  });

  const compPreferences = review.compPreferences.map((comp, index) => ({
    evidenceId: `comp:${index}`,
    compSignature: comp.displaySignature ?? comp.compSignature,
    count: comp.count,
    share: comp.share
  }));

  // OP.GG exposes a catalogue of comment templates here, not observations
  // about this player. Keep the schema field for compatibility, but never
  // treat those templates as evidence or pass them to the model.
  const opggPlayStyleComments = [];

  return {
    schemaVersion: "opgg_teaching_evidence.v1",
    source: "opgg",
    player: {
      id: playerId,
      displayName
    },
    pool: {
      id: poolId ?? null,
      region: region ?? null
    },
    patch: matches[0]?.patchLabel ?? null,
    sample: {
      accumulatedMatches: review.accumulatedMatches,
      windowSize: review.windowSize,
      accumulatedLabel: review.accumulatedLabel,
      sampleTier: review.sampleTier,
      styleNote: review.styleNote
    },
    stats: {
      avgPlacement: review.stats.avgPlacement,
      top4Rate: review.stats.top4Rate,
      avgLevel: review.stats.avgLevel,
      bestPlacement: review.stats.bestPlacement,
      worstPlacement: review.stats.worstPlacement,
      completeMatches: review.stats.completeMatches
    },
    compPreferences,
    opggPlayStyleComments,
    matches,
    dataBoundaryNote: review.dataBoundaryNote
  };
}

function collectEvidenceIds(evidence) {
  const ids = new Set(STAT_EVIDENCE_IDS);
  for (const comp of evidence.compPreferences ?? []) {
    ids.add(comp.evidenceId);
  }
  for (const match of evidence.matches ?? []) {
    ids.add(match.evidenceId);
  }
  for (const comment of evidence.opggPlayStyleComments ?? []) {
    ids.add(comment.evidenceId);
  }
  return ids;
}

function collectAnswerRefs(answer) {
  const refs = [];
  for (const reason of answer?.reasons ?? []) {
    refs.push(...(reason?.evidenceIds ?? []));
  }
  for (const alternative of answer?.alternatives ?? []) {
    refs.push(...(alternative?.evidenceIds ?? []));
  }
  if (answer?.currentRecommendation?.evidenceId) {
    refs.push(answer.currentRecommendation.evidenceId);
  }
  return refs;
}

function validateEvidenceRefs(answer, evidence) {
  const valid = collectEvidenceIds(evidence);
  const refs = collectAnswerRefs(answer);
  const missing = [...new Set(refs.filter((ref) => !valid.has(ref)))];

  const knownMatchIds = new Set(
    (evidence.matches ?? []).map((match) => match.matchId)
  );
  const badCitations = (answer?.citations ?? []).filter(
    (citation) => !knownMatchIds.has(citation) && !valid.has(citation)
  );

  return { missingRefs: missing, badCitations };
}

function validateAnswerShape(answer) {
  const missing = [];
  for (const field of [
    "schemaVersion",
    "status",
    "headline",
    "text",
    "currentRecommendation",
    "reasons",
    "alternatives",
    "citations",
    "warnings"
  ]) {
    const value = answer?.[field];
    const missingValue =
      value === undefined ||
      (field !== "currentRecommendation" && value === null);
    if (missingValue) {
      missing.push(field);
    }
  }
  if (!Array.isArray(answer?.reasons)) {
    missing.push("reasons[]");
  }
  if (!Array.isArray(answer?.alternatives)) {
    missing.push("alternatives[]");
  }
  if (!Array.isArray(answer?.citations)) {
    missing.push("citations[]");
  }
  if (!Array.isArray(answer?.warnings)) {
    missing.push("warnings[]");
  }
  return missing;
}

function extractAnswerText(answer) {
  const parts = [answer?.headline, answer?.text];
  for (const reason of answer?.reasons ?? []) {
    parts.push(reason?.text);
  }
  for (const alternative of answer?.alternatives ?? []) {
    parts.push(alternative?.text);
  }
  return parts.filter((part) => typeof part === "string").join("\n");
}

function detectBannedClaims(textOrAnswer) {
  const text =
    typeof textOrAnswer === "string"
      ? textOrAnswer
      : extractAnswerText(textOrAnswer);
  const hits = [];
  for (const { pattern, label } of BANNED_CLAIM_PATTERNS) {
    const flags = `${pattern.flags}u`.replace(/uu$/u, "u") + "g";
    const regex = new RegExp(pattern.source, flags);
    let match;
    while ((match = regex.exec(String(text ?? ""))) !== null) {
      const before = String(text ?? "").slice(
        Math.max(0, match.index - 12),
        match.index
      );
      if (/(?:不包含|不包括|不含|没有|未|无|禁止|无法|不能)/u.test(before)) {
        continue;
      }
      hits.push({ label, matched: match[0] });
    }
  }
  return hits;
}

function buildDeterministicTeaching(evidence) {
  const stats = evidence.stats ?? {};
  const warnings = [
    evidence.sample?.styleNote ?? "",
    evidence.dataBoundaryNote ?? ""
  ].filter(Boolean);

  const textParts = [
    `样本：${evidence.sample?.accumulatedLabel ?? "?"}（${evidence.sample?.sampleTier ?? "?"}）。`,
    `场均名次 ${stats.avgPlacement ?? "-"}，前四率 ${stats.top4Rate ?? "-"}，平均人口 ${stats.avgLevel ?? "-"}，完整对局 ${stats.completeMatches ?? 0} 场。`
  ];

  if ((evidence.compPreferences ?? []).length > 0) {
    const compLine = evidence.compPreferences
      .map((comp) => `${comp.compSignature}（${comp.count} 场）`)
      .join("；");
    textParts.push(`常玩阵容：${compLine}。`);
  }

  if ((evidence.opggPlayStyleComments ?? []).length > 0) {
    const styleLine = evidence.opggPlayStyleComments
      .slice(0, 3)
      .map((comment) => `${comment.name ?? "风格"}：${comment.description ?? ""}`)
      .join("；");
    textParts.push(`OP.GG 风格评论：${styleLine}。`);
  }

  const matchSummary = (evidence.matches ?? [])
    .slice(0, 10)
    .map((match) => {
      const conclusions = (match.conclusions ?? []).join("；");
      return `第${match.placement ?? "?"}名 Lv${match.level ?? "?"}（${match.matchId}）：${conclusions || "无规则结论"}`;
    })
    .join("\n");
  textParts.push(`逐场要点：\n${matchSummary}`);

  const reasons = [];
  if (stats.avgPlacement !== null) {
    reasons.push({
      dimension: "近期表现",
      evidenceIds: ["stat:avgPlacement", "stat:top4Rate"],
      text: `最近 ${evidence.sample?.accumulatedMatches ?? 0} 场场均名次 ${stats.avgPlacement}、前四率 ${stats.top4Rate ?? "-"}。`
    });
  }
  for (const comp of (evidence.compPreferences ?? []).slice(0, 3)) {
    reasons.push({
      dimension: "阵容偏好",
      evidenceIds: [comp.evidenceId, "stat:sample"],
      text: `${comp.compSignature} 出现 ${comp.count} 场（占比 ${Math.round((comp.share ?? 0) * 100)}%）。`
    });
  }

  return {
    schemaVersion: "coach_answer.v1",
    status: "ok",
    headline: `${evidence.player?.displayName ?? ""} 最近 ${evidence.sample?.accumulatedMatches ?? 0}/${evidence.sample?.windowSize ?? 10} 场规则复盘`,
    text: textParts.join("\n"),
    currentRecommendation: null,
    reasons,
    alternatives: [],
    citations: (evidence.matches ?? []).map((match) => match.matchId),
    warnings
  };
}

function buildValidationFeedback(validation) {
  const parts = [];
  if (validation.missingShape?.length) {
    parts.push(`缺失结构字段：${validation.missingShape.join("、")}`);
  }
  if (validation.missingRefs?.length) {
    parts.push(`引用了不存在的证据：${validation.missingRefs.join("、")}`);
  }
  if (validation.badCitations?.length) {
    parts.push(`引用不存在对局：${validation.badCitations.join("、")}`);
  }
  if (validation.blockedClaims?.length) {
    parts.push(
      `出现禁止的逐回合表述：${validation.blockedClaims
        .map((hit) => `「${hit.matched}」(${hit.label})`)
        .join("、")}`
    );
  }
  return parts.join("；") || "输出不符合要求";
}

function evaluateAnswer(answer, evidence) {
  const missingShape = validateAnswerShape(answer);
  const validation = {
    ...validateEvidenceRefs(answer, evidence),
    missingShape
  };
  const blockedClaims = detectBannedClaims(answer);
  const validated =
    missingShape.length === 0 &&
    validation.missingRefs.length === 0 &&
    validation.badCitations.length === 0 &&
    blockedClaims.length === 0;
  return { ...validation, blockedClaims, validated };
}

/**
 * Generate teaching commentary. provider may be null -> deterministic
 * fallback. strict=true replaces LLM output with the fallback when evidence
 * references are missing or banned claims are detected.
 */
async function generateTeaching({
  evidence,
  provider,
  question = "请点评这名选手最近的战绩并给出教学建议。",
  strict = true,
  maxRetries = 1
}) {
  if (!provider) {
    return {
      ...buildDeterministicTeaching(evidence),
      source: "deterministic_fallback",
      validated: true,
      reason: "llm_disabled"
    };
  }

  let answer;
  try {
    answer = await provider({ question, evidenceBundle: evidence });
  } catch (error) {
    return {
      ...buildDeterministicTeaching(evidence),
      source: "deterministic_fallback",
      validated: true,
      reason: "llm_error",
      llmError: String(error?.message ?? error)
    };
  }

  let validation = evaluateAnswer(answer, evidence);
  let retried = false;

  if (!validation.validated && maxRetries > 0) {
    const feedback = buildValidationFeedback(validation);
    try {
      const retryAnswer = await provider({
        question:
          `${question}\n\n【上轮输出未通过校验】${feedback}。` +
          `请删除或改写上述内容后重新输出，不要解释。`,
        evidenceBundle: evidence
      });
      const retryValidation = evaluateAnswer(retryAnswer, evidence);
      retried = true;
      if (retryValidation.validated) {
        answer = retryAnswer;
        validation = retryValidation;
      } else {
        answer = retryAnswer;
        validation = retryValidation;
      }
    } catch {
      // Keep the first answer and its validation; fallback below handles it.
    }
  }

  if (!validation.validated && strict) {
    return {
      ...buildDeterministicTeaching(evidence),
      source: "deterministic_fallback",
      validated: true,
      reason: "llm_validation_failed",
      validation: {
        ...validation,
        retried
      }
    };
  }

  return {
    ...answer,
    source: "llm",
    validated: validation.validated,
    retried,
    validation: { ...validation }
  };
}

export {
  TEACHING_SYSTEM_PROMPT,
  BANNED_CLAIM_PATTERNS,
  buildTeachingEvidence,
  mostPlayedUnitName,
  resolveChampionPlaceholders,
  collectEvidenceIds,
  validateEvidenceRefs,
  validateAnswerShape,
  detectBannedClaims,
  buildDeterministicTeaching,
  buildValidationFeedback,
  evaluateAnswer,
  generateTeaching
};
