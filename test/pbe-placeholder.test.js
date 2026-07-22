import assert from "node:assert/strict";
import test from "node:test";

import {
  PROMOTABLE_SEASON_CONTENT_TYPES,
  SEASON_PROVIDER_OPERATIONS,
  buildSeasonContentPromotionPlan,
  createPbeProviderPlaceholder,
  createSeasonContextService
} from "../src/index.js";

test("PBE provider placeholder reports health without attempting or falling back to live data", async () => {
  const provider = createPbeProviderPlaceholder();
  const context = { id: "set18-pbe" };
  const availability = provider.getAvailability(context);

  assert.equal(availability.available, false);
  assert.equal(availability.status, "coming_soon");
  assert.equal(availability.health.status, "not_verified");
  assert.equal(availability.health.catalogStatus, "not_synced");
  assert.deepEqual(SEASON_PROVIDER_OPERATIONS, [
    "getCatalog",
    "getCompRankings",
    "getItemStats",
    "getUnitStats"
  ]);

  for (const operation of SEASON_PROVIDER_OPERATIONS) {
    await assert.rejects(
      provider[operation](context, {}),
      (error) => error.code === "season_provider_unavailable"
        && error.providerId === "metatft-pbe"
        && error.seasonContextId === "set18-pbe"
    );
  }
});

test("public PBE health is an explicit never-synced placeholder", () => {
  const pbe = createSeasonContextService().listPublic()
    .find((context) => context.id === "set18-pbe");

  assert.equal(pbe.selectable, false);
  assert.equal(pbe.availability.available, false);
  assert.equal(pbe.availability.health.status, "not_verified");
  assert.equal(pbe.availability.health.lastSuccessfulSyncAt, null);
  assert.equal(pbe.availability.health.catalogStatus, "not_synced");
});

test("PBE to Live content promotion is review-only and excludes facts and caches", () => {
  const plan = buildSeasonContentPromotionPlan({
    sourceContext: {
      id: "set18-pbe",
      season: 18,
      environment: "pbe",
      catalogNamespace: "set18-pbe"
    },
    targetContext: {
      id: "set18-live",
      season: 18,
      environment: "live",
      catalogNamespace: "set18-live"
    },
    contentTypes: ["aliases", "comp_profiles", "theme"]
  });

  assert.equal(plan.status, "design_only");
  assert.equal(plan.executable, false);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.requiresExplicitApproval, true);
  assert.deepEqual(plan.contentTypes, ["aliases", "comp_profiles", "theme"]);
  assert.ok(plan.operations.every((operation) => operation.overwrite === false));
  assert.ok(plan.operations.every((operation) => operation.targetNamespace === "set18-live"));
  assert.ok(plan.invariants.some((line) => /query cache/i.test(line)));
  assert.equal(PROMOTABLE_SEASON_CONTENT_TYPES.includes("query_cache"), false);
});

test("promotion plan rejects cross-set and Live to PBE copies", () => {
  assert.throws(() => buildSeasonContentPromotionPlan({
    sourceContext: { id: "set18-live", season: 18, environment: "live" },
    targetContext: { id: "set18-pbe", season: 18, environment: "pbe" }
  }), (error) => error.code === "unsupported_season_content_promotion");

  assert.throws(() => buildSeasonContentPromotionPlan({
    sourceContext: { id: "set18-pbe", season: 18, environment: "pbe" },
    targetContext: { id: "set19-live", season: 19, environment: "live" }
  }), (error) => error.code === "season_content_promotion_mismatch");
});
