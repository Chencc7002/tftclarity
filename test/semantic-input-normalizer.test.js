import test from "node:test";
import assert from "node:assert/strict";

import {
  createCatalog,
  createConversationState,
  createTaskFrame,
  createTurnDelta,
  interpretTurn,
  parseQuery
} from "../src/index.js";
import { normalizeTftSemanticInput } from "../src/core/semantic-input-normalizer.js";
import { tftConversationPolicy } from "../src/domain/tft/conversation-policy.js";

const EMBLEM_ID = "TFT17_Item_AstronautEmblemItem";

function emblemCatalog() {
  return createCatalog({
    items: [
      {
        apiName: EMBLEM_ID,
        zhName: "木灵族纹章",
        shortName: "木灵族转",
        aliases: ["木灵族转", "木灵族转职"],
        category: "emblem",
        current: true,
        obtainable: true
      },
      {
        apiName: "TFT17_Item_DarkStarEmblemItem",
        zhName: "暗星纹章",
        shortName: "暗星转",
        aliases: ["暗星转", "暗星转职"],
        category: "emblem",
        current: true,
        obtainable: true
      }
    ]
  });
}

test("catalog-backed emblem typo correction only applies to carrier requests", () => {
  const catalog = emblemCatalog();
  const carrier = normalizeTftSemanticInput("木灵族文章最适合哪些英雄携带", { catalog });
  assert.equal(carrier.normalizedInput, "木灵族纹章最适合哪些英雄携带");
  assert.deepEqual(carrier.corrections, [{
    type: "catalog_backed_emblem_typo",
    from: "木灵族文章",
    to: "木灵族纹章"
  }]);

  const anotherEmblem = normalizeTftSemanticInput("暗星文章推荐哪些棋子携带", { catalog });
  assert.equal(anotherEmblem.normalizedInput, "暗星纹章推荐哪些棋子携带");

  const literalArticle = normalizeTftSemanticInput("我想看一篇木灵族文章", { catalog });
  assert.equal(literalArticle.normalizedInput, "我想看一篇木灵族文章");
  assert.deepEqual(literalArticle.corrections, []);
});

test("deterministic query parsing routes the corrected typo to item carriers", () => {
  const parsed = parseQuery("木灵族文章最适合哪些英雄携带", { catalog: emblemCatalog() });
  assert.equal(parsed.rawInput, "木灵族文章最适合哪些英雄携带");
  assert.equal(parsed.intent, "item_carrier_rankings");
  assert.equal(parsed.carrierItem, EMBLEM_ID);
  assert.equal(parsed.parser.semanticNormalization.normalizedInput, "木灵族纹章最适合哪些英雄携带");
});

test("turn interpreter corrects the typo before LLM parsing and recovers a confident wrong route", async () => {
  let observedCurrentMessage = null;
  const response = await interpretTurn({
    currentMessage: "木灵族文章最适合哪些英雄携带",
    conversationState: createConversationState(),
    catalog: emblemCatalog(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async ({ messages }) => {
      observedCurrentMessage = JSON.parse(messages.at(-1).content).currentMessage;
      return createTurnDelta({
        dialogueAct: "start_task",
        taskRelation: "new",
        explicitTaskFrame: createTaskFrame({
          action: "rank",
          goal: "comp_rankings",
          concepts: [],
          capabilityRequirements: ["composition_statistics"],
          confidence: 0.95,
          understandingStatus: "understood_and_supported"
        }),
        confidence: 0.95
      });
    }
  });

  assert.equal(observedCurrentMessage, "木灵族纹章最适合哪些英雄携带");
  assert.equal(response.telemetry.providerSucceeded, true);
  assert.equal(response.telemetry.providerFallback.reason, "catalog_backed_input_correction");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "rank_options");
  const correctedEntities = [
    ...response.turnDelta.explicitTaskFrame.subjects,
    ...response.turnDelta.explicitTaskFrame.candidates,
    ...response.turnDelta.explicitTaskFrame.concepts
  ];
  assert.equal(correctedEntities.find((entity) => entity.expectedType === "item")?.resolvedId, EMBLEM_ID);
  assert.deepEqual(response.turnDelta.explicitTaskFrame.capabilityRequirements, ["item_carrier_statistics"]);
});
