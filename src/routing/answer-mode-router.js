import {
  STRUCTURED_INTENT_CONTRACTS,
  structuredIntentReadiness
} from "./structured-intent-contracts.js";

export const ANSWER_MODE_ROUTER_SCHEMA_VERSION = "answer_mode_route.v1";

export const ANSWER_MODES = Object.freeze([
  "structured",
  "rag",
  "hybrid"
]);

const STRUCTURED_INTENTS = new Set(Object.keys(STRUCTURED_INTENT_CONTRACTS));

const CURRENT_STATISTICS_PATTERN = /(?:当前|现在|本版本|这个版本|最近|近[一二三四五六七八九十\d]+天|最好|最强|排名|排行|表现|胜率|前四|登顶|平均名次|样本|数据|热门|趋势|上升|下降)/u;
const STRUCTURED_CONSTRAINT_PATTERN = /(?:已有|已经有|剩下|补什么|怎么补|比较|对比|哪个好|至少|样本|宗师|王者|大师|钻石|段位|天内|近\d+天|\d+星|三星|二星|阵容里)/u;
const STRATEGY_PATTERN = /(?:为什么|为何|怎么(?:玩|运营|过渡|转型|站位)|如何(?:玩|运营|过渡|转型|站位)|什么(?:开局|条件|时候)|什么时候|能不能玩|还能玩吗|没有.+怎么办|遇到.+怎么办|优先做|搜牌|升级节奏|站位|运营|过渡|转阵容|替代|针对|难在哪里|实战难|不喜欢赌|不想玩赌|原理|机制)/u;
const EXPLANATION_SUFFIX_PATTERN = /(?:，|,|并且|以及|同时).*(?:为什么|为何|怎么办|怎么打|怎么运营|什么情况下|遇到|替代|针对)/u;

const CURRENT_STATS_CONTEXT_PATTERN = /(?:环境概览|版本环境|当前环境|环境大盘|大盘概览|热门阵容|主流阵容|稳定阵容|哪些阵容|有什么.{0,8}阵容|阵容推荐|宽泛推荐|整体趋势|版本趋势|环境趋势|meta\s*(?:overview|snapshot)?|environment\s+overview|broad\s+recommendation)/iu;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean).map(String))];
}

function normalizedIntent(value) {
  const intent = String(value ?? "").trim();
  return intent || null;
}

function hasStructuredSignal(input, parsed, options, knowledgeSignal = false) {
  const readiness = structuredIntentReadiness(parsed);
  if (!readiness.registered) return false;
  if (
    !readiness.executable
    && shouldRetrieveCurrentStats(input, parsed, options)
  ) return false;
  if (options.forceStructured === true) return true;
  const intent = readiness.intent;
  const explicit = CURRENT_STATISTICS_PATTERN.test(input) || STRUCTURED_CONSTRAINT_PATTERN.test(input);
  if (explicit) return true;
  return !knowledgeSignal && intent && STRUCTURED_INTENTS.has(intent);
}

function hasKnowledgeSignal(input, options) {
  if (options.forceKnowledge === true) return true;
  return STRATEGY_PATTERN.test(input) || EXPLANATION_SUFFIX_PATTERN.test(input);
}

function structuredOperations(parsed) {
  const readiness = structuredIntentReadiness(parsed);
  return readiness.executable ? [readiness.intent] : [];
}

function shouldRetrieveCurrentStats(input, parsed, options) {
  if (options.forceCurrentStats === true) return true;
  if (options.forceCurrentStats === false) return false;
  const intent = normalizedIntent(parsed?.intent ?? parsed?.query?.intent);
  return intent === "comp_trends" || CURRENT_STATS_CONTEXT_PATTERN.test(input);
}

function retrievalScopes(mode, options, input, parsed) {
  if (mode === "structured" && options.includeKnowledgeForStructured !== true) return [];
  const configured = options.retrievalScopes ?? [
    "video_guides",
    "mechanism_knowledge",
    "static_knowledge"
  ];
  return unique([
    ...configured,
    ...(shouldRetrieveCurrentStats(input, parsed, options) ? ["current_stats"] : [])
  ]);
}

export class AnswerModeRouter {
  constructor(options = {}) {
    this.options = options;
  }

  route(value = {}, overrides = {}) {
    const options = { ...this.options, ...overrides };
    const input = String(value.input ?? value.question ?? "");
    const parsed = value.parsed ?? value;
    const knowledge = hasKnowledgeSignal(input, options);
    const structured = hasStructuredSignal(input, parsed, options, knowledge);
    const structuredReadiness = structuredIntentReadiness(parsed);
    const currentStatsContext = shouldRetrieveCurrentStats(input, parsed, options);
    const currentBestRequired = /(?:当前|现在|本版本|这个版本).*(?:最好|最强|排名|排行|表现)|(?:最好|最强).*(?:装备|阵容|英雄)|当前有哪些/u.test(input);
    const mode = structured && (knowledge || currentStatsContext)
      ? "hybrid"
      : knowledge || (!structured && (currentStatsContext || options.unknownMode === "rag"))
        ? "rag"
        : "structured";
    const reasonCodes = [];
    if (structured) reasonCodes.push("structured_signal");
    if (structuredReadiness.registered && !structuredReadiness.executable) {
      reasonCodes.push("structured_required_entities_missing");
    }
    if (knowledge) reasonCodes.push("knowledge_signal");
    if (currentStatsContext) reasonCodes.push("current_stats_context_signal");
    if (!structured && !knowledge) reasonCodes.push("open_question_fallback");
    if (currentBestRequired) reasonCodes.push("current_statistics_authority_required");

    return {
      schemaVersion: ANSWER_MODE_ROUTER_SCHEMA_VERSION,
      mode,
      structuredOperations: mode === "rag" ? [] : structuredOperations(parsed),
      structuredReadiness,
      retrievalScopes: retrievalScopes(mode, options, input, parsed),
      currentBestRequired,
      authority: {
        currentStatistics: "metatft",
        creatorAdvice: "youtube",
        videoMayOverrideCurrentStatistics: false
      },
      reasonCodes
    };
  }
}

export function createAnswerModeRouter(options = {}) {
  return new AnswerModeRouter(options);
}

export function routeAnswerMode(value = {}, options = {}) {
  return createAnswerModeRouter(options).route(value);
}
