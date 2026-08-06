import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog, parseSemanticTask } from "../src/index.js";

const catalog = createCatalog({
  units: [],
  items: [],
  traits: [{
    apiName: "TFT17_SpaceGroove",
    filterId: "TFT17_SpaceGroove_2",
    zhName: "太空律动",
    displayName: "太空律动",
    aliases: ["太空律动"],
    current: true
  }]
});
test("external support is a material two-way game concept ambiguity", async () => {
  const result = await parseSemanticTask("太空律动外援", { catalog, defaultDomain: "tft" });
  assert.equal(result.clarificationPolicy.needsClarification, true);
  assert.equal(result.taskFrame.ambiguities[0].code, "ambiguous_game_concept");
  assert.match(result.clarificationPolicy.question, /非太空律动单挂|非本羁绊单挂/);
  assert.match(result.clarificationPolicy.question, /转职/);
});
