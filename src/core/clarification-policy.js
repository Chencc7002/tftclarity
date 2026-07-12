import { createCatalog } from "../data/static-data.js";

function hasEntityMatch(parsed, entityType) {
  return (parsed.parser?.entityMatches ?? []).some((match) => match.entityType === entityType);
}

function itemDisplayNames(apiNames, catalog) {
  return apiNames
    .map((apiName) => {
      const item = catalog.itemByApiName.get(apiName);
      return item?.shortName ?? item?.zhName ?? apiName;
    })
    .filter(Boolean);
}

function buildClarification(reason, question, options = {}) {
  return {
    needsClarification: true,
    reason,
    question,
    blocking: options.blocking ?? true,
    suggestions: options.suggestions ?? [],
    entityCandidates: options.entityCandidates ?? [],
    canAutoFix: false
  };
}

function candidateLabels(candidates) {
  return candidates
    .map((candidate) => candidate.label ?? candidate.matchedAlias ?? candidate.apiName)
    .filter(Boolean);
}

function explicitUnitCandidates(parsed, catalog) {
  const candidates = new Map();
  for (const match of parsed.parser?.entityMatches ?? []) {
    if (match.entityType !== "unit" || !match.apiName || candidates.has(match.apiName)) continue;
    const unit = catalog.unitByApiName.get(match.apiName);
    candidates.set(match.apiName, {
      entityType: "unit",
      apiName: match.apiName,
      label: unit?.zhName ?? unit?.displayName ?? match.apiName,
      matchedAlias: match.alias,
      inputFragment: match.alias,
      confidence: match.confidence ?? 1,
      matchType: "exact_multiple_units",
      source: "deterministic_entity_resolver"
    });
  }
  return [...candidates.values()];
}

function sortLabel(value) {
  if (value === "win_first") return "吃鸡优先";
  if (value === "robust_first") return "稳健高样本";
  return "前四优先";
}

function defaultContextCandidateLabel(candidate = {}) {
  return candidate.compName ?? (candidate.clusterId ? `cluster ${candidate.clusterId}` : "主流阵容");
}

function defaultContextClarification(query, catalog) {
  const context = query.defaultContext;
  const ambiguity = context?.ambiguity;
  if (!ambiguity?.significant) return null;

  const significantIds = new Set(ambiguity.significantAlternativeClusterIds ?? []);
  const candidates = [
    context,
    ...(context.candidates ?? []).filter((candidate) => significantIds.has(candidate.clusterId))
  ].filter((candidate, index, list) => (
    candidate?.clusterId
    && list.findIndex((entry) => entry?.clusterId === candidate.clusterId) === index
  ));
  if (candidates.length < 2) return null;

  const labels = candidates.map(defaultContextCandidateLabel);
  const traitSets = candidates.map((candidate) => new Set(candidate.traits ?? candidate.traitFilters ?? []));
  const unit = catalog.unitByApiName.get(query.unit);
  const unitName = unit?.zhName ?? unit?.displayName ?? query.unit;
  const suggestions = candidates.map((candidate, index) => {
    const traits = candidate.traits ?? candidate.traitFilters ?? [];
    const distinctiveTrait = traits.find((trait) => (
      traitSets.some((other, otherIndex) => otherIndex !== index && !other.has(trait))
    ));
    const trait = catalog.traitByApiName.get(distinctiveTrait);
    const traitName = trait?.zhName ?? trait?.displayName ?? distinctiveTrait;
    return `${unitName} ${traitName ?? defaultContextCandidateLabel(candidate)} 装备`;
  });

  return buildClarification(
    "ambiguous_default_context",
    `默认阵容有接近但羁绊差异明显的候选：${labels.join(" / ")}。你这局更接近哪一个？`,
    {
      suggestions: [...new Set(suggestions)]
    }
  );
}

export function evaluateClarification(parsed, query, validation, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const errors = validation?.errors ?? [];
  const ownedItems = query.ownedItems ?? [];
  const structuredParser = parsed.parser?.structuredParser;
  const entityCandidates = options.entityCandidates ?? [];
  const unitCandidates = entityCandidates.filter((candidate) => candidate.entityType === "unit");
  const entityAmbiguity = parsed.parser?.entityAmbiguities?.[0];
  const matchedUnits = explicitUnitCandidates(parsed, catalog);
  const sortConflict = (parsed.parser?.constraintConflicts ?? [])
    .find((conflict) => conflict.type === "sort" && conflict.values?.length > 1);

  if (matchedUnits.length > 1) {
    const labels = candidateLabels(matchedUnits);
    return buildClarification(
      "multiple_units",
      `一次只能查询一个英雄。你想查 ${labels.join(" / ")} 中的哪一个？`,
      {
        suggestions: labels,
        entityCandidates: matchedUnits
      }
    );
  }

  if (entityAmbiguity?.candidates?.length > 1) {
    const labels = candidateLabels(entityAmbiguity.candidates);
    return buildClarification(
      "ambiguous_entity",
      `“${entityAmbiguity.inputFragment}”可能指 ${labels.join(" / ")}，你想查哪一个？`,
      {
        suggestions: labels,
        entityCandidates: entityAmbiguity.candidates
      }
    );
  }

  if (sortConflict) {
    const labels = sortConflict.values.map(sortLabel);
    return buildClarification(
      "conflicting_sort",
      `同时识别到 ${labels.join(" / ")}，请选择一种排序方式。`,
      {
        suggestions: labels
      }
    );
  }

  if (structuredParser?.valid && structuredParser.needsClarification) {
    return buildClarification(
      "structured_parser_clarification",
      structuredParser.clarificationQuestion,
      {
        suggestions: structuredParser.suggestions ?? []
      }
    );
  }

  if (!query.unit) {
    if (query.intent === "unit_item_rankings") {
      return buildClarification(
        "missing_unit_for_item_rankings",
        "想看哪个英雄的单装备表现？装备强度会随英雄和阵容变化。",
        {
          suggestions: catalog.units.slice(0, 5).map((unit) => `${unit.zhName ?? unit.apiName}哪个单件装备表现最好？`),
          entityCandidates: unitCandidates
        }
      );
    }
    if (ownedItems.length > 0 || hasEntityMatch(parsed, "item")) {
      const names = itemDisplayNames(ownedItems, catalog);
      return buildClarification(
        "missing_unit_with_item",
        names.length
          ? `你说的是 ${names.join(" + ")}，要查哪个英雄？`
          : "识别到了装备，但还不知道要查哪个英雄。",
        {
          suggestions: candidateLabels(unitCandidates).length ? candidateLabels(unitCandidates) : [
            "霞有羊刀怎么带？",
            "2星霞带哪三件装备？"
          ],
          entityCandidates: unitCandidates
        }
      );
    }

    return buildClarification(
      "missing_unit",
      "要查哪个英雄？例如：霞带哪三件装备最好？",
      {
        suggestions: candidateLabels(unitCandidates).length
          ? candidateLabels(unitCandidates)
          : catalog.units.slice(0, 5).map((unit) => unit.zhName ?? unit.apiName),
        entityCandidates: unitCandidates
      }
    );
  }

  const unresolvedHint = (parsed.parser?.unresolvedEntityHints ?? [])[0];
  if (unresolvedHint) {
    const candidates = entityCandidates.filter((candidate) => candidate.entityType === unresolvedHint.entityType);
    const labels = candidateLabels(candidates);
    const entityLabel = unresolvedHint.entityType === "trait" ? "羁绊" : "装备";
    return buildClarification(
      unresolvedHint.entityType === "trait" ? "unresolved_trait" : "unresolved_item",
      labels.length
        ? `“${unresolvedHint.inputFragment}”可能是${entityLabel} ${labels.join(" / ")}，请确认后再查询。`
        : `没有识别到“${unresolvedHint.inputFragment}”对应的当前版本${entityLabel}，请确认名称。`,
      {
        suggestions: candidates.length
          ? candidates.map((candidate) => candidate.queryText ?? candidate.label).filter(Boolean)
          : [`补充当前版本${entityLabel}名称`],
        entityCandidates: candidates
      }
    );
  }

  const comparison = parsed.parser?.comparison;
  if (comparison?.requested && comparison.itemApiNames?.length < 2) {
    const [name] = itemDisplayNames(comparison.itemApiNames ?? [], catalog);
    return buildClarification(
      "missing_comparison_option",
      name
        ? `已识别到 ${name}，但还缺另一个要比较的装备。请补充第二个装备名。`
        : "还没有识别到两个可比较的装备，请补充明确的装备名。",
      {
        suggestions: [
          name ? `${name} 和 无尽 哪个好？` : "羊刀和无尽哪个好？",
          "补充另一个装备名"
        ]
      }
    );
  }

  const contextClarification = defaultContextClarification(query, catalog);
  if (contextClarification) return contextClarification;

  if (errors.some((error) => error.includes("装备数量不合法"))) {
    return buildClarification(
      "invalid_item_count",
      "装备数量需要在 0 到 3 件之间。要查三件套还是已持有装备后的补齐？",
      {
        suggestions: [
          "三件套",
          "已有羊刀，剩下两件"
        ]
      }
    );
  }

  if (errors.length > 0) {
    return buildClarification(
      "validation_failed",
      `这个查询还不能执行：${errors.join("；")}`,
      {
        suggestions: [
          "换一个当前版本英雄或装备",
          "补充英雄、星级、装备条件"
        ]
      }
    );
  }

  return {
    needsClarification: false,
    reason: null,
    question: null,
    blocking: false,
    suggestions: [],
    entityCandidates: [],
    canAutoFix: true
  };
}
