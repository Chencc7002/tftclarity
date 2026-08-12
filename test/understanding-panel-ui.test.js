import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildDecisionAuditPayload,
  buildUnderstandingSummary,
  formatProcessingDuration,
  formatDecisionAuditPayload,
  renderUnderstandingPanel
} from "../src/app/small-window-ui/understanding-panel.js";

function entity(rawText, expectedType, resolvedId = null) {
  return { rawText, expectedType, resolvedId, confidence: 1 };
}

function firstTurnPayload() {
  const taskFrame = {
    schemaVersion: "task-frame.v1",
    action: "recommend",
    goal: "comp_rankings",
    subjects: [],
    candidates: [],
    concepts: [],
    constraints: {
      limit: 3,
      strategy: "fast8",
      contested: false,
      sort: "robust_first",
      excludedItems: [entity("暴风大剑", "item", "TFT_Item_BFSword")]
    },
    assumptions: [],
    ambiguities: []
  };
  return {
    mode: "hybrid",
    conversation: {
      stateVersion: "conversation-state.v2",
      delta: {
        schemaVersion: "turn-delta.v1",
        dialogueAct: "start_task",
        taskRelation: "new",
        explicitTaskFrame: taskFrame,
        entityOperations: [],
        constraintOperations: [],
        presentation: { requestedCount: 3, pageDirection: null, avoidSeen: false },
        ambiguities: []
      },
      resolution: {
        schemaVersion: "context-reducer.v2",
        decision: "execute",
        resolvedTaskFrame: taskFrame,
        inheritedFields: [],
        changedFields: ["activeTask"],
        warnings: []
      },
      providerFallback: null
    },
    answerModeRoute: {
      schemaVersion: "answer_mode_route.v1",
      mode: "hybrid",
      structuredOperations: ["comp_rankings"],
      retrievalScopes: ["current_stats", "video_guides", "mechanism_knowledge"],
      authority: {
        currentStatistics: "metatft",
        creatorAdvice: "youtube",
        videoMayOverrideCurrentStatistics: false
      },
      reasonCodes: ["structured_signal", "knowledge_signal"]
    },
    agent: {
      executionPlan: {
        schemaVersion: "execution-plan.v1",
        route: "deterministic_fast_path",
        steps: [{ id: "step-1", tool: "comps_rankings", arguments: {} }]
      }
    },
    prompt: "must never be exposed",
    providerRawResponse: { hidden: true }
  };
}

test("result audit stays structured while chat uses a lightweight prose trace", () => {
  const html = renderUnderstandingPanel(firstTurnPayload(), { locale: "zh-CN" });
  const chatHtml = renderUnderstandingPanel(firstTurnPayload(), {
    locale: "zh-CN",
    surface: "chat",
    traceState: {
      phase: "understanding.resolved",
      startedAt: 1_000
    },
    now: 4_500
  });
  const progressiveHtml = renderUnderstandingPanel(firstTurnPayload(), {
    locale: "zh-CN",
    surface: "chat",
    open: true,
    traceState: {
      phase: "plan.ready",
      startedAt: 1_000
    },
    now: 4_500
  });

  assert.match(html, /^<details class="understanding-panel">/);
  assert.match(chatHtml, /^<details class="reasoning-trace chat-understanding-panel">/);
  assert.match(progressiveHtml, /^<details class="reasoning-trace chat-understanding-panel" open>/);
  assert.doesNotMatch(html, /<details class="understanding-panel" open>/);
  assert.match(html, /我是这样理解你的问题的/);
  assert.match(html, /你想做什么/);
  assert.match(html, /我识别到的条件/);
  assert.match(html, /我准备查询什么/);
  assert.match(html, /哪些地方存在不确定性/);
  assert.match(html, /推荐当前版本的阵容/);
  assert.match(html, /稳定性优先/);
  assert.match(html, /优先较低竞争度/);
  assert.match(html, /暴风大剑/);
  assert.match(html, /根据出场率判断阵容竞争程度/);
  assert.match(html, /检查核心装备并应用装备限制/);
  assert.match(html, /保留最符合条件的 3 个结果/);
  assert.match(html, /current_stats/);
  assert.match(html, /视频攻略与运营解释/);
  assert.match(html, />hybrid</);
  assert.match(chatHtml, /处理中/);
  assert.match(chatHtml, /<time data-processing-elapsed>3s<\/time>/);
  assert.match(chatHtml, /我理解到/);
  assert.match(chatHtml, /我识别到的条件是/);
  assert.doesNotMatch(chatHtml, /我准备查询什么|哪些地方存在不确定性|understanding-body/);
  assert.doesNotMatch(chatHtml, /查询 MetaTFT 当前阵容排名与稳定性/);
  assert.match(progressiveHtml, /接下来我会/);
  assert.match(progressiveHtml, /查询 MetaTFT 当前阵容排名与稳定性/);
  assert.doesNotMatch(html, /must never be exposed|providerRawResponse|完整 Prompt|思维链/);
  assert.doesNotMatch(chatHtml, /must never be exposed|providerRawResponse|完整 Prompt|思维链/);
});

test("completed chat trace collapses to processed duration and keeps its audit prose expandable", () => {
  const html = renderUnderstandingPanel(firstTurnPayload(), {
    locale: "zh-CN",
    surface: "chat",
    completed: true,
    traceState: {
      phase: "complete",
      startedAt: 1_000,
      completedAt: 14_500
    }
  });

  assert.match(html, /^<details class="reasoning-trace chat-understanding-panel">/);
  assert.doesNotMatch(html, /<details[^>]+ open>/);
  assert.match(html, /已处理/);
  assert.match(html, /<time data-processing-elapsed>13s<\/time>/);
  assert.match(html, /查询与整理已经完成/);
  assert.equal(formatProcessingDuration(14_256_000), "3h 57m 36s");
});

test("chat trace renders the real Agent tool and evidence event timeline", () => {
  const html = renderUnderstandingPanel(firstTurnPayload(), {
    locale: "zh-CN",
    surface: "chat",
    open: true,
    traceState: {
      phase: "evidence_added",
      startedAt: 1_000,
      events: [
        { phase: "run_started", data: {} },
        { phase: "decision", data: { type: "call_tool", tool: "comps_rankings", iteration: 1 } },
        { phase: "tool_started", data: { tool: "comps_rankings" } },
        { phase: "tool_completed", data: { tool: "comps_rankings" } },
        { phase: "evidence_added", data: { tool: "comps_rankings" } }
      ]
    },
    now: 4_500
  });

  assert.match(html, /class="agent-status-timeline"/);
  assert.match(html, /第 1 轮：决定调用阵容排行数据/);
  assert.match(html, /正在调用阵容排行数据/);
  assert.match(html, /阵容排行数据调用完成/);
  assert.match(html, /已验证并加入阵容排行数据证据/);
  assert.doesNotMatch(html, /我正在识别你的目标、限制条件和上下文引用/);
});

test("multi-turn summary identifies the previous task, current delta, and preserved conditions", () => {
  const data = firstTurnPayload();
  data.conversation.delta = {
    schemaVersion: "turn-delta.v1",
    dialogueAct: "modify",
    taskRelation: "modify",
    explicitTaskFrame: null,
    entityOperations: [],
    constraintOperations: [{
      operation: "add",
      field: "excludedItems",
      value: [entity("暴风大剑", "item", "TFT_Item_BFSword")]
    }],
    presentation: { requestedCount: null, pageDirection: null, avoidSeen: false },
    ambiguities: []
  };
  data.conversation.resolution.resolvedTaskFrame.contextReferences = [{
    type: "composition",
    sourceTurn: 0,
    fields: ["activeTask"]
  }];
  data.conversation.resolution.inheritedFields = ["activeTask", "constraints.sort"];

  const summary = buildUnderstandingSummary(data, { locale: "zh-CN" });
  const html = renderUnderstandingPanel(data, { locale: "zh-CN" });

  assert.equal(summary.what.find((entry) => entry.label === "本轮关系")?.value, "修改上一轮任务");
  assert.equal(summary.what.find((entry) => entry.label === "引用对象")?.value, "上一轮结果（第 1 轮）");
  assert.deepEqual(summary.changes, ["新增排除装备: 暴风大剑"]);
  assert.equal(summary.preserved, true);
  assert.match(html, /本轮变化/);
  assert.match(html, /其余上一轮条件继续保留/);
});

test("multi-turn summary names an ordinal result reference without exposing internal ids", () => {
  const data = firstTurnPayload();
  data.conversation.delta.taskRelation = "modify";
  data.conversation.delta.dialogueAct = "modify";
  data.conversation.delta.explicitTaskFrame = null;
  data.conversation.delta.presentation.resultReference = {
    scope: "last_result",
    ordinal: 2
  };
  data.conversation.resolution.resultReference = {
    scope: "last_result",
    ordinal: 2,
    resultId: "internal-comp-id"
  };
  data.conversation.resolution.resolvedTaskFrame.constraints.avoidItemComponents = [
    "TFT_Item_BFSword",
    {
      ...entity("大剑", "item", "TFT_Item_BFSword"),
      canonicalName: "大剑"
    }
  ];
  data.conversation.resolution.resolvedTaskFrame.constraints.comp = {
    rawText: "result 2",
    expectedType: "composition",
    resolvedId: "internal-comp-id",
    confidence: 1,
    source: "conversation_result_reference"
  };

  const html = renderUnderstandingPanel(data, { locale: "zh-CN" });

  assert.match(html, /上一轮结果中的第 2 套/u);
  assert.match(html, /尽量少用的散件/u);
  assert.match(html, /大剑/u);
  assert.doesNotMatch(html, /TFT_Item_BFSword|result 2/u);
  assert.doesNotMatch(html, /internal-comp-id/u);
});

test("developer audit projection exposes only bounded structured decision records", () => {
  const data = firstTurnPayload();
  const audit = buildDecisionAuditPayload(data);
  const formatted = formatDecisionAuditPayload(data);

  assert.equal(audit.schemaVersion, "decision-audit-view.v1");
  assert.equal(audit.stateVersion, "conversation-state.v2");
  assert.equal(audit.taskFrame.goal, "comp_rankings");
  assert.equal(audit.turnDelta.taskRelation, "new");
  assert.equal(audit.executionPlan.steps[0].tool, "comps_rankings");
  assert.equal(audit.answerMode.mode, "hybrid");
  assert.ok(formatted);
  assert.doesNotMatch(formatted, /must never be exposed|providerRawResponse|assistantResponse|prompt/i);
  assert.deepEqual(Object.keys(audit), [
    "schemaVersion",
    "stateVersion",
    "taskFrame",
    "turnDelta",
    "resolution",
    "executionPlan",
    "answerMode",
    "providerFallback"
  ]);
});

test("legacy-mode progress envelope renders preference conditions before retrieval", () => {
  const html = renderUnderstandingPanel({
    intentEnvelope: {
      schemaVersion: "intent_envelope.v1",
      intent: "comp_rankings",
      entities: [{
        type: "item",
        apiName: "TFT_Item_BFSword",
        canonicalName: "暴风大剑"
      }],
      constraints: {
        limit: 3,
        sort: "robust_first",
        reroll: false,
        goal: "top4",
        contested: "low",
        avoidItemComponents: ["TFT_Item_BFSword"]
      },
      needsClarification: false,
      warnings: []
    },
    answerModeRoute: firstTurnPayload().answerModeRoute
  }, {
    locale: "zh-CN",
    surface: "chat",
    open: true
  });

  assert.match(html, /推荐当前版本的阵容/);
  assert.match(html, /排除赌狗阵容/);
  assert.match(html, /稳定前四/);
  assert.match(html, /竞争度/);
  assert.match(html, /尽量少用的散件/);
  assert.match(html, /暴风大剑/);
  assert.doesNotMatch(html, /候选对象[^<]*暴风大剑/);
});

test("UI renders the audit panel before the chat answer and keeps the result pane focused on evidence", () => {
  const app = readFileSync(
    new URL("../src/app/small-window-ui/app.js", import.meta.url),
    "utf8"
  );
  const styles = readFileSync(
    new URL("../src/app/small-window-ui/styles.css", import.meta.url),
    "utf8"
  );
  const i18n = readFileSync(
    new URL("../src/app/small-window-ui/i18n.js", import.meta.url),
    "utf8"
  );

  assert.match(app, /const understanding = renderUnderstandingPanel\(data, \{[\s\S]*?surface: "chat"[\s\S]*?\}\)/);
  assert.match(app, /return `\$\{understanding\}\$\{chatCoreConclusionHtml/);
  assert.doesNotMatch(app, /insertAdjacentHTML\("(?:afterbegin|afterend)", understandingHtml\)/);
  assert.match(app, /formatDecisionAuditPayload\(data\)/);
  assert.match(app, /const endpoint = state\.lastQuickTask \|\| !reactChatEnabled[\s\S]*?"\/api\/recommend\/stream"[\s\S]*?"\/api\/react-chat\/stream"/);
  assert.match(app, /fetch\(endpoint/);
  assert.match(app, /readRecommendationStream\(/);
  assert.match(app, /recommendationProgressHtml\(/);
  assert.match(app, /understandingOpen: currentPanel \? currentPanel\.hasAttribute\("open"\) : true/);
  assert.doesNotMatch(app, /progressTimers|setTimeout\(\(\) => updateProgress/);
  assert.match(styles, /\.understanding-panel/);
  assert.match(styles, /\.understanding-body/);
  assert.match(styles, /\.chat-understanding-panel/);
  assert.match(styles, /\.reasoning-trace/);
  assert.match(styles, /\.reasoning-trace-body p/);
  assert.doesNotMatch(styles, /\.recommendation-progress/);
  assert.doesNotMatch(styles, /\.understanding-progress-placeholder/);
  assert.match(app, /startRecommendationProgressClock\(assistantTarget, recommendationProgress\)/);
  assert.match(app, /completeRecommendationProgress\(recommendationProgress, data\)/);
  assert.match(i18n, /结构化决策 JSON（开发）/);
  assert.match(i18n, /Structured decision JSON \(developer\)/);
});
