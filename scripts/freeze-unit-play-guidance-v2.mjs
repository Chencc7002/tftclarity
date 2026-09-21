import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { stableJson, sha256 } from "../src/experiments/unit-play-guidance-control/content.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_5_7 } from "../src/skills/definitions/unit-play-guidance.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const input = path.resolve(ROOT, process.argv.find((value) => value.startsWith("--input="))
  ?.slice("--input=".length) ?? ".cache/eval/unit-play-guidance-v2-observation-capture.json");
const outputDirectory = path.resolve(ROOT, process.argv.find((value) => value.startsWith("--output="))
  ?.slice("--output=".length) ?? "eval/skills/unit-play-guidance-forward");
const corpusPath = path.join(outputDirectory, "corpus.v2.json");
const observationsPath = path.join(outputDirectory, "tool-observations.v2.json");
const EXPERIMENT_ID = "unit-play-guidance-forward.2026-09-01.v2";
const CORPUS_VERSION = "unit-play-guidance-forward-corpus.2026-09-01.v2";
const FIXTURE_VERSION = "unit-play-guidance-forward-observations.2026-09-01.v2";
const PINNED_SKILL_HASH = "a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8";

for (const target of [corpusPath, observationsPath]) {
  try {
    await access(target);
    throw new Error(`Refusing to overwrite frozen artifact: ${target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const captureText = await readFile(input, "utf8");
const capture = JSON.parse(captureText);
if (capture.schemaVersion !== "unit-play-guidance-forward-observation-capture.v2") throw new TypeError("invalid capture schema");
if (capture.experimentId !== EXPERIMENT_ID || capture.seasonContextId !== "set18-live") throw new TypeError("capture identity drifted");
if (capture.provenance?.providerModelCalls !== 0 || capture.provenance?.registeredToolExecutorOnly !== true) {
  throw new Error("capture was not a zero-model registered-tool run");
}
const selected = capture.selection?.selected ?? [];
if (selected.length !== 10 || Object.keys(capture.units ?? {}).length !== 10) throw new Error("capture must contain exactly ten units");

const candidateSkillHash = sha256(JSON.stringify(UNIT_PLAY_GUIDANCE_SKILL_V1_5_7));
if (candidateSkillHash !== PINNED_SKILL_HASH) throw new Error("candidate Skill 1.5.7 content drifted");

for (const unit of selected) {
  const entry = capture.units?.[unit.apiName];
  const plan = entry?.unitBuilds?.value?.mechanismQueryPlan;
  const batch = entry?.itemDetailsBatch?.value;
  if (plan?.status !== "available" || plan.apiNames?.length !== 3
    || stableJson(plan.apiNames) !== stableJson(batch?.selection?.apiNames)
    || batch?.items?.length !== 3 || batch.items.some((item) => item.status !== "found")) {
    throw new Error(`incomplete official item fixture for ${unit.apiName}`);
  }
  const candidates = entry?.initialComps?.value?.results?.slice(0, 2) ?? [];
  if (candidates.length !== 2 || entry.cards?.length !== 2
    || entry.cards.some((card) => card.tacticalDetails?.value?.formation?.status !== "available"
      || card.tacticalDetails.value.formation.units?.length < 5)) {
    throw new Error(`incomplete two-card formation fixture for ${unit.apiName}`);
  }
}

const englishNames = {
  DA_18_Varus: "Varus", DA_18_Shen: "Shen", DA_18_Diana: "Diana", DA_18_Zyra: "Zyra",
  DA_18_GnarSmall: "Gnar", DA_18_Rakan: "Rakan", DA_18_LeBlanc: "LeBlanc",
  DA_18_Cassiopeia: "Cassiopeia", DA_Amumu18: "Amumu", DA_18_Kennen: "Kennen"
};

const positive = selected.flatMap((unit, index) => {
  const base = {
    unitApiName: unit.apiName,
    unitName: unit.name,
    positioningSupported: true,
    whenToPlaySupported: true,
    expectedCompositionCards: 2,
    positioningPresentation: "cards_only",
    corpusVersion: CORPUS_VERSION
  };
  const number = String(index * 3 + 1).padStart(2, "0");
  return [
    { ...base, caseId: `pos-${number}`, language: "zh-CN",
      input: `${unit.name}怎么玩？只解释英雄和推荐装备，阵容与站位用多张对应卡片展示。` },
    { ...base, caseId: `pos-${String(index * 3 + 2).padStart(2, "0")}`, language: "zh-CN",
      input: `${unit.name}的推荐装备是什么，什么时候适合玩？请给两个阵容卡片，每张带自己的站位。` },
    { ...base, caseId: `pos-${String(index * 3 + 3).padStart(2, "0")}`, language: "en",
      unitName: englishNames[unit.apiName] ?? unit.name,
      input: `How should I play ${englishNames[unit.apiName] ?? unit.name}? Explain the unit and sourced items; show two comp cards with their own positioning.` }
  ];
});

const subject = (unit, confidence = 1) => ({ rawText: unit.name, expectedType: "champion",
  resolvedId: unit.apiName, canonicalName: unit.name, confidence });
const unit = (index) => selected[index % selected.length];
const negative = [
  { input: `${unit(0).name}最强出装排名`, unitApiName: unit(0).apiName, unitName: unit(0).name, taskFrame: { goal: "unit_build_rankings" }, reason: "excluded_goal" },
  { input: `${unit(0).name}和${unit(1).name}谁更好？`, unitApiName: unit(0).apiName, unitName: unit(0).name, taskFrame: { goal: "recommend_best_option" }, reason: "excluded_goal" },
  { input: `搜索${unit(2).name}资料`, unitApiName: unit(2).apiName, unitName: unit(2).name, taskFrame: { action: "search" }, reason: "wrong_action" },
  { input: "解释装备机制", taskFrame: { action: "explain", goal: "explain_item_mechanism", expectedOutput: ["mechanism_explanation"] }, reason: "different_goal" },
  { input: "推荐一个阵容", taskFrame: { goal: "recommend_composition", expectedOutput: ["composition_recommendation"] }, reason: "different_goal" },
  { input: "找一个教学视频", taskFrame: { action: "find_video", goal: "find_video", expectedOutput: ["video"] }, reason: "wrong_action" },
  { input: "总结这段对局", taskFrame: { action: "summarize", goal: "summarize_match", expectedOutput: ["summary"] }, reason: "different_goal" },
  { input: "分析当前局势", taskFrame: { action: "analyze", goal: "analyze_game_state", expectedOutput: ["analysis"] }, reason: "different_goal" },
  { input: `${unit(3).name}技能是什么？`, unitApiName: unit(3).apiName, unitName: unit(3).name, taskFrame: { action: "explain", goal: "explain_unit_ability", expectedOutput: ["ability_explanation"] }, reason: "wrong_action" },
  { input: "装备合成表", taskFrame: { action: "search", goal: "search_item_recipe", expectedOutput: ["item_recipe"] }, reason: "different_goal" },
  { input: `现实中的${unit(4).name}怎么玩？`, unitApiName: unit(4).apiName, unitName: unit(4).name, taskFrame: { domain: "out_of_domain", understandingStatus: "out_of_domain" }, reason: "wrong_domain" },
  { input: `${unit(5).name}怎么玩？`, unitApiName: unit(5).apiName, unitName: unit(5).name, taskFrame: { expectedOutput: ["unit_build_statistics"] }, reason: "wrong_output" },
  { input: "这个英雄怎么玩？", taskFrame: { subjects: [{ rawText: "这个英雄", expectedType: "champion", resolvedId: null, confidence: 0.2 }] }, reason: "unresolved_entity" },
  { input: `${unit(6).name}和${unit(7).name}分别怎么玩？`, taskFrame: { subjects: [subject(unit(6)), subject(unit(7))] }, reason: "multiple_entities" },
  { input: "离子火花怎么玩？", taskFrame: { subjects: [{ rawText: "离子火花", expectedType: "item", resolvedId: "DA_IonicSpark", confidence: 1 }] }, reason: "wrong_entity_type" },
  { input: "某羁绊怎么玩？", taskFrame: { subjects: [{ rawText: "某羁绊", expectedType: "trait", resolvedId: "DA_18_TestTrait", confidence: 1 }] }, reason: "wrong_entity_type" },
  { input: "某阵容怎么玩？", taskFrame: { subjects: [{ rawText: "某阵容", expectedType: "composition", resolvedId: "cluster:test", confidence: 1 }] }, reason: "wrong_entity_type" },
  { input: `${unit(8).name}补丁改动`, unitApiName: unit(8).apiName, unitName: unit(8).name, taskFrame: { action: "summarize", goal: "summarize_patch", expectedOutput: ["patch_summary"] }, reason: "different_goal" },
  { input: "按胜率排列所有单位", taskFrame: { action: "rank", goal: "rank_units", expectedOutput: ["unit_rankings"] }, reason: "wrong_action" },
  { input: "解释经济运营", taskFrame: { action: "explain", goal: "explain_economy", expectedOutput: ["economy_explanation"] }, reason: "different_goal" }
].map((entry, index) => ({ ...entry, caseId: `neg-${String(index + 1).padStart(2, "0")}`,
  expectedExclusionReason: entry.reason, corpusVersion: CORPUS_VERSION, reason: undefined }));

const boundary = [
  { input: `${unit(0).name}还是那个怎么玩？`, unitApiName: unit(0).apiName, unitName: unit(0).name, taskFrame: { understandingStatus: "ambiguous" }, reason: "ambiguous" },
  { input: "她怎么玩？", taskFrame: { understandingStatus: "understood_but_missing_context" }, reason: "missing_context" },
  { input: "未知赛季单位怎么玩？", taskFrame: { understandingStatus: "understood_but_unsupported" }, reason: "unsupported" },
  { input: `现实中的${unit(1).name}怎么玩？`, unitApiName: unit(1).apiName, unitName: unit(1).name, taskFrame: { domain: "out_of_domain", understandingStatus: "out_of_domain" }, reason: "out_of_domain" },
  { input: `${unit(2).name}怎么玩，参考刚才没提供的阵容？`, unitApiName: unit(2).apiName, unitName: unit(2).name, taskFrame: { ambiguities: [{ code: "missing_context_reference", affectsResult: true }] }, reason: "blocking_ambiguity" },
  { input: `${unit(3).name}还是${unit(4).name}怎么玩？`, taskFrame: { subjects: [subject(unit(3), 0.5), subject(unit(4), 0.5)], ambiguities: [{ code: "multiple_unit_candidates", affectsToolSelection: true }] }, reason: "blocking_ambiguity" },
  { input: "这个单位怎么玩？", taskFrame: { subjects: [{ rawText: "这个单位", expectedType: "champion", resolvedId: null, confidence: 0.1 }], ambiguities: [{ code: "unresolved_subject", affectsResult: true }] }, reason: "blocking_ambiguity" },
  { input: `${unit(5).name}怎么玩，数据源不确定？`, unitApiName: unit(5).apiName, unitName: unit(5).name, taskFrame: { ambiguities: [{ code: "source_scope_unclear", affectsToolSelection: true }] }, reason: "blocking_ambiguity" },
  { input: `上一局的${unit(6).name}怎么玩？`, unitApiName: unit(6).apiName, unitName: unit(6).name, taskFrame: { understandingStatus: "understood_but_missing_context" }, reason: "historical_context_missing" },
  { input: `${unit(7).name}怎么玩但我不知道是哪套规则？`, unitApiName: unit(7).apiName, unitName: unit(7).name, taskFrame: { ambiguities: [{ code: "ruleset_ambiguous", affectsResult: true }] }, reason: "blocking_ambiguity" }
].map((entry, index) => ({ ...entry, caseId: `bnd-${String(index + 1).padStart(2, "0")}`,
  expectedExclusionReason: entry.reason, corpusVersion: CORPUS_VERSION, reason: undefined }));

const diagnosticDisclosure = {
  formalPairResultsObservedBeforeFreeze: false,
  priorNonFormalHttpDiagnosticsObserved: true,
  diagnosticScope: "two Warwick localhost HTTP requests for candidate 1.5.7",
  populationSelectedIndependently: "ten units selected by predeclared SHA-256 round-robin across costs",
  claimBoundary: "forward evaluation; not a pristine pre-candidate corpus"
};
const corpus = {
  schemaVersion: "unit-play-guidance-forward-corpus.v2",
  experimentId: EXPERIMENT_ID,
  corpusVersion: CORPUS_VERSION,
  frozenAt: capture.capturedAt,
  frozenBeforeFormalPairedResults: true,
  diagnosticDisclosure,
  positive,
  negative,
  boundary,
  defaults: {
    expectedEligibility: false,
    positiveExpectedEligibility: true,
    expectedTaskFramePredicate: { domain: "tft", action: "recommend", goal: "recommend_unit_play",
      understandingStatus: "understood_and_supported", resolvedChampionCount: 1 }
  }
};

const observations = {
  schemaVersion: "unit-play-guidance-forward-tool-observations.v2",
  experimentId: EXPERIMENT_ID,
  fixtureVersion: FIXTURE_VERSION,
  frozenAt: capture.capturedAt,
  seasonContextId: capture.seasonContextId,
  sourceCaptureSha256: sha256(JSON.parse(captureText)),
  candidateSkill: { id: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.id, version: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.version,
    contentSha256: candidateSkillHash },
  provenance: capture.provenance,
  selection: capture.selection,
  units: Object.fromEntries(selected.map((unit) => [unit.apiName, capture.units[unit.apiName]]))
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`, { flag: "wx" });
await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({
  corpusPath, observationsPath,
  corpusNormalizedSha256: sha256(corpus),
  observationNormalizedSha256: sha256(observations),
  candidateSkillHash,
  counts: { positive: positive.length, negative: negative.length, boundary: boundary.length, units: selected.length }
}, null, 2));
