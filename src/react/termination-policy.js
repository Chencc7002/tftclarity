const STATISTICAL_SIGNAL = /(?:平均名次|均名|前四率|登顶率|胜率|选择率|出场率|样本|场次|排名变化|top\s*4|win\s*rate|pick\s*rate|sample|games?|\d+(?:\.\d+)?\s*%)/iu;
const INSUFFICIENT_SIGNAL = /(?:数据不足|证据不足|没有可验证|无可验证|工具不可用|查询失败|结果为空|没有结果|无法可靠判断|暂时无法判断|当前样本门槛下没有|insufficient|unavailable|failed|no reliable|no verifiable)/iu;
const CURRENT_RANKING_SIGNAL = /(?:当前|现在|目前|最近|这版本|胜率|前四率|登顶率|平均名次|选择率|出场率|样本数|排名|最优|最好|最高|current|latest|best|highest|win\s*rate|top\s*4)/iu;
const ARTIFACT_RANKING_CLAIM = /(?:(?:排行榜|排名|数据|单装备).{0,16}(?:含|包含|包括|加入|带上|算上|纳入)?\s*(?:奥恩)?神器|(?:含|包含|包括|加入|带上|算上|纳入|主流|推荐|首选|最强|适合).{0,8}(?:奥恩)?神器|(?:奥恩)?神器.{0,8}(?:排行|排名|推荐|首选|主流|[：:]))/u;

import { hasTacticalPositionProse, scopedTacticalPositionErrors } from "./tactical-position-grounding.js";
import { officialItemEvidenceFailure, officialItemBatchEvidenceFailure } from "../agent/official-item-evidence.js";

function numericTokens(text) {
  return [...String(text ?? "").matchAll(/\d+(?:\.\d+)?%?/gu)].map((match) => match[0]);
}

function evidenceText(entries) {
  return entries.map((entry) => JSON.stringify(entry.value)).join("\n");
}

function artifactScopeGroundingErrors(answer, entries) {
  const positiveClaims = String(answer ?? "").split(/[。；;\n]/u).filter((clause) => (
    !/(?:不含|不包含|未包含|不包括|排除|没有|无|不足|未查|不可用|无法).{0,8}(?:奥恩)?神器|神器.{0,12}(?:不足|未返回|不可用|无法|没有)/u.test(clause)
  ));
  if (!positiveClaims.some((clause) => ARTIFACT_RANKING_CLAIM.test(clause))) return [];
  const equipmentEntries = entries.filter((entry) => (
    entry?.temporalStatus !== "historical"
    && (
      entry.toolName === "unit_builds"
      || entry.type === "unit_item_rankings"
      || entry.value?.type === "unit_item_rankings"
    )
  ));
  const hasArtifactScope = equipmentEntries.some((entry) => {
    const query = entry.value?.query ?? {};
    return (query.itemCategories ?? []).includes("artifact")
      && ["include_artifact", "include_special"].includes(query.itemPolicy)
      && (!Array.isArray(entry.value?.itemRankings)
        || entry.value.itemRankings.some((item) => item.category === "artifact"));
  });
  return hasArtifactScope
    ? []
    : ["answer claims an Artifact equipment ranking but cited evidence does not include artifact scope"];
}

function contradictsCompositionBreakpointEvidence(answer, entries) {
  const evaluations = entries.filter((entry) => (
    ["composition_change_evaluation", "composition_replacement_evaluation"].includes(
      entry.toolName
    )
    && entry.value?.status === "evaluated"
  ));
  const hasBreakpointChange = evaluations.some((entry) => (
    (entry.value?.traitDeltas ?? []).some((delta) => (
      ["activated", "deactivated", "advanced", "regressed"].includes(delta.breakpointChange)
    ))
  ));
  if (!hasBreakpointChange) return false;
  return /(?:(?:均|都|全部|所有).{0,12}(?:无|没有).{0,6}档位变化|没有任何档位变化|no (?:trait )?breakpoint changes)/iu
    .test(String(answer ?? ""));
}

function unsupportedItemPriorityClaim(answer, entries) {
  const contentionObserved = entries.some((entry) => (
    entry.toolName === "unit_builds_batch"
    && entry.value?.itemContentionPlan?.priorityConclusion === "not_evaluated"
  ));
  if (!contentionObserved) return false;
  const text = String(answer ?? "");
  const priorityClaim = /(?:(?:必须|应该|应当|优先|一定要).{0,12}(?:给|分配给)|(?:best|must|should|always).{0,16}(?:holder|give|assign|priority))/iu.test(text);
  const limitation = /(?:证据不足|无法判断|不能判断|不判断|未评估|没有优先级证据|仅.*推测|insufficient|cannot determine|not evaluated)/iu.test(text);
  return priorityClaim && !limitation;
}

function activeUnitBuildEntries(entries) {
  const buildEntries = entries.filter((entry) => entry.toolName === "unit_builds_batch");
  const constrainedEntries = buildEntries.filter((entry) => {
    const constraints = entry.value?.query?.constraints ?? entry.value?.constraints ?? {};
    return constraints.lockedItems?.length || constraints.excludedItems?.length;
  });
  return constrainedEntries.length ? constrainedEntries : buildEntries;
}

function overstatesItemContentionAbsence(answer, entries) {
  const absenceObserved = activeUnitBuildEntries(entries).some((entry) => (
    ["no_contention", "insufficient_build_data"].includes(
      entry.value?.itemContentionPlan?.status
    )
  ));
  if (!absenceObserved) return false;
  return /(?:(?:不存在|没有(?!检测到|发现)|不会).{0,32}(?:装备竞争|装备冲突|共享装备|竞争情况)|(?:no|does not|do not).{0,24}(?:item contention|equipment conflict|compete))/iu
    .test(String(answer ?? ""));
}

function omitsPartialContentionCoverage(answer, entries) {
  const partialCoverage = activeUnitBuildEntries(entries).some((entry) => (
    entry.value?.itemContentionPlan?.coverageStatus === "partial"
  ));
  if (!partialCoverage) return false;
  const text = String(answer ?? "");
  const unavailableDisclosure = /(?:不可用|未返回|未覆盖|查询失败|请求失败|超时|缺失|无数据|仅.{0,8}(?:成功|可用)|成功单位数|coverage.{0,8}partial|partial coverage|unavailable|timed?\s*out)/iu.test(text);
  const scopeLimitation = /(?:(?:无法判断|无法确认|不能判断)(?:整个|全).{0,8}阵容|无法建立.{0,12}阵容级|整个阵容.{0,12}(?:可能|无法|不能)|可能(?:还|仍)存在|尚未覆盖|cannot determine.{0,20}(?:whole|entire)|may be additional)/iu.test(text);
  return !unavailableDisclosure || !scopeLimitation;
}

function tacticalPositionGroundingErrors(answer, entries) {
  const tacticalEntries = entries.filter((entry) => (
    entry.toolName === "composition_tactical_details"
    && Array.isArray(entry.value?.formation?.units)
  ));
  if (!tacticalEntries.length) return [];
  const text = String(answer ?? "");
  const errors = [];
  if (/\bcell[_-]?\d+\b/iu.test(text)) {
    errors.push("positioning answer must not expose raw provider cell identifiers");
  }
  const rowNumber = (value) => ({
    "一": 1, "二": 2, "三": 3, "四": 4,
    "1": 1, "2": 2, "3": 3, "4": 4
  }[String(value)] ?? null);
  const expectedZone = (row) => row === 1 ? "前排" : row === 4 ? "后排" : "中排";
  const segments = text.split(/[\n。；，]/u).map((segment) => segment.trim()).filter(Boolean);
  for (const entry of tacticalEntries) {
    for (const unit of entry.value.formation.units) {
      const name = String(unit?.name ?? "").trim();
      const expectedRow = Number(unit?.boardPosition?.rowFromFront);
      if (!name || !Number.isInteger(expectedRow)) continue;
      for (const segment of segments.filter((candidate) => candidate.includes(name))) {
        const explicitRows = [...segment.matchAll(/(?:第\s*([一二三四1234])\s*排|([一二三四])排)/gu)]
          .map((match) => rowNumber(match[1] ?? match[2]))
          .filter(Number.isInteger);
        if (explicitRows.length) {
          for (const claimedRow of explicitRows) {
            if (claimedRow !== expectedRow) {
              errors.push(`positioning answer contradicts formation for ${name}: expected row ${expectedRow}, claimed row ${claimedRow}`);
            }
          }
          continue;
        }
        const headerZone = segment.match(/^\s*(?:[-*#]+\s*)?\*{0,2}(前排|中排|后排)[^：:]{0,16}\*{0,2}\s*[：:]/u)?.[1];
        const afterName = segment.slice(segment.indexOf(name) + name.length);
        const directZone = afterName.match(/.{0,8}(?:放在|站在|位于|放到|在)\s*(前排|中排|后排)/u)?.[1];
        const claimedZone = headerZone ?? directZone ?? null;
        if (claimedZone && claimedZone !== expectedZone(expectedRow)) {
          errors.push(`positioning answer contradicts formation for ${name}: expected ${expectedZone(expectedRow)}, claimed ${claimedZone}`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

function numericEvidenceValues(value, output = []) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) numericEvidenceValues(entry, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) numericEvidenceValues(entry, output);
  }
  return output;
}

function roundedNumericClaimIsSupported(token, entries) {
  const percent = token.endsWith("%");
  const raw = percent ? token.slice(0, -1) : token;
  if (!percent && !raw.includes(".")) return false;
  const claimed = Number(raw);
  if (!Number.isFinite(claimed)) return false;
  const decimals = raw.split(".")[1]?.length ?? 0;
  const scale = percent ? 100 : 1;
  const target = claimed / scale;
  const tolerance = (0.5 * (10 ** -decimals) / scale) + Number.EPSILON;
  const values = entries.flatMap((entry) => numericEvidenceValues(entry.value));
  return values.some((value) => (
    (!percent || (value >= 0 && value <= 1))
    && Math.abs(value - target) <= tolerance
  ));
}

function isCompositionTrendEvidence(entry) {
  return entry?.toolName === "comps_trends"
    || entry?.type === "composition_trends"
    || entry?.value?.type === "comp_trends";
}

function compositionTrendSections(entries) {
  return entries
    .filter((entry) => entry?.temporalStatus !== "historical" && isCompositionTrendEvidence(entry))
    .map((entry) => {
      const value = entry.value ?? {};
      return {
        requestedDirection: value.requestedDirection ?? value.query?.trendDirection ?? null,
        rising: Array.isArray(value.rising) ? value.rising : [],
        falling: Array.isArray(value.falling) ? value.falling : [],
        popularity: Array.isArray(value.rankings?.popularity) ? value.rankings.popularity : []
      };
    });
}

function answerMentionsTrendRow(answer, rows) {
  const text = String(answer ?? "");
  const names = rows
    .map((row) => String(row?.name ?? row?.compositionRef?.name ?? "").trim())
    .filter(Boolean);
  return names.length === 0 || names.some((name) => text.includes(name));
}

function compositionTrendCoverageErrors(action, entries) {
  const errors = [];
  for (const section of compositionTrendSections(entries)) {
    const scopedRows = section.requestedDirection === "rising"
      ? section.rising
      : section.requestedDirection === "falling"
        ? section.falling
        : [...section.rising, ...section.falling, ...section.popularity];
    if (!scopedRows.length) continue;
    if (action.reasonCode === "insufficient_evidence") {
      errors.push("insufficient_evidence cannot discard available composition trend sections");
      continue;
    }
    if (action.reasonCode !== "sufficient_evidence") continue;
    if (section.requestedDirection === "rising") {
      if (!answerMentionsTrendRow(action.answer, section.rising)) {
        errors.push("composition rising-trend answer must include an available result");
      }
      continue;
    }
    if (section.requestedDirection === "falling") {
      if (!answerMentionsTrendRow(action.answer, section.falling)) {
        errors.push("composition falling-trend answer must include an available result");
      }
      continue;
    }
    if (section.rising.length && !answerMentionsTrendRow(action.answer, section.rising)) {
      errors.push("composition trend overview must include an available rising result");
    }
    if (section.falling.length && !answerMentionsTrendRow(action.answer, section.falling)) {
      errors.push("composition trend overview must include an available falling result");
    }
    if (section.popularity.length && !answerMentionsTrendRow(action.answer, section.popularity)) {
      errors.push("composition trend overview must include an available popularity result");
    }
  }
  return errors;
}

function compositionTrendImprovementValues(value, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) compositionTrendImprovementValues(entry, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    if (
      ["avgPlacementChange", "placementImprovement"].includes(key)
      && typeof entry === "number"
      && Number.isFinite(entry)
    ) {
      output.push(Math.abs(entry));
      continue;
    }
    compositionTrendImprovementValues(entry, output);
  }
  return output;
}

function roundedCompositionTrendMagnitudeIsSupported(token, entries) {
  if (token.endsWith("%")) return false;
  const raw = token;
  if (!raw.includes(".")) return false;
  const claimed = Number(raw);
  if (!Number.isFinite(claimed) || claimed < 0) return false;
  const decimals = raw.split(".")[1]?.length ?? 0;
  const tolerance = (0.5 * (10 ** -decimals)) + Number.EPSILON;
  const values = entries
    .filter(isCompositionTrendEvidence)
    .flatMap((entry) => compositionTrendImprovementValues(entry.value));
  return values.some((value) => Math.abs(value - claimed) <= tolerance);
}

function numericClaimIsSupported(token, entries) {
  return roundedNumericClaimIsSupported(token, entries)
    || roundedCompositionTrendMagnitudeIsSupported(token, entries);
}

function exactFields(value, allowed, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label}.${field} is not allowed`);
  }
  return true;
}

function narrativeText(narrative) {
  return [
    narrative?.summary?.text,
    ...(narrative?.options ?? []).flatMap((option) => [
      option?.explanation,
      option?.statisticalBasis?.text,
      option?.mechanismDifference?.text,
      ...(option?.tradeoffs ?? []).map((entry) => entry?.text ?? entry),
      ...(option?.risks ?? []).map((entry) => entry?.text ?? entry),
      ...(option?.suitableWhen ?? []).map((entry) => entry?.text ?? entry)
    ])
  ].filter(Boolean).join("\n");
}

export function validateGroundedBuildNarrative(narrative, ledger, finishEvidenceIds = []) {
  if (narrative == null) return { valid: true, errors: [], value: null };
  const errors = [];
  if (!exactFields(narrative, new Set(["schemaVersion", "summary", "options"]), "narrative", errors)) {
    return { valid: false, errors, value: null };
  }
  if (narrative.schemaVersion !== "grounded-build-narrative.v1") {
    errors.push("narrative.schemaVersion must be grounded-build-narrative.v1");
  }
  if (narrative.summary != null) {
    exactFields(narrative.summary, new Set(["text", "evidenceIds"]), "narrative.summary", errors);
    if (typeof narrative.summary?.text !== "string" || !narrative.summary.text.trim()) {
      errors.push("narrative.summary.text is required");
    }
  }
  if (!Array.isArray(narrative.options) || narrative.options.length > 3) {
    errors.push("narrative.options must contain at most three entries");
  }
  const citedIds = new Set(finishEvidenceIds.map(String));
  const citedEntries = ledger.resolve([...citedIds]);
  const optionRanks = new Map(citedEntries.flatMap((entry) => (
    (entry.value?.results ?? []).flatMap((result) => (
      (result.buildOptions ?? []).map((option) => [String(option.optionId), Number(option.rank)])
    ))
  )));
  const buildPlans = new Map(citedEntries.flatMap((entry) => (
    (entry.value?.results ?? []).flatMap((result) => (
      (result.mechanismQueryPlan?.comparisons ?? []).map((comparison) => [
        String(comparison.optionId),
        new Set((comparison.selectedPairs ?? []).flatMap((pair) => (
          [pair.removedApiName, pair.addedApiName].filter(Boolean).map(String)
        )))
      ])
    ))
  )));
  const validateEvidenceIds = (ids, label) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
      errors.push(`${label} must contain evidence ids`);
      return;
    }
    for (const id of ids) {
      if (!citedIds.has(id) || !ledger.has(id)) errors.push(`${label} references unknown evidenceId`);
    }
  };
  const validateEvidenceRefs = (refs, label) => {
    if (!Array.isArray(refs) || refs.length === 0) {
      errors.push(`${label} must contain item evidence references`);
      return [];
    }
    const items = [];
    refs.forEach((ref, index) => {
      const refLabel = `${label}[${index}]`;
      if (!exactFields(ref, new Set(["evidenceId", "claimId"]), refLabel, errors)) return;
      const evidenceId = String(ref?.evidenceId ?? "");
      const claimId = String(ref?.claimId ?? "");
      if (!citedIds.has(evidenceId) || !ledger.has(evidenceId)) {
        errors.push(`${refLabel} references unknown evidenceId`);
        return;
      }
      const entry = ledger.resolve([evidenceId])[0];
      const item = (entry?.value?.items ?? []).find((candidate) => candidate.claimId === claimId);
      if (
        entry?.toolName !== "item_details_batch"
        || entry.value?.mechanismStatus !== "available"
        || item?.status !== "found"
        || !item?.facts?.effect
      ) {
        errors.push(`${refLabel} does not reference available current-season item mechanics`);
        return;
      }
      items.push(item);
    });
    return items;
  };
  if (narrative.summary) validateEvidenceIds(narrative.summary.evidenceIds, "narrative.summary.evidenceIds");
  for (const [index, option] of (narrative.options ?? []).entries()) {
    const label = `narrative.options[${index}]`;
    if (!exactFields(option, new Set([
      "optionId", "explanation", "tradeoffs", "risks", "suitableWhen", "evidenceIds",
      "statisticalBasis", "mechanismDifference"
    ]), label, errors)) continue;
    if (typeof option.optionId !== "string" || !optionRanks.has(option.optionId)) {
      errors.push(`${label}.optionId is not present in cited build evidence`);
    }
    const legacyExplanation = typeof option.explanation === "string" && option.explanation.trim();
    const statisticalText = option.statisticalBasis?.text;
    if (!legacyExplanation && !(typeof statisticalText === "string" && statisticalText.trim())) {
      errors.push(`${label} requires an explanation or statisticalBasis`);
    }
    if (option.evidenceIds !== undefined) validateEvidenceIds(option.evidenceIds, `${label}.evidenceIds`);
    if (option.statisticalBasis != null) {
      exactFields(option.statisticalBasis, new Set(["text", "evidenceIds"]), `${label}.statisticalBasis`, errors);
      if (typeof option.statisticalBasis?.text !== "string" || !option.statisticalBasis.text.trim()) {
        errors.push(`${label}.statisticalBasis.text is required`);
      }
      validateEvidenceIds(option.statisticalBasis?.evidenceIds, `${label}.statisticalBasis.evidenceIds`);
    }
    if (option.mechanismDifference != null) {
      exactFields(
        option.mechanismDifference,
        new Set(["text", "comparedItemApiNames", "evidenceRefs"]),
        `${label}.mechanismDifference`,
        errors
      );
      const compared = option.mechanismDifference?.comparedItemApiNames;
      if (!Array.isArray(compared) || compared.length < 1 || compared.some((value) => typeof value !== "string")) {
        errors.push(`${label}.mechanismDifference.comparedItemApiNames is required`);
      }
      const allowedItems = buildPlans.get(String(option.optionId)) ?? new Set();
      if ((compared ?? []).some((apiName) => !allowedItems.has(String(apiName)))) {
        errors.push(`${label}.mechanismDifference contains an item outside the deterministic difference plan`);
      }
      const citedItems = validateEvidenceRefs(
        option.mechanismDifference?.evidenceRefs,
        `${label}.mechanismDifference.evidenceRefs`
      );
      if ((compared ?? []).some((apiName) => !citedItems.some((item) => item.apiName === apiName))) {
        errors.push(`${label}.mechanismDifference lacks item-level evidence for a compared item`);
      }
    }
    if (!Array.isArray(option.suitableWhen ?? [])) errors.push(`${label}.suitableWhen must be an array`);
    for (const [conditionIndex, condition] of (option.suitableWhen ?? []).entries()) {
      if (typeof condition === "string") continue;
      const conditionLabel = `${label}.suitableWhen[${conditionIndex}]`;
      exactFields(condition, new Set(["text", "inferenceType", "evidenceRefs"]), conditionLabel, errors);
      if (condition?.inferenceType !== "mechanism_based_advice") {
        errors.push(`${conditionLabel}.inferenceType must be mechanism_based_advice`);
      }
      validateEvidenceRefs(condition?.evidenceRefs, `${conditionLabel}.evidenceRefs`);
    }
    for (const field of ["tradeoffs", "risks"]) {
      if (!Array.isArray(option[field] ?? [])) errors.push(`${label}.${field} must be an array`);
    }
    if (
      Number(optionRanks.get(option.optionId)) > 1
      && /(?:排名第一|统计第一|当前首选|ranked first|best build)/iu.test(
        [option.explanation, option.statisticalBasis?.text].filter(Boolean).join(" ")
      )
    ) {
      errors.push(`${label} contradicts the deterministic build rank`);
    }
  }
  const source = evidenceText(citedEntries);
  for (const token of numericTokens(narrativeText(narrative))) {
    const normalized = token.endsWith("%") ? token.slice(0, -1) : token;
    if (
      !source.includes(token)
      && !source.includes(normalized)
      && !numericClaimIsSupported(token, citedEntries)
    ) {
      errors.push(`narrative statistic is not present in cited evidence: ${token}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length ? null : structuredClone(narrative)
  };
}

export function containsStatisticalClaim(answer) {
  return STATISTICAL_SIGNAL.test(String(answer ?? ""));
}

function scriptCounts(text) {
  const value = String(text ?? "");
  return {
    latin: (value.match(/[A-Za-z]/gu) ?? []).length,
    han: (value.match(/\p{Script=Han}/gu) ?? []).length
  };
}

export function preferredAnswerLanguage(input) {
  const { latin, han } = scriptCounts(input);
  if (latin >= 12 && latin > han * 2) return "en";
  if (han >= 4 && han >= latin) return "zh";
  return null;
}

function answerLanguageErrors(answer, input) {
  if (preferredAnswerLanguage(input) !== "en") return [];
  const { latin, han } = scriptCounts(answer);
  if (latin >= 20 && latin >= han * 2) return [];
  return ["English unit-play input requires an English answer; preserve the cited claims and rewrite only the answer language before finishing"];
}

export function validateFinishAction(action, ledger, options = {}) {
  const errors = [];
  const ids = [...new Set(action.evidenceIds ?? [])];
  const entries = ledger.resolve(ids);
  const currentLedgerEntries = typeof ledger.snapshot === "function"
    ? (ledger.snapshot()?.entries ?? []).filter((entry) => entry?.temporalStatus !== "historical")
    : entries;
  if (options.unitPlayInputLanguageGuard === true) {
    errors.push(...answerLanguageErrors(action.answer, options.currentTurnInput));
  }
  if (entries.length !== ids.length) errors.push("finish references unknown evidenceIds");
  if (options.officialItemEvidenceV1 === true) {
    for (const entry of entries.filter(item => item.toolName === "item_details")) {
      const reason = officialItemEvidenceFailure(entry, { now: options.now ?? Date.now(), seasonContextId: options.seasonContextId });
      if (reason) errors.push(`current official item evidence rejected: ${reason}`);
    }
    for (const entry of entries.filter(item => item.toolName === "item_details_batch")) {
      const reason = officialItemBatchEvidenceFailure(entry, { now: options.now ?? Date.now(), seasonContextId: options.seasonContextId });
      if (reason) errors.push(`current official item batch evidence rejected: ${reason}`);
    }
    if (action.reasonCode === "sufficient_evidence") {
      const officialItems = currentLedgerEntries.flatMap(entry => entry.toolName === "item_details"
        ? [{ evidenceId: entry.evidenceId, value: entry.value }]
        : entry.toolName === "item_details_batch"
          ? (entry.value?.items ?? []).map(value => ({ evidenceId: entry.evidenceId, value }))
          : []);
      for (const item of officialItems) {
        const aliases = [item.value?.displayName, ...currentLedgerEntries.filter(entry => entry.toolName === "unit_builds")
          .flatMap(entry => entry.value?.cards ?? []).flatMap(card => card.items ?? [])
          .filter(row => row.apiName === item.value?.apiName).flatMap(row => [row.name, row.displayName, row.shortName])]
          .filter(name => typeof name === "string" && name.length >= 2);
        if (aliases.some(name => String(action.answer ?? "").includes(name)) && !ids.includes(item.evidenceId)) {
          errors.push(`mentioned retrieved official item requires its evidence citation: ${item.value.apiName}`);
        }
      }
    }
  }

  if (action.reasonCode === "direct_answer") {
    if (ids.length) errors.push("direct_answer must not cite tool evidence");
    if (containsStatisticalClaim(action.answer)) {
      errors.push("direct_answer contains an unsupported statistical claim");
    }
  } else if (action.reasonCode === "sufficient_evidence") {
    if (ids.length === 0) errors.push("sufficient_evidence requires evidenceIds");
    const sourceText = evidenceText(entries);
    for (const token of numericTokens(action.answer)) {
      const normalized = token.endsWith("%") ? token.slice(0, -1) : token;
      if (
        !sourceText.includes(token)
        && !sourceText.includes(normalized)
        && !numericClaimIsSupported(token, entries)
      ) {
        errors.push(`answer statistic is not present in cited evidence: ${token}`);
      }
    }
    if (
      entries.length > 0
      && entries.every((entry) => entry.type === "semantic_candidates")
      && CURRENT_RANKING_SIGNAL.test(action.answer)
    ) {
      errors.push("semantic knowledge evidence cannot support a current statistical or best-ranking claim");
    }
    if (
      entries.length > 0
      && entries.every((entry) => (
        entry.temporalStatus === "historical"
        && entry.metadata?.trustedServerRefresh !== true
      ))
      && CURRENT_RANKING_SIGNAL.test(action.answer)
    ) {
      errors.push("historical quick-tool evidence cannot support a current statistical or best-ranking claim");
    }
    if (contradictsCompositionBreakpointEvidence(action.answer, entries)) {
      errors.push("answer contradicts deterministic composition breakpoint changes");
    }
    errors.push(...artifactScopeGroundingErrors(action.answer, entries));
    const contentionEntries = activeUnitBuildEntries(entries).filter((entry) => (
      entry.value?.itemContentionPlan?.status === "available"
      && !(
        entry.value?.query?.constraints?.lockedItems?.length
        || entry.value?.query?.constraints?.excludedItems?.length
      )
    ));
    if (
      contentionEntries.length
      && !entries.some((entry) => entry.toolName === "item_details_batch")
    ) {
      errors.push("available item contention requires cited current item_details_batch evidence");
    }
    if (unsupportedItemPriorityClaim(action.answer, entries)) {
      errors.push("item contention evidence does not support an equipment priority claim");
    }
    if (overstatesItemContentionAbsence(action.answer, entries)) {
      errors.push("item contention answer overstates sampled non-detection as absolute absence");
    }
    if (omitsPartialContentionCoverage(action.answer, entries)) {
      errors.push("partial item contention coverage requires failed-unit and whole-composition limitations");
    }
    if (options.compositionCardsOwnPositioning === true && hasTacticalPositionProse(action.answer)) {
      errors.push("positioning prose is reserved for the cited composition cards");
    }
    errors.push(...(options.compositionCardScope === true
      ? scopedTacticalPositionErrors(action.answer, entries)
      : tacticalPositionGroundingErrors(action.answer, entries)));
    errors.push(...compositionTrendCoverageErrors(action, entries));
  } else if (action.reasonCode === "insufficient_evidence") {
    if (!INSUFFICIENT_SIGNAL.test(action.answer)) {
      errors.push("insufficient_evidence answer must explicitly state the limitation");
    }
    if (overstatesItemContentionAbsence(action.answer, entries)) {
      errors.push("item contention answer overstates sampled non-detection as absolute absence");
    }
    if (omitsPartialContentionCoverage(action.answer, entries)) {
      errors.push("partial item contention coverage requires failed-unit and whole-composition limitations");
    }
    errors.push(...compositionTrendCoverageErrors(action, currentLedgerEntries));
  }

  return {
    valid: errors.length === 0,
    errors,
    evidence: entries
  };
}
