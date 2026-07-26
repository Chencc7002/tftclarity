import assert from "node:assert/strict";
import test from "node:test";

import {
  COMP_AUGMENT_TIERS_ENDPOINT,
  COMP_DETAIL_ENDPOINT,
  normalizeCompAugmentTiers,
  normalizeCompDetailsPositioning,
} from "../src/data/comp-detail-adapter.js";

test("normalizes observed positioning only for the supplied final roster", () => {
  const result = normalizeCompDetailsPositioning(
    {
      results: {
        positioning: {
          units: {
            TFT17_A: {
              positions: [
                { cell: "cell_4", count: 20 },
                { cell: 7, count: 11 },
                { cell: 29, count: 999 },
              ],
            },
            TFT17_B: {
              positions: [
                { cell: 4, count: 25 },
                { cell: 1, count: 8 },
              ],
            },
            TFT17_NOT_IN_FINAL_ROSTER: {
              positions: [{ cell: 2, count: 500 }],
            },
          },
        },
      },
    },
    [{ apiName: "TFT17_A" }, "TFT17_B"],
    { compId: "comp-123", clusterId: "na" },
  );

  assert.equal(result.status, "available");
  assert.deepEqual(result.units, [
    { apiName: "TFT17_A", cell: 7, cellKey: "cell_7", count: 11 },
    { apiName: "TFT17_B", cell: 4, cellKey: "cell_4", count: 25 },
  ]);
  assert.deepEqual(result.missingUnitApiNames, []);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.source, {
    provider: "MetaTFT",
    endpoint: COMP_DETAIL_ENDPOINT,
    compId: "comp-123",
    clusterId: "na",
  });
});

test("maximizes observed roster coverage before choosing the strongest non-conflicting cells", () => {
  const result = normalizeCompDetailsPositioning(
    {
      results: {
        positioning: {
          units: {
            TFT17_A: { positions: [{ cell: 1, count: 100 }, { cell: 2, count: 99 }] },
            TFT17_B: { positions: [{ cell: 1, count: 98 }] }
          }
        }
      }
    },
    ["TFT17_A", "TFT17_B"]
  );

  assert.equal(result.status, "available");
  assert.deepEqual(result.units, [
    { apiName: "TFT17_A", cell: 2, cellKey: "cell_2", count: 99 },
    { apiName: "TFT17_B", cell: 1, cellKey: "cell_1", count: 98 }
  ]);
});

test("reports partial positioning rather than inventing fallback cells", () => {
  const result = normalizeCompDetailsPositioning(
    {
      results: {
        positioning: {
          units: {
            TFT17_A: { positions: [{ cell: 3, count: 12 }] },
            TFT17_B: { positions: [{ cell: 3, count: 9 }] },
            TFT17_C: { positions: [{ cell: "cell_0", count: 100 }] },
          },
        },
      },
    },
    ["TFT17_A", "TFT17_B", "TFT17_C"],
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.units, [
    { apiName: "TFT17_A", cell: 3, cellKey: "cell_3", count: 12 },
  ]);
  assert.deepEqual(result.missingUnitApiNames, ["TFT17_B", "TFT17_C"]);
  assert.deepEqual(result.reasons, [
    { code: "all_valid_cells_conflict", apiName: "TFT17_B" },
    { code: "no_valid_position", apiName: "TFT17_C" },
  ]);
});

test("returns unavailable positioning with a clear source reason when data is absent", () => {
  const result = normalizeCompDetailsPositioning(
    { results: {} },
    ["TFT17_A"],
    { compId: "comp-123", clusterId: "na" },
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.units, []);
  assert.deepEqual(result.reasons, [{ code: "missing_positioning_units" }]);
  assert.deepEqual(result.source, {
    provider: "MetaTFT",
    endpoint: COMP_DETAIL_ENDPOINT,
    compId: "comp-123",
    clusterId: "na",
  });
});

test("sorts MetaTFT augment tiers from S through D and supports a cap", () => {
  const result = normalizeCompAugmentTiers(
    {
      results: {
        "comp-123": {
          augments: [
            { id: "augment-c", tier: "C" },
            { id: "augment-a", tier: "a" },
            { id: "augment-s", tier: "S" },
            { id: "augment-d", tier: "D" },
            { id: "augment-b", tier: "B" },
            { id: "augment-s", tier: "D" },
            { id: "invalid", tier: "Z" },
          ],
        },
      },
    },
    "comp-123",
    { clusterId: "na", cap: 3 },
  );

  assert.equal(result.status, "available");
  assert.deepEqual(result.augments, [
    { apiName: "augment-s", tier: "S" },
    { apiName: "augment-a", tier: "A" },
    { apiName: "augment-b", tier: "B" },
  ]);
  assert.equal(result.totalAugments, 5);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.source, {
    provider: "MetaTFT",
    endpoint: COMP_AUGMENT_TIERS_ENDPOINT,
    compId: "comp-123",
    clusterId: "na",
  });
});

test("makes missing comp augment tiers explicit", () => {
  const result = normalizeCompAugmentTiers({ results: {} }, "comp-123");

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.augments, []);
  assert.deepEqual(result.reasons, [{ code: "missing_comp_augment_tiers" }]);
});
