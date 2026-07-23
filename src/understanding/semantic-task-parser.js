import { normalizeText } from "../core/normalizer.js";
import { classifyDomain } from "./domain-gate.js";
import { defaultFewShotExampleStore } from "./few-shot-example-store.js";
import {
  buildSemanticParserMessages,
  createAgentStateBar,
  estimateTokens,
  SEMANTIC_PARSER_BUDGET
} from "./context-policy.js";
import { createTaskFrame, validateTaskFrame } from "./task-frame.js";

const ACTION_PATTERNS = Object.freeze({
  find_video: /视频|視訊|视屏|影片|b站|bilibili/iu,
  compare: /二选一|二選一|还是|還是|选哪个|選哪個|谁更|誰更|谁带|誰帶|哪个好|哪個好|对比|對比|相比|和现[在再]比|跟现[在再]比|从.+到现[在再]|誰贏|谁赢|比强多少|漲了沒|涨了没/iu,
  recommend: /推荐|推薦|推建|出装|出莊|出庄|出裝|咋出|神装|神裝|三件套|怎么带|怎麼帶|咋给装|咋給裝|带什么装备|帶什麼裝備|代甚么装被|装备最好|裝備最好|装被最号|怎么补|怎麼補|咋补|咋不|补装|補裝|补两件|補兩件|后两格|後兩格|给啥|給啥|来俩|來倆|两套|兩套|适合新手|適合新手|新手不卷/iu,
  rank: /排行|排名|怎么排|怎麼排|榜|前\d+|前[一二三四五六七八九十]|最强阵容|最強陣容|最新阵[容荣]|最新陣容|最高.*排|都最高|最厉害|最歷害|啥装备最顶|啥裝備最頂|强的转职|強的轉職|转职.*强|轉職.*強|转最胡|轉最胡|拿啥转|拿啥轉/iu,
  explain: /为什么|為什麼|为啥|為啥|什么意思|什麼意思|啥意思|啥套路|意寺|效果|效裹|技能|技楞|属性|屬性|属姓|面板|档位|檔位|每层给啥|每層給啥/iu,
  analyze: /怎么样|怎麼樣|怎羊|能玩吗|能玩嗎|往上冲|往上沖|上升|起飞|起飛|变热门|變熱門|趋势|趨勢|只有\d+场|只有\d+場|样本|樣本|胜率多少|勝率多少|圣率多少|勝律多少|几几开|幾幾開/iu,
  search: /只看|就看|查一下|查下|搜一下|数据|數據/iu
});

const UNSUPPORTED_PATTERNS = [
  /视频|視訊|视屏|影片|b站|bilibili/iu,
  /九五|95/iu,
  /(?:17\.\d+|历史|歷史).*(?:现在|現在)|(?:现在|現在).*(?:17\.\d+|历史|歷史)/iu,
  /霞.*剑圣|霞.*劍聖|剑圣.*霞|劍聖.*霞/iu,
  /数据库|資料庫|数剧库|數劇庫|任意sql|所有玩家信息|所有玩家資料|玩家信息|绕过限制|繞過限制|把库拖出来|把庫拖出來/iu
];

const MISSING_CONTEXT_PATTERNS = [
  /^(?:哥们|麻烦看下|我就想问下哈|想请问|想請問|局内问)?(?:哪个|哪個|啥)装备最(?:厉害|歷害|顶|頂)/u,
  /这套|這套|刚才|剛才/u
];

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
  if (ACTION_PATTERNS.explain.test(text)) return "explain";
  if (/(?:往上冲|往上沖|上升|起飞|起飛|趋势|趨勢|变热门|變熱門)/iu.test(text)) return "analyze";
  if (ACTION_PATTERNS.analyze.test(text)) {
    return "analyze";
  }
  for (const action of ["compare", "recommend", "rank", "search"]) {
    if (ACTION_PATTERNS[action].test(text)) return action;
  }
  if (/(?:当前|當前|挡前|这版|這版).*(?:版本|板本)|(?:版本|板本).*(?:当前|當前|挡前)/u.test(text)) {
    return "search";
  }
  return examples[0]?.action ?? "analyze";
}

function mentions(text) {
  const values = [];
  const add = (rawText, expectedType, role = "concepts") => {
    if (!rawText || values.some((value) => value.rawText === rawText && value.expectedType === expectedType)) return;
    values.push({ rawText, expectedType, role });
  };

  const dictionary = [
    ["霞", "champion"], ["逆羽", "champion"], ["剑圣", "champion"], ["劍聖", "champion"],
    ["剑生", "champion"], ["卡莎", "champion"], ["卡沙", "champion"],
    ["羊刀", "item"], ["杨刀", "item"], ["羊到", "item"], ["炼刀", "item"], ["练刀", "item"],
    ["巨九", "item"], ["巨9", "item"], ["月光刀", "item"], ["无尽", "item"], ["转职", "item"],
    ["觀星者", "trait"], ["观星者", "trait"], ["观星", "trait"],
    ["九五", "game_concept"], ["95", "game_concept"], ["赌狗", "game_concept"], ["賭狗", "game_concept"],
    ["运营", "game_concept"], ["運營", "game_concept"], ["连败", "game_concept"], ["連敗", "game_concept"],
    ["前排装", "game_concept"], ["前排裝", "game_concept"],
    ["阵容", "composition"], ["陣容", "composition"], ["这套", "composition"], ["這套", "composition"],
    ["攻略视频", "video"], ["攻略視訊", "video"], ["教学视频", "video"], ["教學視訊", "video"],
    ["当前版本", "patch"], ["當前版本", "patch"], ["这版本", "patch"], ["這版本", "patch"],
    ["所有玩家信息", "player_context"], ["所有玩家資料", "player_context"]
  ];
  for (const [rawText, expectedType] of dictionary) {
    if (text.includes(rawText)) add(rawText, expectedType);
  }
  const patch = text.match(/\b\d{1,2}\.\d{1,2}\b/u)?.[0];
  if (patch) add(patch, "patch");
  return values;
}

function constraintsFor(text) {
  const constraints = {};
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
  if (/九五|95|速九/u.test(text)) constraints.strategy = "fast9";
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
  if (UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text))) return "understood_but_unsupported";
  if (MISSING_CONTEXT_PATTERNS.some((pattern) => pattern.test(text)) && !(options.conversation ?? []).length) {
    return "understood_but_missing_context";
  }
  if (action === "unknown" && entityMentions.length === 0) return "ambiguous";
  return "understood_and_supported";
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
  const action = inferAction(text, domainResult.domain, examples);
  const entityMentions = mentions(text);
  const status = understandingStatus(text, domainResult.domain, action, entityMentions, options);
  const ambiguities = status === "understood_but_missing_context"
    ? [{ code: "missing_context", affectsResult: true }]
    : status === "ambiguous"
      ? [{ code: "unclassified_tft_request", affectsResult: true }]
      : [];
  const subjects = [];
  const candidates = [];
  const concepts = [];
  for (const entity of entityMentions) {
    const role = candidateRole(entity, action, entityMentions);
    const value = { rawText: entity.rawText, expectedType: entity.expectedType, resolvedId: null, confidence: null };
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
    constraints: constraintsFor(text),
    goal: goalFor(action),
    expectedOutput: outputsFor(action),
    contextReferences: (options.conversation ?? []).length
      ? [{ type: "conversation", messageCount: options.conversation.length }]
      : [],
    ambiguities,
    assumptions: [],
    confidence,
    understandingStatus: status
  });

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
  if (typeof options.provider === "function") {
    const response = await callProviderWithinBudget(options.provider, {
      messages,
      schemaVersion: frame.schemaVersion,
      budget: { ...SEMANTIC_PARSER_BUDGET, ...(options.budget ?? {}) }
    }, budget.maxLatencyMs);
    frame = createTaskFrame(response?.taskFrame ?? response);
    providerUsage = response?.usage ?? null;
  }

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
  return {
    taskFrame: frame,
    telemetry: {
      schemaVersion: "semantic-parser-telemetry.v1",
      durationMs,
      usage,
      budget,
      exampleIds: examples.map((example) => example.id),
      provider: typeof options.provider === "function" ? "injected" : "deterministic"
    },
    stateBar,
    messages
  };
}
