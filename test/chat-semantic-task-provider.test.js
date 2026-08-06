import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_SEMANTIC_TASK_PROMPT_VERSION,
  createChatSemanticTaskProvider
} from "../src/llm/chat-semantic-task-provider.js";
import { tftConversationPolicy } from "../src/domain/tft/conversation-policy.js";

const validFrame = {
  schemaVersion: "task-frame.v1",
  domain: "tft",
  action: "recommend",
  subjects: [{ rawText: "霞", expectedType: "champion", resolvedId: null, confidence: 0.95 }],
  candidates: [],
  concepts: [],
  constraints: {},
  goal: "recommend_items",
  expectedOutput: ["recommendation"],
  contextReferences: [],
  ambiguities: [],
  assumptions: [],
  confidence: 0.95,
  understandingStatus: "understood_and_supported"
};

test("chat semantic task provider validates raw TaskFrame and maps provider usage", async () => {
  let observedBody;
  let requestLog;
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    apiKey: "secret",
    fetchImpl: async (_url, init) => {
      observedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(validFrame)}\n\`\`\`` } }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 20 }
          }
        })
      };
    },
    onRequestLog: (value) => {
      requestLog = value;
    }
  });
  const result = await provider({
    messages: [{ role: "user", content: "霞怎么出装" }],
    budget: { maxOutputTokens: 300 }
  });

  assert.equal(LIVE_SEMANTIC_TASK_PROMPT_VERSION, "live-semantic-task-contract.v12");
  assert.equal(observedBody.response_format.type, "json_object");
  assert.equal(observedBody.max_tokens, 300);
  assert.deepEqual(result.taskFrame, {
    ...validFrame,
    capabilityRequirements: []
  });
  assert.deepEqual(result.usage, {
    cachedInputTokens: 20,
    uncachedInputTokens: 100,
    outputTokens: 40
  });
  assert.equal(requestLog.status, "ok");
  assert.equal(requestLog.firstTokenMeasurement, "unavailable_non_streaming");
  assert.equal(requestLog.retryCount, 0);
});

test("chat semantic task provider rejects invalid raw output before normalization", async () => {
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ action: "recommend" }) } }]
      })
    })
  });

  await assert.rejects(
    () => provider({ messages: [], budget: { maxOutputTokens: 300 } }),
    /invalid TaskFrame/u
  );
});

test("chat semantic task provider validates TurnDelta responses independently from TaskFrame", async () => {
  const rawDelta = {
    schemaVersion: "turn-delta.v1",
    dialogueAct: "modify",
    taskRelation: "modify",
    explicitTaskFrame: null,
    entityOperations: [],
    constraintOperations: [{
      operation: "set",
      field: "rank",
      value: "MASTER_PLUS"
    }],
    presentation: {
      requestedCount: null,
      pageDirection: null,
      avoidSeen: false
    },
    confidence: 0.92,
    ambiguities: []
  };
  let observedBody;
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      observedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(rawDelta) } }]
        })
      };
    }
  });

  const result = await provider({
    schemaVersion: "turn-delta.v1",
    messages: [{ role: "user", content: "follow-up" }],
    budget: { maxOutputTokens: 240 }
  });

  assert.deepEqual(result.turnDelta, {
    ...rawDelta,
    presentation: {
      ...rawDelta.presentation,
      resultReference: null
    }
  });
  assert.equal(observedBody.response_format.type, "json_object");
  assert.match(observedBody.messages[0].content, /turn-delta\.v1/u);
  assert.match(observedBody.messages[0].content, /no active task.+self-contained TFT request/u);
  assert.match(observedBody.messages[0].content, /composition or lineup recommendations.+comp_rankings/u);
  assert.match(observedBody.messages[0].content, /multiple items for one champion.+unit_item_comparison/u);
  assert.match(observedBody.messages[0].content, /keep those semantics in explicitTaskFrame/u);
  assert.match(observedBody.messages[0].content, /Constraint values must use only values authorized/u);
  assert.match(observedBody.messages[0].content, /resultReference/u);
});

test("chat semantic task provider applies domain validation to explicit TaskFrame constraints", async () => {
  const invalidDelta = {
    schemaVersion: "turn-delta.v1",
    dialogueAct: "start_task",
    taskRelation: "new",
    explicitTaskFrame: {
      ...validFrame,
      action: "rank",
      goal: "comp_rankings",
      capabilityRequirements: [],
      constraints: {
        strategy: ["non-vertical", "flexible"]
      }
    },
    entityOperations: [],
    constraintOperations: [],
    presentation: {
      requestedCount: 3,
      pageDirection: null,
      avoidSeen: false,
      resultReference: null
    },
    confidence: 0.9,
    ambiguities: []
  };
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    maxInvalidRetries: 0,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(invalidDelta) } }]
      })
    })
  });

  await assert.rejects(
    () => provider({
      schemaVersion: "turn-delta.v1",
      domainPolicy: tftConversationPolicy,
      messages: [],
      budget: { maxOutputTokens: 300 }
    }),
    /constraints\.strategy is invalid/u
  );
});

test("chat semantic task provider normalizes common emblem constraint shapes", async () => {
  const rawDelta = {
    schemaVersion: "turn-delta.v1",
    dialogueAct: "start_task",
    taskRelation: "new",
    explicitTaskFrame: {
      ...validFrame,
      action: "rank",
      goal: "rank_emblem_carriers",
      capabilityRequirements: ["item_carrier_statistics"],
      constraints: {
        itemPolicy: "emblem",
        itemCategories: "emblem"
      }
    },
    entityOperations: [],
    constraintOperations: [],
    presentation: {
      requestedCount: null,
      pageDirection: null,
      avoidSeen: false,
      resultReference: null
    },
    confidence: 0.9,
    ambiguities: []
  };
  let observedBody;
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    maxInvalidRetries: 0,
    fetchImpl: async (_url, init) => {
      observedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(rawDelta) } }]
        })
      };
    }
  });

  const result = await provider({
    schemaVersion: "turn-delta.v1",
    domainPolicy: tftConversationPolicy,
    messages: [],
    budget: { maxOutputTokens: 300 }
  });

  assert.equal(result.turnDelta.explicitTaskFrame.constraints.itemPolicy, "include_special");
  assert.deepEqual(result.turnDelta.explicitTaskFrame.constraints.itemCategories, ["emblem"]);
  assert.match(observedBody.messages[0].content, /itemCategories is always an array/u);
  assert.match(observedBody.messages[0].content, /itemPolicy is a scalar string/u);
  assert.match(observedBody.messages[0].content, /item-carrier ranking/u);
});

test("chat semantic task provider rejects invalid TurnDelta before normalization", async () => {
  const observedBodies = [];
  const provider = createChatSemanticTaskProvider({
    endpoint: "https://llm.example/v1/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      observedBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                schemaVersion: "turn-delta.v1",
                dialogueAct: "modify",
                taskRelation: "new"
              })
            }
          }]
        })
      };
    }
  });

  await assert.rejects(
    () => provider({
      schemaVersion: "turn-delta.v1",
      messages: [],
      budget: { maxOutputTokens: 240 }
    }),
    /invalid TurnDelta/u
  );
  assert.equal(observedBodies.length, 2);
  assert.match(observedBodies[1].messages.at(-1).content, /Validation errors to correct/u);
  assert.match(observedBodies[1].messages.at(-1).content, /explicitTaskFrame/u);
});
