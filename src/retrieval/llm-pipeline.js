import { generateEvidenceBackedConclusion } from "../core/conclusion-service.js";
import { createIntentEnvelope } from "./contracts.js";
import { rerankSemanticHits } from "./hybrid-reranker.js";
import { RetrievalPlanner } from "./retrieval-planner.js";

function emit(onEvent, event) {
  try {
    onEvent?.(event);
  } catch {
    // Observability cannot change query behavior.
  }
}

async function retrieveSemantics(plan, retriever, onEvent) {
  if (!plan.semanticQueries.length || !retriever) {
    emit(onEvent, { type: "semantic_retrieval_skipped" });
    return [];
  }
  const hits = [];
  for (const query of plan.semanticQueries) {
    try {
      const values = await retriever.search(query.query, {
        documentTypes: query.types,
        patch: query.patch,
        locale: query.locale,
        topK: query.topK
      });
      const reranked = rerankSemanticHits(query.query, values, {
        documentTypes: query.types,
        patch: query.patch,
        locale: query.locale,
        topK: query.topK
      });
      hits.push(...reranked);
      emit(onEvent, { type: "semantic_retrieval_completed", queryId: query.id, count: reranked.length });
    } catch (error) {
      emit(onEvent, { type: "semantic_retrieval_failed", queryId: query.id, error: error?.code ?? error?.name ?? "error" });
      if (query.required) throw error;
    }
  }
  return hits;
}

export async function runLlmRetrievalPipeline({
  input,
  catalog,
  resolveRequest,
  retrieveStructured,
  semanticRetriever = null,
  planner = new RetrievalPlanner(),
  conclusionProvider = null,
  conclusionConfig = {},
  cacheStore = null,
  requestEnabled = true,
  locale = "zh-CN",
  onEvent = null
} = {}) {
  if (typeof resolveRequest !== "function") throw new TypeError("runLlmRetrievalPipeline requires resolveRequest");
  const resolved = await resolveRequest(input, { catalog });
  const intentEnvelope = resolved?.intentEnvelope ?? createIntentEnvelope({
    input,
    parsed: resolved?.parsed,
    query: resolved?.query,
    validation: resolved?.validation,
    clarification: resolved?.clarification,
    catalog
  });
  emit(onEvent, { type: "intent_resolved", intent: intentEnvelope.intent, confidence: intentEnvelope.confidence });
  for (const entity of intentEnvelope.entities) {
    emit(onEvent, { type: "entity_resolved", entityType: entity.type, apiName: entity.apiName, confidence: entity.confidence });
  }
  const retrievalPlan = planner.plan(intentEnvelope);
  emit(onEvent, { type: "retrieval_plan_created", intent: retrievalPlan.intent, promptKey: retrievalPlan.promptKey });

  if (retrievalPlan.needsClarification) {
    return {
      status: "clarification",
      intentEnvelope,
      retrievalPlan,
      semanticHits: [],
      structuredResult: null,
      conclusion: { status: "skipped", reason: "intent_or_entity_error" }
    };
  }

  const semanticPromise = retrieveSemantics(retrievalPlan, semanticRetriever, onEvent);
  if (typeof retrieveStructured !== "function") throw new TypeError("runLlmRetrievalPipeline requires retrieveStructured");
  const structuredPromise = Promise.resolve(retrieveStructured({
    input,
    intentEnvelope,
    retrievalPlan,
    resolved,
    catalog
  })).then((result) => {
    emit(onEvent, { type: "structured_retrieval_completed", intent: intentEnvelope.intent });
    return result;
  }, (error) => {
    emit(onEvent, { type: "structured_retrieval_failed", intent: intentEnvelope.intent, error: error?.code ?? error?.name ?? "error" });
    throw error;
  });
  const [semanticHits, structuredResult] = await Promise.all([semanticPromise, structuredPromise]);

  if (!retrievalPlan.promptKey) {
    return {
      status: "structured_only",
      intentEnvelope,
      retrievalPlan,
      semanticHits,
      structuredResult,
      conclusion: { status: "skipped", reason: "structured_direct" }
    };
  }

  const conclusion = await generateEvidenceBackedConclusion({
    result: structuredResult,
    catalog,
    input,
    locale,
    config: { ...conclusionConfig, onEvent: conclusionConfig.onEvent ?? onEvent },
    provider: conclusionProvider,
    cacheStore,
    requestEnabled,
    retrievalPlan,
    semanticEvidence: semanticHits
  });
  return {
    status: conclusion.status === "generated" ? "generated" : "deterministic_fallback",
    intentEnvelope,
    retrievalPlan,
    semanticHits,
    structuredResult,
    conclusion
  };
}
