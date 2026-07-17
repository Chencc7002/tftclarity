import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_CONCLUSION_PROMPT_VERSION,
  CONCLUSION_PROMPT_ROUTES,
  createConclusionPromptRegistry,
  getConclusionPromptRoute
} from "../src/index.js";

test("PromptRegistry routes every registered intent to its dedicated prompt", async () => {
  const registry = createConclusionPromptRegistry();
  for (const intent of [
    "unit_build_rankings", "unit_build_completion", "unit_best_3_items", "unit_item_rankings",
    "unit_item_comparison", "unit_emblem_rankings", "comp_rankings", "comp_trends"
  ]) {
    const prompt = await registry.load(intent);
    assert.equal(prompt.baseVersion, BASE_CONCLUSION_PROMPT_VERSION);
    assert.equal(prompt.intentVersion, CONCLUSION_PROMPT_ROUTES[intent].version);
    assert.match(prompt.text, /Evidence Pack/u);
  }
});

test("PromptRegistry selects prompts only from a validated intent and never guesses a similar route", async () => {
  const registry = createConclusionPromptRegistry();
  assert.equal(await registry.load("unit_details"), null);
  assert.equal(await registry.load("item_details"), null);
  assert.equal(await registry.load("trait_details"), null);
  assert.equal(await registry.load("unit_item_availability"), null);
  assert.equal(await registry.load("unit_item_rank"), null);
  assert.equal(getConclusionPromptRoute("unit_item_rank"), null);
});

test("correction prompt is appended only for corrective generations", async () => {
  const registry = createConclusionPromptRegistry();
  const initial = await registry.load("unit_emblem_rankings");
  const correction = await registry.load("unit_emblem_rankings", { correction: true });
  assert.equal(initial.correctionVersion, null);
  assert.ok(correction.correctionVersion);
  assert.doesNotMatch(initial.text, /上一版结论未通过/u);
  assert.match(correction.text, /上一版结论未通过/u);
});

test("changing one intent prompt version is isolated in the route metadata", () => {
  const build = getConclusionPromptRoute("unit_build_rankings");
  const item = getConclusionPromptRoute("unit_item_rankings");
  assert.notEqual(build.version, item.version);
  assert.equal(getConclusionPromptRoute("unit_build_completion").version, build.version);
});
