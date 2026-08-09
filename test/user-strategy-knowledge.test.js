import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUserStrategyKnowledgeDocuments,
  buildUserStrategySemanticDocuments,
  evaluateBuildKnowledgeSignals
} from "../src/knowledge/user-strategy-knowledge.js";
import { hydrateUnitBuildKnowledgeSignals } from "../src/app/small-window-server.js";

test("two or more Deathcaps trigger an explicitly uncertain augment hint", () => {
  assert.deepEqual(evaluateBuildKnowledgeSignals(["TFT_Item_RabadonsDeathcap"]), []);
  const [signal] = evaluateBuildKnowledgeSignals([
    "TFT_Item_RabadonsDeathcap",
    "TFT_Item_RabadonsDeathcap",
    "TFT_Item_RabadonsDeathcap"
  ]);
  assert.equal(signal.copies, 3);
  assert.equal(signal.certainty, "hypothesis");
  assert.deepEqual(signal.possibleCauses, ["大棒溢流", "更要命的帽子"]);
  assert.match(signal.text, /可能/u);
  assert.match(signal.text, /不能据此确认/u);
});

test("two or more Deathblades trigger the matching possible augment hint", () => {
  const [signal] = evaluateBuildKnowledgeSignals([
    { apiName: "TFT_Item_Deathblade" },
    { apiName: "TFT_Item_Deathblade" },
    { apiName: "TFT_Item_InfinityEdge" }
  ]);
  assert.equal(signal.itemName, "杀人剑");
  assert.deepEqual(signal.possibleCauses, ["大剑溢流", "更要命的战刃"]);
});

test("user strategy rules are valid knowledge and semantic documents", () => {
  const documents = buildUserStrategyKnowledgeDocuments({ seasonContextId: "set17-live" });
  const semantic = buildUserStrategySemanticDocuments({ seasonContextId: "set17-live" });
  assert.equal(documents.length, 2);
  assert.equal(semantic.length, 2);
  assert.equal(documents[0].metadata.claimType, "speculation");
  assert.equal(semantic[0].documentType, "static_game_knowledge");
  assert.match(semantic[0].content, /不能据此确认/u);
});

test("serialized ReAct build evidence is hydrated when an older result lacks signals", () => {
  const value = {
    type: "unit_builds_batch_results",
    results: [{
      buildOptions: [{
        items: [
          { apiName: "TFT_Item_RabadonsDeathcap" },
          { apiName: "TFT_Item_RabadonsDeathcap" },
          { apiName: "TFT_Item_RabadonsDeathcap" }
        ]
      }]
    }]
  };
  hydrateUnitBuildKnowledgeSignals(value);
  assert.equal(value.results[0].buildOptions[0].knowledgeSignals[0].copies, 3);
});
