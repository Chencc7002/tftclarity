import { createTaskFrame } from "../../src/understanding/task-frame.js";

export const PHASE5_CAPABILITY_DATASET_VERSION = "capability-planning-phase5.v1";

function entity(rawText, expectedType, resolvedId) {
  return { rawText, expectedType, resolvedId, confidence: 1 };
}
function frame(value = {}) {
  return createTaskFrame({
    domain: "tft",
    action: value.action,
    subjects: value.subjects ?? [],
    candidates: value.candidates ?? [],
    concepts: value.concepts ?? [],
    constraints: value.constraints ?? {},
    goal: value.goal,
    expectedOutput: value.expectedOutput ?? ["evidence"],
    confidence: 0.95,
    understandingStatus: "understood_and_supported"
  });
}

const champion = entity("霞", "champion", "TFT17_Xayah");
const itemA = entity("羊刀", "item", "TFT_Item_GuinsoosRageblade");
const itemB = entity("无尽", "item", "TFT_Item_InfinityEdge");
const composition = entity("星界霞", "composition", "comp:stargazer-xayah");
const concept = entity("九五", "game_concept", "game_concept:fast9");
const patch = entity("17.7", "patch", "17.7");
const trait = entity("观星者", "trait", "TFT17_Stargazer");

export function buildPhase5CapabilityCases() {
  const cases = [];
  const addGroup = (name, count, taskFrame, expectedTool) => {
    for (let index = 0; index < count; index += 1) {
      cases.push({
        id: `${name}-${index + 1}`,
        group: name,
        taskFrame: typeof taskFrame === "function" ? taskFrame(index) : taskFrame,
        expectedTool
      });
    }
  };
  addGroup("item_recommend", 20, frame({
    action: "recommend",
    subjects: [champion],
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "evidence"]
  }), "unit_builds");
  addGroup("item_compare", 20, frame({
    action: "compare",
    subjects: [champion],
    candidates: [itemA, itemB],
    goal: "choose_best",
    expectedOutput: ["recommendation", "comparison", "evidence"]
  }), "unit_builds");
  addGroup("comp_rank", 20, frame({
    action: "rank",
    concepts: [composition],
    goal: "rank_options",
    expectedOutput: ["ranking", "evidence"]
  }), "comps_rankings");
  addGroup("comp_trend", 20, frame({
    action: "analyze",
    concepts: [composition],
    constraints: { trend: "up" },
    goal: "analyze_evidence",
    expectedOutput: ["analysis", "evidence"]
  }), "comps_trends");
  addGroup("comp_recommend", 20, frame({
    action: "recommend",
    concepts: [composition],
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "ranking", "evidence"]
  }), "comps_rankings");
  addGroup("concept_to_comp", 20, frame({
    action: "recommend",
    concepts: [concept],
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "composition_candidates", "evidence"]
  }), "semantic_search");
  addGroup("patch_explain", 20, frame({
    action: "explain",
    concepts: [patch],
    constraints: { patch: "17.7" },
    goal: "explain_concept_or_entity",
    expectedOutput: ["explanation", "evidence"]
  }), "semantic_search");
  addGroup("entity_details", 30, (index) => {
    const values = [
      { value: champion, tool: "unit_details" },
      { value: itemA, tool: "item_details" },
      { value: trait, tool: "trait_details" }
    ][index % 3];
    return {
      ...frame({
        action: "explain",
        subjects: [values.value],
        goal: "explain_concept_or_entity",
        expectedOutput: ["explanation", "evidence"]
      }),
      __expectedTool: values.tool
    };
  }, null);
  for (const testCase of cases.filter((entry) => entry.group === "entity_details")) {
    testCase.expectedTool = testCase.taskFrame.__expectedTool;
    delete testCase.taskFrame.__expectedTool;
  }
  addGroup("strategy_video", 10, frame({
    action: "find_video",
    subjects: [champion],
    goal: "find_strategy_video",
    expectedOutput: ["video_candidates", "evidence"]
  }), "strategy_video_search");
  return cases;
}

export function buildPhase5CompositeCases() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `composite-${index + 1}`,
    taskFrame: frame({
      action: "recommend",
      subjects: [champion],
      concepts: [composition],
      goal: "recommend_best_option",
      expectedOutput: ["composition_candidates", "recommendation", "evidence"]
    }),
    expectedTools: ["unit_comp_candidates", "unit_builds"]
  }));
}
