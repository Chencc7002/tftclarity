import { linkEntityMention } from "../src/understanding/entity-linker.js";
import {
  buildPhase3EntityCases,
  createPhase3EvaluationCatalog,
  PHASE3_ENTITY_DATASET_VERSION
} from "./datasets/entity-linking-phase3-cases.mjs";

export const PHASE3_EVALUATION_VERSION = "entity-linker-phase3.v1";

export async function runPhase3Evaluation(options = {}) {
  const catalog = options.catalog ?? createPhase3EvaluationCatalog();
  const cases = options.cases ?? buildPhase3EntityCases();
  const results = [];
  for (const testCase of cases) {
    const linked = await (options.linker ?? linkEntityMention)({
      rawText: testCase.mention,
      expectedType: testCase.type
    }, {
      catalog,
      patch: "17.7",
      semanticRetriever: options.semanticRetriever,
      candidateReranker: options.candidateReranker
    });
    const candidateIds = linked.candidates.map((candidate) => candidate.id);
    results.push({
      id: testCase.id,
      group: testCase.group,
      mention: testCase.mention,
      type: testCase.type,
      expectedId: testCase.expectedId,
      actual: {
        resolvedId: linked.resolvedId,
        source: linked.source,
        confidence: linked.confidence,
        candidateIds
      },
      passed: testCase.group === "nonexistent"
        ? linked.resolvedId === null
        : testCase.group === "alias"
          ? candidateIds.slice(0, 3).includes(testCase.expectedId)
          : linked.resolvedId === testCase.expectedId
    });
  }

  const groups = Object.fromEntries(["core", "alias", "concept", "nonexistent"].map((group) => [
    group,
    results.filter((result) => result.group === group)
  ]));
  const ratio = (values, predicate) => values.length
    ? values.filter(predicate).length / values.length
    : 1;
  const metrics = {
    total: results.length,
    coreTotal: groups.core.length,
    coreTop1Correct: groups.core.filter((result) => result.passed).length,
    coreTop1Accuracy: ratio(groups.core, (result) => result.passed),
    aliasTotal: groups.alias.length,
    aliasTop3Correct: groups.alias.filter((result) => result.passed).length,
    aliasTop3Recall: ratio(groups.alias, (result) => result.passed),
    conceptTotal: groups.concept.length,
    conceptCorrect: groups.concept.filter((result) => result.passed).length,
    conceptAccuracy: ratio(groups.concept, (result) => result.passed),
    nonexistentTotal: groups.nonexistent.length,
    nonexistentFalseHits: groups.nonexistent.filter((result) => result.actual.resolvedId !== null).length,
    nonexistentFalseHitRate: ratio(groups.nonexistent, (result) => result.actual.resolvedId !== null)
  };
  const gates = {
    coreTop1: metrics.coreTop1Accuracy >= 0.97,
    aliasTop3: metrics.aliasTop3Recall >= 0.98,
    nonexistentFalseHit: metrics.nonexistentFalseHitRate < 0.02,
    conceptsReusable: metrics.conceptAccuracy === 1
  };
  return {
    evaluationVersion: PHASE3_EVALUATION_VERSION,
    datasetVersion: PHASE3_ENTITY_DATASET_VERSION,
    passed: Object.values(gates).every(Boolean),
    gates,
    metrics,
    results
  };
}
