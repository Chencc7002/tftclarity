import assert from "node:assert/strict";
import test from "node:test";

import {
  requiredCoreItemAppearances,
  summarizeCoreItemFrequency
} from "../src/core/core-item-frequency.js";

test("core item frequency uses the displayed-build two-thirds threshold", () => {
  const summary = summarizeCoreItemFrequency([
    { items: ["red-buff", "kraken", "guardbreaker"] },
    { items: ["red-buff", "kraken", "deathblade"] },
    { items: ["red-buff", "kraken", "kraken"] }
  ]);

  assert.equal(summary.recommendationCount, 3);
  assert.equal(summary.requiredAppearances, 2);
  assert.deepEqual(summary.coreItems.map((entry) => [entry.apiName, entry.appearances]), [
    ["red-buff", 3],
    ["kraken", 3]
  ]);
  assert.equal(summary.items.find((entry) => entry.apiName === "guardbreaker").core, false);
});

test("core item frequency counts one item only once per displayed build", () => {
  const summary = summarizeCoreItemFrequency([
    { items: ["kraken", "kraken", "red-buff"] },
    { items: ["red-buff", "guardbreaker", "deathblade"] },
    { items: ["guardbreaker", "deathblade", "last-whisper"] }
  ]);

  assert.equal(summary.items.find((entry) => entry.apiName === "kraken").appearances, 1);
  assert.deepEqual(summary.coreItems.map((entry) => entry.apiName), ["red-buff", "guardbreaker", "deathblade"]);
});

test("a single displayed build never creates a fixed core judgment", () => {
  const summary = summarizeCoreItemFrequency([{ items: ["red-buff", "kraken", "deathblade"] }]);
  assert.equal(requiredCoreItemAppearances(1), 2);
  assert.equal(summary.requiredAppearances, 2);
  assert.deepEqual(summary.coreItems, []);
});
