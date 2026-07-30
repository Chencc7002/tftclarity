const COPY = Object.freeze({
  "zh-CN": Object.freeze({
    eyebrow: "问题理解",
    title: "我是这样理解你的问题的",
    what: "你想做什么",
    conditions: "我识别到的条件",
    queries: "我准备查询什么",
    uncertainties: "哪些地方存在不确定性",
    currentTask: "当前任务",
    turnRelation: "本轮关系",
    reference: "引用对象",
    changes: "本轮变化",
    preserved: "其余上一轮条件继续保留",
    target: "目标对象",
    candidates: "候选对象",
    concepts: "涉及概念",
    noConditions: "没有识别到额外限制",
    noQueries: "当前没有需要执行的外部查询",
    noUncertainty: "未发现会影响当前查询的明确不确定项",
    mode: "回答模式",
    authority: "权威来源",
    previousTask: "上一轮的当前任务",
    previousResult: "上一轮结果",
    sourceTurn: "第 {value} 轮",
    relativeCompetition: "“低竞争”按相对较低出场率理解，不代表完全无人选择",
    fallback: "结构化理解服务发生降级，本轮摘要可能不完整（{reason}）",
    processing: "处理中",
    processed: "已处理",
    pendingUnderstanding: "我正在识别你的目标、限制条件和上下文引用。",
    understoodPrefix: "我理解到",
    conditionsPrefix: "我识别到的条件是",
    changesPrefix: "这一轮会",
    queryPrefix: "接下来我会",
    authorityPrefix: "数据口径",
    retrievalStarted: "理解与查询计划已经确认，正在检索数据和证据。",
    retrievalCompleted: "数据与证据已经检索完成，正在整理结果。",
    completedMessage: "查询与整理已经完成。",
    uncertaintyPrefix: "当前需要说明的不确定项是",
    unknownValue: "未指定",
    yes: "是",
    no: "否"
  }),
  "en-US": Object.freeze({
    eyebrow: "Question understanding",
    title: "Here is how I understood your question",
    what: "What you want to do",
    conditions: "Conditions I recognized",
    queries: "What I plan to query",
    uncertainties: "What remains uncertain",
    currentTask: "Current task",
    turnRelation: "Turn relation",
    reference: "Referenced object",
    changes: "Changes this turn",
    preserved: "All other conditions from the previous turn remain in effect",
    target: "Target",
    candidates: "Candidates",
    concepts: "Concepts",
    noConditions: "No additional constraints were recognized",
    noQueries: "No external query is required",
    noUncertainty: "No explicit uncertainty affecting this query was found",
    mode: "Answer mode",
    authority: "Authoritative sources",
    previousTask: "the active task from the previous turn",
    previousResult: "the previous result",
    sourceTurn: "turn {value}",
    relativeCompetition: "“Low competition” means relatively lower play rate, not that nobody else will select it",
    fallback: "Structured understanding fell back, so this summary may be incomplete ({reason})",
    processing: "Processing",
    processed: "Processed",
    pendingUnderstanding: "I’m identifying your goal, constraints, and conversational references.",
    understoodPrefix: "My understanding",
    conditionsPrefix: "Recognized conditions",
    changesPrefix: "This turn will",
    queryPrefix: "Next I will",
    authorityPrefix: "Data authority",
    retrievalStarted: "The understanding and query plan are confirmed. I’m retrieving data and evidence.",
    retrievalCompleted: "The data and evidence are ready. I’m organizing the result.",
    completedMessage: "The query and result organization are complete.",
    uncertaintyPrefix: "One uncertainty to keep in mind",
    unknownValue: "not specified",
    yes: "yes",
    no: "no"
  })
});

const GOALS = Object.freeze({
  comp_rankings: ["推荐当前版本的阵容", "Recommend current-patch compositions"],
  comp_trends: ["分析当前阵容趋势", "Analyze current composition trends"],
  comp_analysis: ["分析指定阵容", "Analyze the specified composition"],
  unit_build_rankings: ["查询英雄的稳定出装", "Find stable item builds for a champion"],
  unit_best_3_items: ["推荐英雄的三件套", "Recommend a three-item build for a champion"],
  unit_build_completion: ["根据已有装备补全出装", "Complete a build from owned items"],
  unit_item_rankings: ["查询英雄的单件装备排名", "Rank individual items for a champion"],
  unit_emblem_rankings: ["查询英雄的转职装备排名", "Rank emblems for a champion"],
  unit_item_comparison: ["比较指定装备表现", "Compare the specified items"],
  item_carrier_rankings: ["查询装备的适合携带者", "Find suitable carriers for an item"],
  unit_item_availability: ["检查装备是否可用", "Check item availability"],
  unit_details: ["查询英雄资料", "Look up champion details"],
  item_details: ["查询装备资料", "Look up item details"],
  trait_details: ["查询羁绊资料", "Look up trait details"],
  recommend_best_option: ["推荐最合适的选择", "Recommend the best option"],
  rank_options: ["对候选方案排序", "Rank the available options"],
  choose_best: ["比较并选择更优方案", "Compare and choose the better option"],
  explain_concept_or_entity: ["解释机制或对象", "Explain the concept or entity"],
  analyze_evidence: ["基于证据进行分析", "Analyze the available evidence"],
  find_relevant_data: ["查找相关数据", "Find relevant data"]
});

const ACTIONS = Object.freeze({
  search: ["查找相关信息", "Search for relevant information"],
  recommend: ["给出推荐", "Provide a recommendation"],
  compare: ["比较候选方案", "Compare candidates"],
  rank: ["对结果排序", "Rank the results"],
  explain: ["解释机制或对象", "Explain a mechanic or entity"],
  analyze: ["分析数据与证据", "Analyze data and evidence"],
  summarize: ["总结已有信息", "Summarize available information"],
  find_video: ["查找视频攻略", "Find video guides"]
});

const CONSTRAINTS = Object.freeze({
  patch: ["版本", "Patch"],
  days: ["统计天数", "Time window (days)"],
  queue: ["模式", "Queue"],
  rank: ["段位", "Rank"],
  rankFilter: ["段位", "Rank"],
  starLevel: ["星级", "Star level"],
  itemCount: ["装备数量", "Item count"],
  minSamples: ["最低样本", "Minimum samples"],
  sort: ["稳定性/排序", "Stability / sorting"],
  metrics: ["关注指标", "Metrics"],
  limit: ["数量", "Count"],
  goal: ["目标偏好", "Goal preference"],
  difficulty: ["难度", "Difficulty"],
  specialMode: ["特殊玩法", "Special mode"],
  strategy: ["玩法", "Playstyle"],
  reroll: ["赌狗阵容", "Reroll compositions"],
  contested: ["竞争度", "Competition"],
  beginnerFriendly: ["上手难度", "Ease of play"],
  itemPolicy: ["装备范围", "Item scope"],
  itemCategories: ["装备类别", "Item categories"],
  traitFilters: ["羁绊限制", "Trait filters"],
  lockedItems: ["保留装备", "Required items"],
  ownedItems: ["已有装备", "Owned items"],
  excludedItems: ["排除装备", "Excluded items"],
  avoidItemComponents: ["尽量少用的散件", "Components to minimize"],
  comparisonItems: ["对比装备", "Compared items"],
  primaryMetric: ["主要指标", "Primary metric"],
  performanceItem: ["评估装备", "Item to evaluate"],
  comp: ["指定阵容", "Composition"]
});

const VALUE_LABELS = Object.freeze({
  reroll: ["赌狗阵容", "reroll composition"],
  fast8: ["速八阵容", "fast-8 composition"],
  fast9: ["速九阵容", "fast-9 composition"],
  robust_first: ["稳定性优先", "stability first"],
  top4_first: ["前四率优先", "top-four rate first"],
  win_first: ["登顶率优先", "win rate first"],
  top4: ["稳定前四", "stable top-four"],
  top1: ["吃鸡上限", "win ceiling"],
  low: ["较低", "low"],
  ordinary_only: ["尽量使用普通装备", "ordinary items only"],
  include_radiant: ["包含光明装备", "include Radiant items"],
  include_artifact: ["包含神器", "include Artifacts"],
  include_special: ["包含特殊装备", "include special items"]
});

const TOOLS = Object.freeze({
  unit_builds: ["查询 MetaTFT 英雄出装数据", "Query MetaTFT champion build data"],
  unit_comp_candidates: ["查询包含指定英雄的阵容", "Query compositions containing the champion"],
  item_carrier_rankings: ["查询 MetaTFT 装备携带者数据", "Query MetaTFT item-carrier data"],
  comps_rankings: ["查询 MetaTFT 当前阵容排名与稳定性", "Query current MetaTFT composition rankings and stability"],
  comps_trends: ["查询 MetaTFT 阵容趋势", "Query MetaTFT composition trends"],
  comps_analysis: ["查询阵容分析证据", "Query composition analysis evidence"],
  unit_details: ["查询英雄资料", "Query champion details"],
  item_details: ["查询装备资料", "Query item details"],
  trait_details: ["查询羁绊资料", "Query trait details"],
  semantic_search: ["检索机制与攻略知识", "Retrieve strategy and mechanic knowledge"]
});

const SCOPES = Object.freeze({
  current_stats: ["检索 current_stats 环境趋势", "Retrieve current_stats meta trends"],
  video_guides: ["检索视频攻略与运营解释", "Retrieve video guides and operational explanations"],
  mechanism_knowledge: ["检索机制知识", "Retrieve mechanic knowledge"],
  static_knowledge: ["检索静态知识库", "Retrieve the static knowledge base"]
});

const RELATIONS = Object.freeze({
  new: ["开始新任务", "new task"],
  continue: ["继续上一轮任务", "continue the previous task"],
  modify: ["修改上一轮任务", "modify the previous task"],
  switch: ["切换到新任务", "switch to a new task"],
  return: ["返回之前的任务", "return to an earlier task"],
  cancel: ["取消当前任务", "cancel the current task"]
});

const OPERATIONS = Object.freeze({
  set: ["设置", "Set"],
  add: ["新增", "Add"],
  remove: ["移除", "Remove"],
  replace: ["替换", "Replace"],
  clear: ["清除", "Clear"]
});

const USER_CONSTRAINT_FIELDS = new Set(Object.keys(CONSTRAINTS));

function localeIndex(locale) {
  return String(locale ?? "").toLowerCase().startsWith("zh") ? 0 : 1;
}

function copyFor(locale) {
  return COPY[localeIndex(locale) === 0 ? "zh-CN" : "en-US"];
}

function localized(table, key, locale, fallback = null) {
  return table[key]?.[localeIndex(locale)] ?? fallback ?? humanizeCode(key);
}

function humanizeCode(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function entityLabel(value) {
  if (!isObject(value)) return String(value ?? "");
  return String(
    value.canonicalName
    ?? value.name
    ?? value.label
    ?? value.rawText
    ?? value.apiName
    ?? value.resolvedId
    ?? ""
  );
}

function scalarLabel(value, locale) {
  if (value === null || value === undefined || value === "") return copyFor(locale).unknownValue;
  if (typeof value === "boolean") return value ? copyFor(locale).yes : copyFor(locale).no;
  if (isObject(value)) {
    const entity = entityLabel(value);
    if (entity) return entity;
    return Object.entries(value)
      .map(([key, entry]) => `${humanizeCode(key)}: ${scalarLabel(entry, locale)}`)
      .join(", ");
  }
  return localized(VALUE_LABELS, String(value), locale, String(value));
}

function valueLabel(field, value, locale) {
  if (field === "contested" && typeof value === "boolean") {
    if (localeIndex(locale) === 0) return value ? "允许高竞争阵容" : "优先较低竞争度";
    return value ? "highly contested comps allowed" : "prefer lower competition";
  }
  if (field === "beginnerFriendly" && typeof value === "boolean") {
    if (localeIndex(locale) === 0) return value ? "优先容易上手" : "不限制上手难度";
    return value ? "prefer easier-to-play options" : "no ease-of-play restriction";
  }
  if (field === "specialMode" && typeof value === "boolean") {
    if (localeIndex(locale) === 0) return value ? "允许特殊玩法" : "排除特殊玩法";
    return value ? "special playstyles allowed" : "exclude special playstyles";
  }
  if (field === "reroll" && typeof value === "boolean") {
    if (localeIndex(locale) === 0) return value ? "只看赌狗阵容" : "排除赌狗阵容";
    return value ? "reroll compositions only" : "exclude reroll compositions";
  }
  if (Array.isArray(value)) {
    const entityNamesById = new Map(value.filter(isObject).flatMap((entry) => {
      const label = entityLabel(entry);
      return [
        entry.resolvedId,
        entry.apiName,
        entry.id
      ].filter(Boolean).map((id) => [String(id), label]);
    }));
    return unique(value.map((entry) => (
      isObject(entry)
        ? scalarLabel(entry, locale)
        : entityNamesById.get(String(entry)) ?? scalarLabel(entry, locale)
    ))).join("、");
  }
  return scalarLabel(value, locale);
}

function taskFrameFor(data) {
  const conversation = data?.conversation;
  const frame = conversation?.resolution?.resolvedTaskFrame
    ?? conversation?.delta?.explicitTaskFrame;
  if (frame) return frame;
  const envelope = data?.intentEnvelope;
  if (!envelope) return null;
  const constraints = envelope.constraints ?? {};
  const entityById = new Map(array(envelope.entities).map((entity) => [
    String(entity?.apiName ?? entity?.resolvedId ?? ""),
    entity
  ]));
  const displayConstraints = { ...constraints };
  for (const field of [
    "lockedItems",
    "ownedItems",
    "excludedItems",
    "avoidItemComponents",
    "comparisonItems"
  ]) {
    if (!Array.isArray(constraints[field])) continue;
    displayConstraints[field] = constraints[field].map((value) => (
      entityById.get(String(value)) ?? value
    ));
  }
  const constrainedItems = new Set([
    ...array(constraints.lockedItems),
    ...array(constraints.ownedItems),
    ...array(constraints.excludedItems),
    ...array(constraints.avoidItemComponents)
  ].map(String));
  return {
    schemaVersion: envelope.schemaVersion,
    action: envelope.action,
    goal: envelope.intent,
    subjects: array(envelope.entities).filter((entity) => ["unit", "champion"].includes(entity?.type)),
    candidates: array(envelope.entities).filter((entity) => (
      entity?.type === "item"
      && !constrainedItems.has(String(entity?.apiName ?? entity?.resolvedId ?? ""))
    )),
    concepts: array(envelope.entities).filter((entity) => !["unit", "champion", "item"].includes(entity?.type)),
    constraints: displayConstraints,
    assumptions: [],
    ambiguities: envelope.needsClarification ? array(envelope.warnings) : []
  };
}

function taskGoal(frame, locale) {
  if (!frame) return null;
  return localized(GOALS, frame.goal, locale, localized(ACTIONS, frame.action, locale));
}

function operationLine(operation, locale) {
  const field = localized(CONSTRAINTS, operation?.field, locale);
  const verb = localized(OPERATIONS, operation?.operation, locale);
  if (operation?.operation === "clear") return `${verb}${field}`;
  if (operation?.operation === "replace" && operation.oldValue !== undefined) {
    const arrow = localeIndex(locale) === 0 ? " → " : " → ";
    return `${verb}${field}: ${valueLabel(operation.field, operation.oldValue, locale)}${arrow}${valueLabel(operation.field, operation.value, locale)}`;
  }
  return `${verb}${field}: ${valueLabel(operation?.field, operation?.value, locale)}`;
}

function entityOperationLine(operation, locale) {
  const fieldLabels = {
    subjects: ["目标对象", "target"],
    candidates: ["候选对象", "candidates"],
    concepts: ["涉及概念", "concepts"]
  };
  const field = localized(fieldLabels, operation?.field, locale);
  const verb = localized(OPERATIONS, operation?.operation, locale);
  if (operation?.operation === "clear") return `${verb}${field}`;
  if (operation?.operation === "replace") {
    return `${verb}${field}: ${valueLabel(operation.field, operation.oldValue, locale)} → ${valueLabel(operation.field, operation.value, locale)}`;
  }
  return `${verb}${field}: ${valueLabel(operation?.field, operation?.value, locale)}`;
}

function referenceLabel(frame, delta, resolution, locale) {
  const copy = copyFor(locale);
  const resultReference = resolution?.resultReference ?? delta?.presentation?.resultReference;
  if (resultReference?.ordinal) {
    const base = resultReference.scope === "current_output"
      ? (localeIndex(locale) === 0 ? "本轮输出" : "this turn's output")
      : copy.previousResult;
    return localeIndex(locale) === 0
      ? `${base}中的第 ${resultReference.ordinal} 套`
      : `result ${resultReference.ordinal} in ${base}`;
  }
  const references = array(frame?.contextReferences);
  const reference = references.at(-1);
  if (isObject(reference)) {
    const base = reference.type === "candidate_group" || reference.type === "composition"
      ? copy.previousResult
      : copy.previousTask;
    if (Number.isInteger(reference.sourceTurn)) {
      return `${base}（${copy.sourceTurn.replace("{value}", String(reference.sourceTurn + 1))}）`;
    }
    return base;
  }
  if (reference) return String(reference);
  if (
    ["continue", "modify", "return"].includes(delta?.taskRelation)
    || array(resolution?.inheritedFields).some((field) => String(field).includes("activeTask"))
  ) return copy.previousTask;
  return null;
}

function uncertaintyLabel(entry, locale) {
  if (typeof entry === "string") return entry;
  if (!isObject(entry)) return null;
  const code = humanizeCode(entry.code ?? entry.reason ?? "");
  const missing = array(entry.missingFields).map(humanizeCode).filter(Boolean);
  if (missing.length) {
    return localeIndex(locale) === 0
      ? `${code || "缺少上下文"}：需要确认 ${missing.join("、")}`
      : `${code || "missing context"}: needs ${missing.join(", ")}`;
  }
  return code || null;
}

function authorityLabels(data, locale) {
  const authority = data?.answerModeRoute?.authority ?? {};
  const labels = [];
  if (authority.currentStatistics === "metatft") {
    labels.push(localeIndex(locale) === 0 ? "阵容排名和实时数据：MetaTFT" : "Rankings and current statistics: MetaTFT");
  }
  if (authority.creatorAdvice === "youtube") {
    labels.push(localeIndex(locale) === 0 ? "运营解释：视频攻略与机制知识" : "Operational guidance: video guides and mechanic knowledge");
  }
  if (array(data?.answerModeRoute?.retrievalScopes).includes("current_stats")) {
    labels.push(localeIndex(locale) === 0 ? "环境趋势：current_stats" : "Meta trends: current_stats");
  }
  return unique(labels);
}

export function buildUnderstandingSummary(data, options = {}) {
  const locale = options.locale ?? "zh-CN";
  const copy = copyFor(locale);
  const conversation = data?.conversation ?? {};
  const delta = conversation.delta;
  const resolution = conversation.resolution;
  const frame = taskFrameFor(data);
  const executionPlan = data?.agent?.executionPlan;
  const answerMode = data?.answerModeRoute?.mode ?? data?.mode ?? null;
  const hasStructuredData = Boolean(
    frame
    || delta
    || resolution
    || executionPlan
    || data?.answerModeRoute
  );
  if (!hasStructuredData) return null;

  const what = [];
  const goal = taskGoal(frame, locale);
  if (goal) what.push({ label: copy.currentTask, value: goal });
  if (delta?.taskRelation && delta.taskRelation !== "unknown") {
    what.push({
      label: copy.turnRelation,
      value: localized(RELATIONS, delta.taskRelation, locale)
    });
  }
  const reference = referenceLabel(frame, delta, resolution, locale);
  if (reference) what.push({ label: copy.reference, value: reference });

  const conditions = [];
  const subjectNames = unique(array(frame?.subjects).map(entityLabel));
  const candidateNames = unique(array(frame?.candidates).map(entityLabel));
  const conceptNames = unique(array(frame?.concepts).map(entityLabel));
  if (subjectNames.length) conditions.push({ label: copy.target, value: subjectNames.join("、") });
  if (candidateNames.length) conditions.push({ label: copy.candidates, value: candidateNames.join("、") });
  if (conceptNames.length) conditions.push({ label: copy.concepts, value: conceptNames.join("、") });
  for (const [field, value] of Object.entries(frame?.constraints ?? {})) {
    if (!USER_CONSTRAINT_FIELDS.has(field)) continue;
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    if (
      field === "comp"
      && isObject(value)
      && value.source === "conversation_result_reference"
    ) continue;
    conditions.push({
      label: localized(CONSTRAINTS, field, locale),
      value: valueLabel(field, value, locale)
    });
  }
  const requestedCount = delta?.presentation?.requestedCount;
  if (
    Number.isInteger(requestedCount)
    && !conditions.some((entry) => entry.label === localized(CONSTRAINTS, "limit", locale))
  ) {
    conditions.push({
      label: localized(CONSTRAINTS, "limit", locale),
      value: String(requestedCount)
    });
  }

  const changes = [
    ...array(delta?.entityOperations).map((operation) => entityOperationLine(operation, locale)),
    ...array(delta?.constraintOperations).map((operation) => operationLine(operation, locale))
  ];
  const inheritedActiveTask = array(resolution?.inheritedFields).some((field) => (
    String(field).includes("activeTask")
    || String(field).startsWith("constraints.")
  ));

  const queries = [];
  for (const step of array(executionPlan?.steps)) {
    queries.push(localized(TOOLS, step?.tool, locale, humanizeCode(step?.tool)));
  }
  const constraints = frame?.constraints ?? {};
  if (
    constraints.strategy != null
    || constraints.reroll != null
    || constraints.specialMode === false
  ) {
    const field = constraints.strategy != null
      ? "strategy"
      : constraints.reroll != null
        ? "reroll"
        : "specialMode";
    const value = constraints[field];
    queries.push(localeIndex(locale) === 0
      ? `按玩法条件筛选：${valueLabel(field, value, locale)}`
      : `Apply playstyle filter: ${valueLabel(field, value, locale)}`);
  }
  if (constraints.sort != null) {
    queries.push(localeIndex(locale) === 0
      ? `按${valueLabel("sort", constraints.sort, locale)}整理结果`
      : `Order results by ${valueLabel("sort", constraints.sort, locale)}`);
  }
  if (constraints.contested === false || constraints.contested === "low") {
    queries.push(localeIndex(locale) === 0
      ? "根据出场率判断阵容竞争程度"
      : "Use play rate to assess composition competition");
  }
  if (
    array(constraints.excludedItems).length
    || array(constraints.avoidItemComponents).length
    || array(constraints.lockedItems).length
    || array(constraints.ownedItems).length
    || array(constraints.itemCategories).length
  ) {
    queries.push(localeIndex(locale) === 0
      ? "检查核心装备并应用装备限制"
      : "Check core items and apply item constraints");
  }
  if (Number.isInteger(constraints.limit ?? requestedCount)) {
    const count = constraints.limit ?? requestedCount;
    queries.push(localeIndex(locale) === 0
      ? `保留最符合条件的 ${count} 个结果`
      : `Keep the ${count} best-matching results`);
  }
  for (const scope of array(data?.answerModeRoute?.retrievalScopes)) {
    queries.push(localized(SCOPES, scope, locale, humanizeCode(scope)));
  }

  const uncertainties = [
    ...array(frame?.assumptions).map(String),
    ...array(frame?.ambiguities).map((entry) => uncertaintyLabel(entry, locale)),
    ...array(delta?.ambiguities).map((entry) => uncertaintyLabel(entry, locale)),
    ...array(resolution?.warnings).map((entry) => uncertaintyLabel(entry, locale))
  ].filter(Boolean);
  if (
    frame?.constraints?.contested === false
    || frame?.constraints?.contested === "low"
  ) uncertainties.push(copy.relativeCompetition);
  if (conversation?.providerFallback?.used === true) {
    uncertainties.push(copy.fallback.replace(
      "{reason}",
      humanizeCode(conversation.providerFallback.reason ?? "unknown")
    ));
  }

  return {
    schemaVersion: "understanding-summary.v1",
    what,
    conditions,
    changes: unique(changes),
    preserved: inheritedActiveTask && changes.length > 0,
    queries: unique(queries),
    uncertainties: unique(uncertainties),
    answerMode,
    authorities: authorityLabels(data, locale),
    stateVersion: conversation.stateVersion ?? null
  };
}

function keyValueList(entries, emptyText) {
  if (!entries.length) return `<p class="understanding-empty">${escapeHtml(emptyText)}</p>`;
  return `<dl>${entries.map((entry) => `
    <div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>
  `).join("")}</dl>`;
}

function orderedList(entries, emptyText) {
  if (!entries.length) return `<p class="understanding-empty">${escapeHtml(emptyText)}</p>`;
  return `<ol>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`;
}

function bulletList(entries) {
  if (!entries.length) return "";
  return `<ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`;
}

export function formatProcessingDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : "",
    minutes || hours ? `${minutes}m` : "",
    `${seconds}s`
  ].filter(Boolean).join(" ");
}

function sentence(prefix, entries, locale) {
  if (!entries.length) return "";
  const separator = localeIndex(locale) === 0 ? "；" : "; ";
  const suffix = localeIndex(locale) === 0 ? "。" : ".";
  return `${prefix}：${entries.join(separator)}${suffix}`;
}

function renderChatUnderstandingTrace(data, summary, options, copy, locale) {
  const trace = options.traceState ?? {};
  const phase = String(trace.phase ?? "");
  const completed = options.completed === true || Number.isFinite(trace.completedAt);
  const startedAt = Number(trace.startedAt);
  const endedAt = completed && Number.isFinite(Number(trace.completedAt))
    ? Number(trace.completedAt)
    : Number(options.now ?? Date.now());
  const duration = formatProcessingDuration(
    Number.isFinite(startedAt) ? Math.max(0, endedAt - startedAt) : 0
  );
  const openAttribute = options.open === true ? " open" : "";
  const paragraphs = [];

  if (!summary) {
    paragraphs.push(copy.pendingUnderstanding);
  } else {
    const what = summary.what.map((entry) => (
      localeIndex(locale) === 0
        ? `${entry.label}是${entry.value}`
        : `${entry.label} is ${entry.value}`
    ));
    if (what.length) paragraphs.push(sentence(copy.understoodPrefix, what, locale));

    const conditions = summary.conditions.map((entry) => (
      localeIndex(locale) === 0
        ? `${entry.label}为${entry.value}`
        : `${entry.label}: ${entry.value}`
    ));
    if (conditions.length) paragraphs.push(sentence(copy.conditionsPrefix, conditions, locale));
    if (summary.changes.length) paragraphs.push(sentence(copy.changesPrefix, summary.changes, locale));
    if (summary.preserved) paragraphs.push(copy.preserved + (localeIndex(locale) === 0 ? "。" : "."));
  }

  const planReady = completed || [
    "plan.ready",
    "retrieval.started",
    "retrieval.completed",
    "answer.started"
  ].includes(phase);
  if (summary && planReady && summary.queries.length) {
    paragraphs.push(sentence(copy.queryPrefix, summary.queries, locale));
  }
  if (summary && planReady && summary.authorities.length) {
    paragraphs.push(sentence(copy.authorityPrefix, summary.authorities, locale));
  }
  if (!completed && phase === "retrieval.started") paragraphs.push(copy.retrievalStarted);
  if (!completed && ["retrieval.completed", "answer.started"].includes(phase)) {
    paragraphs.push(copy.retrievalCompleted);
  }
  if (summary && (completed || planReady) && summary.uncertainties.length) {
    paragraphs.push(sentence(copy.uncertaintyPrefix, summary.uncertainties, locale));
  }
  if (completed) paragraphs.push(copy.completedMessage);

  return `<details class="reasoning-trace chat-understanding-panel"${openAttribute}>
    <summary>
      <span class="reasoning-trace-label">${escapeHtml(completed ? copy.processed : copy.processing)}</span>
      <time data-processing-elapsed>${escapeHtml(duration)}</time>
      <span class="reasoning-trace-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="reasoning-trace-body" aria-live="polite">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </div>
  </details>`;
}

export function renderUnderstandingPanel(data, options = {}) {
  const locale = options.locale ?? "zh-CN";
  const copy = copyFor(locale);
  const summary = buildUnderstandingSummary(data, { locale });
  if (options.surface === "chat") {
    return renderChatUnderstandingTrace(data, summary, options, copy, locale);
  }
  if (!summary) return "";
  const mode = summary.answerMode ? String(summary.answerMode) : null;
  const className = "understanding-panel";
  const openAttribute = options.open === true ? " open" : "";
  return `<details class="${className}"${openAttribute}>
    <summary>
      <span class="understanding-chevron" aria-hidden="true">›</span>
      <span class="understanding-heading">
        <small>${escapeHtml(copy.eyebrow)}</small>
        <strong>${escapeHtml(copy.title)}</strong>
      </span>
      ${mode ? `<span class="understanding-mode" title="${escapeHtml(copy.mode)}">${escapeHtml(mode)}</span>` : ""}
    </summary>
    <div class="understanding-body">
      <section>
        <h2>${escapeHtml(copy.what)}</h2>
        ${keyValueList(summary.what, copy.unknownValue)}
      </section>
      <section>
        <h2>${escapeHtml(copy.conditions)}</h2>
        ${keyValueList(summary.conditions, copy.noConditions)}
        ${summary.changes.length ? `<div class="understanding-changes"><strong>${escapeHtml(copy.changes)}</strong>${bulletList(summary.changes)}</div>` : ""}
        ${summary.preserved ? `<p class="understanding-preserved">${escapeHtml(copy.preserved)}</p>` : ""}
      </section>
      <section>
        <h2>${escapeHtml(copy.queries)}</h2>
        ${orderedList(summary.queries, copy.noQueries)}
        ${summary.authorities.length ? `<div class="understanding-authority"><strong>${escapeHtml(copy.authority)}</strong>${bulletList(summary.authorities)}</div>` : ""}
      </section>
      <section>
        <h2>${escapeHtml(copy.uncertainties)}</h2>
        ${bulletList(summary.uncertainties) || `<p class="understanding-empty">${escapeHtml(copy.noUncertainty)}</p>`}
      </section>
    </div>
  </details>`;
}

export function buildDecisionAuditPayload(data) {
  const conversation = data?.conversation ?? {};
  const resolution = conversation.resolution;
  const taskFrame = resolution?.resolvedTaskFrame
    ?? conversation.delta?.explicitTaskFrame
    ?? null;
  return {
    schemaVersion: "decision-audit-view.v1",
    stateVersion: conversation.stateVersion ?? null,
    taskFrame,
    turnDelta: conversation.delta ?? null,
    resolution: resolution ? {
      schemaVersion: resolution.schemaVersion ?? null,
      decision: resolution.decision ?? null,
      presentation: resolution.presentation ?? null,
      inheritedFields: array(resolution.inheritedFields),
      changedFields: array(resolution.changedFields),
      warnings: array(resolution.warnings)
    } : null,
    executionPlan: data?.agent?.executionPlan ?? null,
    answerMode: data?.answerModeRoute ? {
      schemaVersion: data.answerModeRoute.schemaVersion ?? null,
      mode: data.answerModeRoute.mode ?? null,
      structuredOperations: array(data.answerModeRoute.structuredOperations),
      retrievalScopes: array(data.answerModeRoute.retrievalScopes),
      authority: data.answerModeRoute.authority ?? null,
      reasonCodes: array(data.answerModeRoute.reasonCodes)
    } : null,
    providerFallback: conversation.providerFallback ?? null
  };
}

export function formatDecisionAuditPayload(data) {
  const audit = buildDecisionAuditPayload(data);
  const hasAuditData = Boolean(
    audit.taskFrame
    || audit.turnDelta
    || audit.resolution
    || audit.executionPlan
    || audit.answerMode
    || audit.providerFallback
  );
  return hasAuditData ? JSON.stringify(audit, null, 2) : null;
}
