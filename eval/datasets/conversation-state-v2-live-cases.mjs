import {
  createConversationState,
  createTaskFrame
} from "../../src/index.js";

export const CONVERSATION_STATE_V2_LIVE_DATASET_VERSION = "conversation-state-v2-live.v1";

function entity(rawText, expectedType, resolvedId = null) {
  return {
    rawText,
    expectedType,
    resolvedId,
    confidence: resolvedId ? 1 : null
  };
}

function unitFrame(unit = "TFT17_Xayah", constraints = {}) {
  return createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    subjects: [entity(unit === "TFT17_Xayah" ? "霞" : "卡莎", "champion", unit)],
    constraints,
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function compFrame(constraints = {}) {
  return createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { limit: 3, ...constraints },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function result(resultType, toolName, shownIds, totalCount, appliedConstraints = {}) {
  return {
    resultType,
    toolName,
    shownIds,
    returnedCount: shownIds.length,
    totalCount,
    cursor: null,
    exhausted: totalCount != null && shownIds.length >= totalCount,
    appliedConstraints,
    updatedAt: "2026-07-27T00:00:00.000Z"
  };
}

function activeState(frame, lastResult = null, extra = {}) {
  return createConversationState({
    activeTask: {
      taskFrame: frame,
      legacyIntent: frame.goal,
      updatedAt: "2026-07-27T00:00:00.000Z"
    },
    lastResult,
    seasonContextId: "set17-live",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...extra
  });
}

const rerollFrame = compFrame({ strategy: "reroll" });
const xayahFrame = unitFrame();
const ordinaryCompState = activeState(
  compFrame({ metrics: ["popularity"] }),
  result("comp_rankings", "comps_rankings", ["comp-a", "comp-b"], 8, {
    metrics: ["popularity"]
  })
);
const rerollCompState = activeState(
  rerollFrame,
  result("comp_rankings", "comps_rankings", ["comp-a", "comp-b", "comp-c"], 7, {
    strategy: "reroll"
  })
);
const exhaustedCompState = activeState(
  rerollFrame,
  result("comp_rankings", "comps_rankings", ["comp-a", "comp-b", "comp-c"], 3, {
    strategy: "reroll"
  })
);
const unitState = activeState(
  xayahFrame,
  result("unit_build_rankings", "unit_builds", ["build-a", "build-b"], 6)
);
const switchedState = activeState(compFrame(), null, {
  taskHistory: [{
    taskFrame: xayahFrame,
    legacyIntent: xayahFrame.goal,
    lastResult: result("unit_build_rankings", "unit_builds", ["build-a"], 5),
    updatedAt: "2026-07-27T00:00:00.000Z"
  }]
});
const pendingState = createConversationState({
  pendingClarification: {
    reason: "missing_subject",
    expectedFields: ["subjects"],
    candidateTask: {
      taskFrame: createTaskFrame({
        action: "recommend",
        goal: "unit_build_rankings",
        confidence: 0.4,
        understandingStatus: "understood_but_missing_context",
        ambiguities: [{ code: "missing_subject", missingFields: ["subjects"] }]
      })
    },
    askedAt: "2026-07-27T00:00:00.000Z"
  },
  seasonContextId: "set17-live"
});

export function buildConversationStateV2LiveCases() {
  return [
    {
      id: "request-more",
      category: "continue",
      inputs: ["还有其他选择吗", "麻烦再展示一些", "下一组也发我看看"],
      state: ordinaryCompState,
      expected: {
        relations: ["continue"],
        dialogueActs: ["request_more", "next_page"],
        decision: "execute",
        tool: "comps_rankings",
        frame: { action: "rank", strategy: null },
        presentation: { avoidSeen: true }
      }
    },
    {
      id: "request-more-exhausted",
      category: "exhausted",
      inputs: ["这类方案还能接着看吗", "再翻一页试试", "继续给我后面的"],
      state: exhaustedCompState,
      expected: {
        relations: ["continue"],
        dialogueActs: ["request_more", "next_page"],
        decision: "exhausted",
        tool: null,
        frame: { action: "rank", strategy: "reroll" }
      }
    },
    {
      id: "add-rank-condition",
      category: "add-condition",
      inputs: ["范围收紧到大师及以上", "只统计宗师大师和王者", "段位门槛改成大师起步"],
      state: rerollCompState,
      expected: {
        relations: ["modify"],
        dialogueActs: ["modify"],
        decision: "execute",
        tool: "comps_rankings",
        frame: {
          strategy: "reroll",
          rank: ["MASTER", "GRANDMASTER", "CHALLENGER"]
        },
        arguments: {
          strategy: "reroll",
          rank: ["MASTER", "GRANDMASTER", "CHALLENGER"]
        }
      }
    },
    {
      id: "remove-strategy-condition",
      category: "remove-condition",
      inputs: ["把低费追三这个限制拿掉", "不限定运营方式了", "清除刚才的赌狗条件"],
      state: rerollCompState,
      expected: {
        relations: ["modify"],
        dialogueActs: ["modify", "reject"],
        decision: "execute",
        tool: "comps_rankings",
        frame: { strategy: null },
        arguments: { strategy: null }
      }
    },
    {
      id: "replace-subject",
      category: "replace-condition",
      inputs: ["同样的问题改查卡莎", "主角从霞换成卡莎", "别看霞了，换卡莎的出装"],
      state: unitState,
      expected: {
        relations: ["modify"],
        dialogueActs: ["modify"],
        decision: "execute",
        tool: "unit_builds",
        frame: { unit: "TFT17_Kaisa" },
        arguments: { unit: "TFT17_Kaisa" }
      }
    },
    {
      id: "switch-task",
      category: "switch",
      inputs: ["先不看英雄了，改看阵容排行", "切到热门阵容这个任务", "出装放一放，给我阵容榜"],
      state: unitState,
      expected: {
        relations: ["switch"],
        dialogueActs: ["switch_task"],
        decision: "execute",
        tool: "comps_rankings",
        frame: { action: "rank" }
      }
    },
    {
      id: "return-task",
      category: "return",
      inputs: ["回到刚才霞的出装", "继续之前那个霞装备任务", "阵容先停，恢复前面的霞"],
      state: switchedState,
      expected: {
        relations: ["return"],
        dialogueActs: ["continue", "switch_task"],
        decision: "execute",
        tool: "unit_builds",
        frame: { unit: "TFT17_Xayah" },
        arguments: { unit: "TFT17_Xayah" }
      }
    },
    {
      id: "fill-clarification",
      category: "clarification",
      inputs: ["英雄是霞", "我指的是逆羽", "补充一下，要查霞"],
      state: pendingState,
      expected: {
        relations: ["modify", "continue"],
        dialogueActs: ["clarify", "modify", "continue"],
        decision: "execute",
        tool: "unit_builds",
        frame: { unit: "TFT17_Xayah" },
        arguments: { unit: "TFT17_Xayah" }
      }
    },
    {
      id: "cancel-task",
      category: "cancel",
      inputs: ["这个任务不用做了", "先取消当前查询", "到这里就停吧"],
      state: unitState,
      expected: {
        relations: ["cancel"],
        dialogueActs: ["cancel"],
        decision: "cancelled",
        tool: null,
        frame: null
      }
    }
  ].map((entry) => structuredClone(entry));
}
