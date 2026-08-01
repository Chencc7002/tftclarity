import { normalizeAlias, normalizeText } from "../core/normalizer.js";
import { classifyDomain } from "../domain/tft/domain-gate.js";
import { defaultFewShotExampleStore } from "./few-shot-example-store.js";
import { extractEntityMentions } from "../domain/tft/entity-mention-extractor.js";
import { linkTaskFrameEntities } from "./entity-linker.js";
import {
  buildSemanticParserMessages,
  createAgentStateBar,
  estimateTokens,
  SEMANTIC_PARSER_BUDGET
} from "./context-policy.js";
import { createTaskFrame, validateTaskFrame } from "./task-frame.js";
import { resolveTaskFrameContext } from "./context-resolver.js";
import { applyClarificationPolicy } from "./ambiguity-policy.js";
import { resolveGameConcept } from "../domain/tft/concept-resolver.js";
import {
  deriveTftCapabilityRequirements,
  isRecognizedTftDomainRequest
} from "../domain/tft/semantic-capability-rules.js";
import {
  HERO_COMP_REQUEST_PATTERN,
  ITEM_CARRIER_REQUEST_PATTERN
} from "../domain/tft/intent-patterns.js";

const ACTION_PATTERNS = Object.freeze({
  find_video: /视频|視訊|视屏|影片|b站|bilibili/iu,
  compare: /二选一|二選一|还是|還是|选哪个|選哪個|谁更|誰更|谁带|誰帶|哪个好|哪個好|对比|對比|相比|和现[在再]比|跟现[在再]比|从.+到现[在再]|誰贏|谁赢|比强多少|漲了沒|涨了没/iu,
  recommend: /推荐|推薦|推建|出装|出莊|出庄|出裝|咋出|神装|神裝|三件套|怎么带|怎麼帶|咋给装|咋給裝|带什么装备|帶什麼裝備|代甚么装被|装备最好|裝備最好|装被最号|怎么补|怎麼補|咋补|咋不|补装|補裝|补两件|補兩件|后两格|後兩格|给啥|給啥|来俩|來倆|两套|兩套|适合新手|適合新手|新手不卷/iu,
  rank: /排行|排名|怎么排|怎麼排|榜|前\d+|前[一二三四五六七八九十]|最强阵容|最強陣容|最新阵[容荣]|最新陣容|最高.*排|都最高|最厉害|最歷害|啥装备最顶|啥裝備最頂|强的转职|強的轉職|转职.*强|轉職.*強|转最胡|轉最胡|拿啥转|拿啥轉/iu,
  explain: /为什么|為什麼|为啥|為啥|什么意思|什麼意思|啥意思|啥套路|意寺|效果|效裹|技能|技楞|属性|屬性|属姓|面板|档位|檔位|每层给啥|每層給啥/iu,
  analyze: /怎么样|怎麼樣|怎羊|能玩吗|能玩嗎|往上冲|往上沖|上升|起飞|起飛|变热门|變熱門|趋势|趨勢|只有\d+场|只有\d+場|样本|樣本|胜率多少|勝率多少|圣率多少|勝律多少|几几开|幾幾開/iu,
  search: /只看|就看|查一下|查下|搜一下|数据|數據/iu
});

const MISSING_CONTEXT_PATTERNS = [
  /^(?:哥们|麻烦看下|我就想问下哈|想请问|想請問|局内问)?(?:哪个|哪個|啥)装备最(?:厉害|歷害|顶|頂)/u,
  /这套|這套|刚才|剛才/u
];

const EXPLICIT_ACTION_CUES = Object.freeze({
  find_video: /(?:\u89c6\u9891|B\u7ad9|bilibili|\u5f55\u50cf)/iu,
  compare: /(?:\u6bd4\u8f83|\u5bf9\u6bd4|\u8fd8\u662f|\u4e8c\u9009\u4e00|\u9009\u54ea\u4e2a|\u8c01\u66f4|\u8c01\u66f4\u7a33|\u8c01\u66f4\u597d|\u8c01\u66f4\u9ad8|\u9009\u54ea\u4ef6|\u9009\u90a3\u4ef6|(?:\u548c|\u4e0e|\u8ddf).{0,16}(?:\u600e\u4e48\u9009|\u8c01|\u54ea\u4e2a|\u54ea\u4ef6)|\u8fd9\u4fe9.{0,8}\u600e\u4e48\u9009|\u8ddf.{0,12}\u6bd4|\u4e0e.{0,12}\u6bd4|\u6bd4\u600e\u6837|\u6362.{0,8}\u4f1a\u66f4\u597d)/u,
  recommend: /(?:\u63a8\u8350|\u795e\u88c5|\u4e09\u4ef6\u5957|\u600e\u4e48\u51fa\u88c5|\u600e\u4e48\u914d|\u548b\u51fa|\u51fa[\u88c5\u5e84].{0,3}(?:\u600e\u4e48|\u548b)?\u9009|\u548b\u9009|\u548b\u585e|\u600e\u4e48\u585e|\u4e24\u4ef6\u548b\u5e26|\u7ed9\u5565|\u8865\u4e24\u4ef6|\u6765\u4e09\u5957|\u6765\u4e24\u5957|\u518d\u6765.{0,4}(?:\u5019\u9009|\u9635\u5bb9))/u,
  rank: /(?:\u6392\u540d|\u6392\u884c|\u699c\u5355|\u5f3a\u5ea6\u699c|\u600e\u4e48\u6392|\u6392\u4e00\u4e0b|\u4f18\u5148\u7ea7|\u8c01\u6700\u9876|\u5f3a\u7684[\u8f6c\u4e13]\u804c|\u90fd\u6700\u9ad8|\u6309.{0,18}\u6392|\u6700\u9ad8.{0,10}\u6392)/u,
  explain: /(?:\u89e3\u91ca|\u8bf4\u660e|\u4ec0\u4e48\u610f\u601d|\u5565\u610f\u601d|\u662f\u4ec0\u4e48|\u6548\u679c|\u8be6\u60c5|\u5c5e\u6027|\u6bcf\u6863|\u4e3a\u4ec0\u4e48|\u4e3a\u5565|\u4e3a\u751a\u4e48|\u7206\u706b)/u,
  analyze: /(?:\u5206\u6790|\u8d8b\u52bf|\u8d70\u52bf|\u5728\u6da8|\u5f80\u4e0a\u8d70|\u53d8\u597d|\u5dee\u591a\u5c11|\u7cbe\u786e.{0,4}\u80dc\u7387|\u70ed\u5ea6.{0,4}\u6da8|\u80dc\u7387|\u524d\u56db\u7387|\u5403\u5206\u7387|\u8868\u73b0|\u600e\u4e48\u6837|\u5f3a\u4e0d\u5f3a)/u,
  search: /(?:\u67e5|\u641c|\u53ea\u770b|\u6570\u636e|\u5019\u9009)/u
});

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function inferAction(text, domain, examples) {
  if (domain === "out_of_domain") return "unknown";
  if (/忽略规[则責责]|忽略規則|绕过限制|繞過限制|直接查|数据库|資料庫|数劇库|把库拖出来|把庫拖出來|所有玩家信息|玩家信息/iu.test(text)) {
    return "unknown";
  }
  if (ACTION_PATTERNS.find_video.test(text)) return "find_video";
  if (ITEM_CARRIER_REQUEST_PATTERN.test(text)) return "rank";
  const explicit = explicitAction(text);
  if (explicit) return explicit;
  if (ACTION_PATTERNS.explain.test(text)) return "explain";
  if (/(?:往上冲|往上沖|上升|起飞|起飛|趋势|趨勢|变热门|變熱門)/iu.test(text)) return "analyze";
  if (ACTION_PATTERNS.analyze.test(text)) {
    return "analyze";
  }
  for (const action of ["compare", "recommend", "rank", "search"]) {
    if (ACTION_PATTERNS[action].test(text)) return action;
  }
  if (HERO_COMP_REQUEST_PATTERN.test(text)) return "rank";
  if (/(?:当前|當前|挡前|这版|這版).*(?:版本|板本)|(?:版本|板本).*(?:当前|當前|挡前)/u.test(text)) {
    return "search";
  }
  const collection = collectionRequestType(text);
  if (collection) return "search";
  return examples[0]?.action ?? "analyze";
}

function constraintsFor(text) {
  const constraints = {};
  const costMatches = [...text.matchAll(/([一二两兩三四五六七八九\d])\s*费(?:卡|棋子|英雄)?/gu)];
  if (costMatches.length) {
    const costMap = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const costs = [...new Set(costMatches.map((match) => costMap[match[1]] ?? Number(match[1])))]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 9)
      .sort((left, right) => left - right);
    constraints.cost = costs.length === 1 ? costs[0] : costs;
    constraints.targetEntityType = "champion";
    constraints.relation = "member_of_trait";
    constraints.current = true;
  }
  if (/最高费|最高費/u.test(text)) {
    constraints.targetEntityType = "champion";
    constraints.relation = "member_of_trait";
    constraints.sort = "cost_desc";
    constraints.limit = 1;
    constraints.current = true;
  }
  if (/(?:阵容|陣容).{0,8}(?:非|不属于|不屬於).{0,6}(?:羁绊|羈絆).{0,8}(?:外援|单挂|單掛|外挂)|(?:非|不属于|不屬於)(?:本)?羁绊外援/u.test(text)) {
    constraints.externalSupportInterpretation = "non_trait_splash_unit";
  }
  if (/(?:提升|增益)(?:最大|最高)/u.test(text)) constraints.sort = "uplift_first";
  if (/(?:携带|使用|样本)(?:最多|最高)|高频/u.test(text)) constraints.sort = "games_first";
  if (/(?:\u8d8b\u52bf|\u8d70\u52bf|\u5728\u6da8|\u5f80\u4e0a\u8d70|\u53d8\u597d|\u70ed\u5ea6.{0,4}\u6da8)/u.test(text)) {
    constraints.trend = "up";
  }
  if (/当前|當前|这版|這版|现在|現在/u.test(text)) constraints.patch = "current";
  const historicalPatch = text.match(/\b\d{1,2}\.\d{1,2}\b/u)?.[0];
  if (historicalPatch) constraints.patch = historicalPatch;
  const itemCount = text.match(/([一二两兩三四五六七八九\d])件/u)?.[1];
  if (itemCount) constraints.itemCount = "一二两兩三四五六七八九".includes(itemCount)
    ? "一二两兩三四五六七八九".indexOf(itemCount) % 9 + 1
    : Number(itemCount);
  const limit = text.match(/(?:前|推荐|推薦|来|來)([一二两兩三四五六七八九十\d]+)(?:套|个|個|名)?/u)?.[1];
  if (limit) {
    const numberMap = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    constraints.limit = finite(limit, numberMap[limit] ?? null);
  }
  if (/赌狗|賭狗|赌牌|賭牌|追三|reroll/iu.test(text)) constraints.strategy = "reroll";
  if (/不卷/u.test(text)) constraints.contested = "low";
  if (/新手|无脑|無腦/u.test(text)) constraints.beginnerFriendly = true;
  if (/趋势|趨勢|往上|起飞|起飛/u.test(text)) constraints.trend = "up";
  if (/只有\s*(\d+)\s*[场場]/u.test(text)) {
    constraints.samples = Number(text.match(/只有\s*(\d+)\s*[场場]/u)?.[1]);
  }
  return constraints;
}

function goalFor(action) {
  return {
    search: "find_relevant_data",
    recommend: "recommend_best_option",
    compare: "choose_best",
    rank: "rank_options",
    explain: "explain_concept_or_entity",
    analyze: "analyze_evidence",
    summarize: "summarize_evidence",
    find_video: "find_strategy_video",
    unknown: "understand_request"
  }[action];
}

function outputsFor(action) {
  return {
    search: ["results", "evidence"],
    recommend: ["recommendation", "evidence"],
    compare: ["recommendation", "comparison", "evidence"],
    rank: ["ranking", "evidence"],
    explain: ["explanation", "evidence"],
    analyze: ["analysis", "evidence"],
    summarize: ["summary", "evidence"],
    find_video: ["video_candidates", "evidence"],
    unknown: ["understanding_status"]
  }[action] ?? ["understanding_status"];
}

function understandingStatus(text, domain, action, entityMentions, options) {
  if (domain === "out_of_domain") return "out_of_domain";
  if (
    action === "compare"
    && /(?:\u53e6\u4e00\u4ef6\u88c5\u5907|\u4e24\u4ef6\u5019\u9009\u88c5\u5907|\u6ca1\u8bf4\u540d\u5b57)/u.test(text)
  ) {
    return "understood_but_missing_context";
  }
  if (MISSING_CONTEXT_PATTERNS.some((pattern) => pattern.test(text)) && !(options.conversation ?? []).length) {
    return "understood_but_missing_context";
  }
  if (
    action === "unknown"
    && entityMentions.length === 0
    && !isRecognizedTftDomainRequest(text)
  ) return "ambiguous";
  return "understood_and_supported";
}

function isBareChampionRequest(text, entityMentions) {
  const champions = entityMentions.filter((entity) => entity.expectedType === "champion");
  if (champions.length !== 1 || entityMentions.length !== 1) return false;
  const alias = normalizeAlias(champions[0].rawText);
  return Boolean(alias) && normalizeAlias(text).replace(alias, "") === "";
}

function candidateRole(entity, action, allEntities) {
  if (action !== "compare") return entity.expectedType === "champion" ? "subjects" : "concepts";
  const championCount = allEntities.filter((value) => value.expectedType === "champion").length;
  if (entity.expectedType === "champion" && championCount === 1) return "subjects";
  if (["champion", "item", "patch"].includes(entity.expectedType)) return "candidates";
  return "concepts";
}

function parserUsage(messages, frame, providerUsage = null) {
  if (providerUsage) {
    return {
      cachedInputTokens: Math.max(0, Number(providerUsage.cachedInputTokens ?? providerUsage.cached_input_tokens ?? 0)),
      uncachedInputTokens: Math.max(0, Number(providerUsage.uncachedInputTokens ?? providerUsage.input_tokens ?? 0)),
      outputTokens: Math.max(0, Number(providerUsage.outputTokens ?? providerUsage.output_tokens ?? 0))
    };
  }
  return {
    cachedInputTokens: estimateTokens(messages.slice(0, 2)),
    uncachedInputTokens: estimateTokens(messages.slice(2)),
    outputTokens: estimateTokens(frame)
  };
}

function explicitAction(text) {
  if (/(?:\u53ea\u6709\s*\d+\s*\u573a|\u5c0f\u6837\u672c|\u6837\u672c\u4e0d\u8db3)/u.test(text)) {
    return "analyze";
  }
  if (/(?:\u6bcf\u5c42|\u6bcf\u6863|\u9762\u677f|\u6548\u679c|\u8be6\u60c5)/u.test(text)) {
    return "explain";
  }
  for (const action of [
    "find_video",
    "compare",
    "recommend",
    "rank",
    "explain",
    "analyze",
    "search"
  ]) {
    if (EXPLICIT_ACTION_CUES[action].test(text)) return action;
  }
  return null;
}

function collectionRequestType(text) {
  if (/(是什么|什么是|效果|激活|层级|属性|详情|技能|说明)/u.test(text)) return null;
  const category = /(?:棋子|英雄|弈子|卡)/u.test(text)
    ? "champion"
    : /(?:羁绊|羁絆)/u.test(text)
      ? "trait"
      : /(?:装备|裝備)/u.test(text)
        ? "item"
        : null;
  if (!category) return null;
  if (!/(哪些|什么|有些|有哪些|返回|列出|列一下|给我|看下|看一下|查询|查一下|查下|搜一下|全部|所有|名单|列表)/u.test(text)) {
    return null;
  }
  return category;
}

const GENERIC_PROVIDER_ENTITY = /^(?:\u795e\u88c5|\u4e09\u4ef6[\u5957\u88c5\u5986]|\u5355\u4ef6\u88c5\u5907|\u6563\u4ef6|\u88c5[\u5907\u88ab]|\u5f53\u524d\u6570\u636e|\u6570\u636e|\u8868[\u73b0\u5148]|\u5403\u5206[\u7387\u5f8b]|\u5e73\u5747\u540d\u6b21|\u4f18\u5148[\u7ea7\u6781]|\u5019\u9009|\u8be6\u60c5|\u8fd9\u5f20\u5361|\u8fd9\u4ef6|\u8fd9\u4fe9|\u53e6\u4e00\u4ef6\u88c5\u5907|\u5979|\u4ed6|\u5b83)$/u;

function usefulProviderEntity(entity) {
  const mention = normalizeText(entity?.rawText);
  return Boolean(mention) && !GENERIC_PROVIDER_ENTITY.test(mention);
}

function mergeEntities(deterministic, provider, text) {
  const values = [];
  const seen = new Set();
  const normalizedInput = normalizeText(text);
  for (const [entity, fromProvider] of [
    ...(deterministic ?? []).map((value) => [value, false]),
    ...(provider ?? []).map((value) => [value, true])
  ]) {
    if (
      fromProvider
      && (
        !usefulProviderEntity(entity)
        || !normalizedInput.includes(normalizeText(entity?.rawText))
      )
    ) continue;
    const mention = normalizeText(entity?.rawText);
    if (!mention) continue;
    const key = `${mention}:${entity?.expectedType ?? "game_concept"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(structuredClone(entity));
  }
  return values;
}

function reconcileProviderFrame(providerFrame, deterministicFrame, text) {
  const actionCue = explicitAction(text);
  const deterministicDomain = deterministicFrame.domain === "out_of_domain";
  const providerOutOfDomain = providerFrame.domain === "out_of_domain";
  const action = deterministicDomain || providerOutOfDomain
    ? deterministicDomain ? deterministicFrame.action : "unknown"
    : actionCue && deterministicFrame.action !== "unknown"
    ? deterministicFrame.action
    : providerFrame.action;
  const actionChanged = action !== providerFrame.action;
  const normalizeUnderstandingStatus = (status) => (
    status === "out_of_domain"
      ? "out_of_domain"
      : status === "understood_but_missing_context"
        ? "understood_but_missing_context"
        : status === "ambiguous"
          ? "ambiguous"
          : "understood_and_supported"
  );
  const deterministicStatus = normalizeUnderstandingStatus(
    deterministicFrame.understandingStatus
  );
  const providerStatus = normalizeUnderstandingStatus(providerFrame.understandingStatus);
  const forceDeterministicStatus = deterministicDomain
    || deterministicStatus === "understood_but_missing_context"
    || (
      deterministicStatus === "understood_and_supported"
      && providerStatus === "understood_but_missing_context"
    );
  const understandingStatus = deterministicDomain || providerOutOfDomain
    ? "out_of_domain"
    : forceDeterministicStatus
    ? deterministicStatus
    : providerStatus;
  const ambiguities = deterministicDomain
    ? deterministicFrame.ambiguities
    : deterministicStatus === "understood_but_missing_context"
      ? deterministicFrame.ambiguities
      : providerFrame.ambiguities.filter((entry) => (
        !["missing_context", "missing_context_reference"].includes(entry?.code)
      ));
  const constraints = {
    ...deterministicFrame.constraints,
    ...providerFrame.constraints
  };
  if (/(?:\u8d8b\u52bf|\u8d8b\u5f0f|\u5728\u6da8|\u5f80\u4e0a\u8d70)/u.test(text)) {
    constraints.trend = constraints.trend ?? "up";
  }
  const useCanonicalSemantics = Boolean(actionCue) || deterministicDomain || providerOutOfDomain;
  return createTaskFrame({
    ...providerFrame,
    domain: deterministicDomain ? deterministicFrame.domain : providerFrame.domain,
    action,
    subjects: mergeEntities(deterministicFrame.subjects, providerFrame.subjects, text),
    candidates: mergeEntities(deterministicFrame.candidates, providerFrame.candidates, text),
    concepts: mergeEntities(deterministicFrame.concepts, providerFrame.concepts, text),
    constraints,
    ambiguities,
    goal: useCanonicalSemantics || actionChanged ? goalFor(action) : providerFrame.goal,
    expectedOutput: useCanonicalSemantics || actionChanged
      ? outputsFor(action)
      : providerFrame.expectedOutput,
    understandingStatus
  });
}

function applyUnresolvedEntityPolicy(taskFrame, input) {
  const frame = createTaskFrame(taskFrame);
  if (
    frame.domain !== "tft"
    || ["understood_but_unsupported", "understood_but_missing_context", "out_of_domain"]
      .includes(frame.understandingStatus)
  ) {
    return frame;
  }
  const entities = [...frame.subjects, ...frame.candidates, ...frame.concepts];
  const resolved = entities.filter((entity) => entity.resolvedId);
  const unresolvedTyped = entities.filter((entity) => (
    !entity.resolvedId
    && ["champion", "item", "trait", "augment"].includes(entity.expectedType)
  ));
  const dependentUnknownConcept = resolved.length === 0
    && entities.some((entity) => (
      !entity.resolvedId
      && ["composition", "game_concept"].includes(entity.expectedType)
    ))
    && /(?:\u600e\u4e48\u914d|\u600e\u4e48\u51fa|\u7ed9\u4ec0\u4e48|\u5e26\u4ec0\u4e48|\u4ec0\u4e48\u6548\u679c)/u
      .test(String(input ?? ""));
  if (unresolvedTyped.length === 0 && !dependentUnknownConcept) {
    const ambiguities = frame.ambiguities.filter((entry) => entry?.code !== "ambiguous_entity");
    if (ambiguities.length === frame.ambiguities.length) return frame;
    return createTaskFrame({
      ...frame,
      ambiguities,
      understandingStatus: frame.understandingStatus === "ambiguous" && ambiguities.length === 0
        ? "understood_and_supported"
        : frame.understandingStatus
    });
  }
  return createTaskFrame({
    ...frame,
    ambiguities: [
      ...frame.ambiguities,
      {
        code: "ambiguous_entity",
        affectsResult: true,
        affectsToolSelection: true,
        candidates: unresolvedTyped.map((entity) => ({
          rawText: entity.rawText,
          expectedType: entity.expectedType
        }))
      }
    ],
    understandingStatus: "ambiguous"
  });
}

function applyExternalSupportSemantics(taskFrame, text, conversation = []) {
  let frame = createTaskFrame(taskFrame);
  if (!/外援|单挂|單掛|外挂/u.test(text)) return frame;

  const explicitExternal = frame.constraints.externalSupportInterpretation === "non_trait_splash_unit";
  const previousFrames = conversation
    .map((entry) => entry?.taskFrame ?? entry?.frame ?? null)
    .filter(Boolean);
  const isEmblemCarrierFrame = (previous) => {
    if (
      previous?.goal === "item_carrier_rankings"
      || previous?.goal === "rank_emblem_carriers"
      || previous?.constraints?.externalSupportInterpretation === "emblem_carrier"
    ) return true;
    const items = [
      ...(previous?.candidates ?? []),
      ...(previous?.concepts ?? [])
    ].filter((entity) => entity?.expectedType === "item");
    return previous?.action === "rank"
      && items.length === 1
      && /emblem|纹章|轉|转/iu.test(`${items[0].resolvedId ?? ""} ${items[0].rawText ?? ""}`);
  };
  const emblemContext = /转谁带|轉誰帶|转职.{0,6}(?:谁|誰).{0,3}带|轉職.{0,6}(?:誰|谁).{0,3}帶/u.test(text)
    || previousFrames.some(isEmblemCarrierFrame);
  if (explicitExternal || emblemContext) {
    const previousCarrierFrame = [...previousFrames].reverse().find(isEmblemCarrierFrame);
    const previousItems = [
      ...(previousCarrierFrame?.candidates ?? []),
      ...(previousCarrierFrame?.concepts ?? [])
    ].filter((entity) => entity?.expectedType === "item" && entity?.resolvedId);
    return createTaskFrame({
      ...frame,
      action: "search",
      goal: explicitExternal ? "find_external_support_units" : "rank_emblem_carriers",
      expectedOutput: ["results", "ranking", "evidence"],
      constraints: {
        ...frame.constraints,
        externalSupportInterpretation: explicitExternal ? "non_trait_splash_unit" : "emblem_carrier"
      },
      ...(emblemContext && previousItems.length === 1 ? {
        candidates: previousItems,
        concepts: frame.concepts.filter((entity) => entity.expectedType === "patch")
      } : {}),
      assumptions: emblemContext && !explicitExternal
        ? [...new Set([...frame.assumptions, "按适合携带目标羁绊转职的外援棋子理解"])]
        : frame.assumptions,
      ambiguities: frame.ambiguities.filter((entry) => entry?.code !== "ambiguous_game_concept"),
      understandingStatus: "understood_and_supported"
    });
  }
  return createTaskFrame({
    ...frame,
    action: "search",
    goal: "resolve_external_support_meaning",
    ambiguities: [
      ...frame.ambiguities.filter((entry) => entry?.code !== "ambiguous_game_concept"),
      {
        code: "ambiguous_game_concept",
        inputFragment: "外援",
        affectsResult: true,
        affectsToolSelection: true,
        candidates: [
          { id: "non_trait_splash_unit", label: "阵容中常见的非本羁绊单挂棋子" },
          { id: "emblem_carrier", label: "适合携带目标羁绊转职的棋子" }
        ],
        safeAssumption: null
      }
    ],
    understandingStatus: "ambiguous"
  });
}

function applyCandidateGroupBuildSemantics(taskFrame, text) {
  const frame = createTaskFrame(taskFrame);
  const buildRequest = /(?:出装|出裝|给装|給裝|配装|配裝|装备|裝備)/u.test(text);
  const candidateScope = frame.constraints?.targetEntityType === "champion"
    && (
      frame.constraints?.cost !== undefined
      || frame.constraints?.relation === "member_of_trait"
      || frame.candidates.filter((entity) => entity?.expectedType === "champion").length > 1
    );
  if (!buildRequest || !candidateScope) return frame;
  const comparison = /(?:谁|誰|哪个|哪個).{0,12}(?:表现|表現|最好|最强|最強)|(?:表现|表現).{0,8}(?:最好|最强|最強)|(?:最好|最强|最強).{0,8}(?:出装|出裝|装备|裝備)/u.test(text);
  return createTaskFrame({
    ...frame,
    action: comparison ? "analyze" : "recommend",
    goal: comparison
      ? "compare_entity_build_performance"
      : "recommend_builds_for_candidate_group",
    expectedOutput: comparison
      ? ["comparison", "ranking", "evidence"]
      : ["recommendations", "results", "evidence"]
  });
}

function applyEntityCollectionSemantics(taskFrame, text) {
  const frame = createTaskFrame(taskFrame);
  const collectionType = collectionRequestType(text);
  if (!collectionType) return frame;
  if (/(?:出装|出裝|给装|給裝|配装|配裝|装备|裝備)/u.test(text)) return frame;
  return createTaskFrame({
    ...frame,
    action: "search",
    goal: goalFor("search"),
    expectedOutput: outputsFor("search"),
    constraints: {
      ...frame.constraints,
      targetEntityType: collectionType,
      current: true
    },
    capabilityRequirements: [
      ...new Set([...(frame.capabilityRequirements ?? []), "entity_catalog_filtering"])
    ]
  });
}

async function callProviderWithinBudget(provider, request, maxLatencyMs) {
  let timeoutId;
  const providerPromise = Promise.resolve().then(() => provider(request));
  providerPromise.catch(() => {});
  try {
    return await Promise.race([
      providerPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(Object.assign(
          new Error("Semantic parser provider timed out"),
          { code: "semantic_parser_timeout" }
        )), maxLatencyMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function parseSemanticTask(input, options = {}) {
  const startedAt = performance.now();
  const text = normalizeText(input);
  const budget = { ...SEMANTIC_PARSER_BUDGET, ...(options.budget ?? {}) };
  const examples = (options.exampleStore ?? defaultFewShotExampleStore).search(text, {
    limit: budget.maxExamples
  });
  let domainResult = classifyDomain(text, {
    conversation: options.conversation,
    defaultDomain: options.defaultDomain
  });
  if (
    domainResult.source === "domain_default"
    && examples[0]?.domain === "tft"
    && examples[0].score >= 0.08
  ) {
    domainResult = {
      domain: "tft",
      confidence: Math.min(0.95, 0.7 + examples[0].score * 0.25),
      source: "retrieved_example"
    };
  }
  let action = inferAction(text, domainResult.domain, examples);
  const inferredConstraints = constraintsFor(text);
  if (
    inferredConstraints.targetEntityType === "champion"
    && inferredConstraints.relation === "member_of_trait"
  ) {
    action = "search";
  }
  const entityMentions = extractEntityMentions(text, { catalog: options.catalog });
  const bareChampionRequest = isBareChampionRequest(text, entityMentions);
  if (
    domainResult.domain === "out_of_domain"
    && (
      entityMentions.some((entity) => entity.expectedType === "game_concept")
      || bareChampionRequest
      || (
        ITEM_CARRIER_REQUEST_PATTERN.test(text)
        && entityMentions.some((entity) => entity.expectedType === "item")
      )
    )
  ) {
    domainResult = {
      domain: "tft",
      confidence: 0.95,
      source: "curated_game_concept"
    };
    action = inferAction(text, domainResult.domain, examples);
  }
  if (bareChampionRequest) action = "unknown";
  const status = bareChampionRequest
    ? "understood_but_missing_context"
    : understandingStatus(text, domainResult.domain, action, entityMentions, options);
  const ambiguities = bareChampionRequest
    ? [{
      code: "ambiguous_query_type",
      affectsResult: true,
      affectsToolSelection: true,
      missingFields: ["query_type"]
    }]
    : status === "understood_but_missing_context"
    ? [{ code: "missing_context", affectsResult: true }]
    : status === "ambiguous"
      ? [{ code: "unclassified_tft_request", affectsResult: true }]
      : [];
  const subjects = [];
  const candidates = [];
  const concepts = [];
  for (const entity of entityMentions) {
    const role = candidateRole(entity, action, entityMentions);
    const value = {
      rawText: entity.rawText,
      expectedType: entity.expectedType,
      resolvedId: null,
      confidence: null,
      source: entity.source
    };
    if (role === "subjects") subjects.push(value);
    else if (role === "candidates") candidates.push(value);
    else concepts.push(value);
  }
  const confidence = domainResult.domain === "out_of_domain"
    ? domainResult.confidence
    : Math.min(0.99, action === "unknown" ? 0.72 : 0.94);
  let frame = createTaskFrame({
    domain: domainResult.domain,
    action,
    subjects,
    candidates,
    concepts,
    constraints: inferredConstraints,
    goal: goalFor(action),
    expectedOutput: outputsFor(action),
    contextReferences: [],
    ambiguities,
    assumptions: [],
    confidence,
    understandingStatus: status
  });
  const deterministicFrame = structuredClone(frame);

  const stateBar = createAgentStateBar({
    objective: frame.goal,
    remainingBudget: {
      inputTokens: options.budget?.maxInputTokens ?? SEMANTIC_PARSER_BUDGET.maxInputTokens,
      outputTokens: options.budget?.maxOutputTokens ?? SEMANTIC_PARSER_BUDGET.maxOutputTokens,
      deadlineMs: options.budget?.maxLatencyMs ?? SEMANTIC_PARSER_BUDGET.maxLatencyMs
    },
    unresolvedAmbiguities: frame.ambiguities
  });
  const messages = buildSemanticParserMessages({
    input,
    examples,
    dynamicContext: options.dynamicContext,
    stateBar
  });

  let providerUsage = null;
  let providerFallback = null;
  if (typeof options.provider === "function") {
    try {
      const response = await callProviderWithinBudget(options.provider, {
        messages,
        schemaVersion: frame.schemaVersion,
        budget: { ...SEMANTIC_PARSER_BUDGET, ...(options.budget ?? {}) }
      }, budget.maxLatencyMs);
      frame = reconcileProviderFrame(
        createTaskFrame(response?.taskFrame ?? response),
        deterministicFrame,
        text
      );
      providerUsage = response?.usage ?? null;
    } catch (error) {
      if (options.providerFailureFallback !== true) throw error;
      providerFallback = {
        used: true,
        reason: error?.name === "TypeError" ? "invalid_response" : "provider_error"
      };
    }
  }
  if (options.entityLinking !== false && options.catalog) {
    frame = await linkTaskFrameEntities(frame, {
      catalog: options.catalog,
      patch: options.dynamicContext?.version,
      semanticRetriever: options.entitySemanticRetriever,
      candidateRetriever: options.entityCandidateRetriever,
      candidateReranker: options.entityCandidateReranker
    });
    frame = applyUnresolvedEntityPolicy(frame, input);
  }
  const contextResolution = resolveTaskFrameContext(frame, {
    input,
    conversation: options.conversation,
    defaults: options.contextDefaults
  });
  frame = applyExternalSupportSemantics(
    contextResolution.taskFrame,
    text,
    options.conversation ?? []
  );
  frame = applyCandidateGroupBuildSemantics(frame, text);
  frame = applyEntityCollectionSemantics(frame, text);
  const clarificationPolicy = applyClarificationPolicy(
    frame,
    contextResolution,
    options.clarificationPolicy
  );
  frame = clarificationPolicy.taskFrame;
  frame = createTaskFrame({
    ...frame,
    capabilityRequirements: deriveTftCapabilityRequirements(input, frame)
  });

  const validation = validateTaskFrame(frame);
  if (!validation.valid) {
    throw new TypeError(`Invalid semantic TaskFrame: ${validation.errors.join("; ")}`);
  }
  const usage = parserUsage(messages, frame, providerUsage);
  const totalInputTokens = usage.cachedInputTokens + usage.uncachedInputTokens;
  if (totalInputTokens > budget.maxInputTokens || usage.outputTokens > budget.maxOutputTokens) {
    throw new RangeError("Semantic parser token budget exceeded");
  }
  const durationMs = Math.max(0, performance.now() - startedAt);
  const resolvedStateBar = createAgentStateBar({
    ...stateBar,
    objective: frame.goal,
    unresolvedAmbiguities: frame.ambiguities
  });
  return {
    taskFrame: frame,
    telemetry: {
      schemaVersion: "semantic-parser-telemetry.v1",
      durationMs,
      usage,
      budget,
      exampleIds: examples.map((example) => example.id),
      provider: typeof options.provider === "function" ? "injected" : "deterministic",
      providerFallback
    },
    stateBar: resolvedStateBar,
    contextResolution,
    clarificationPolicy,
    messages
  };
}
