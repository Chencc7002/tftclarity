import test from "node:test";
import assert from "node:assert/strict";
import {
  initSchema,
  openDatabase,
  createPool,
  renamePool,
  registerPlayer
} from "../services/opgg/collector.mjs";
import {
  accessiblePool,
  authorizedPoolId,
  canAccessPlayer,
  isPersonalPool,
  personalPoolId,
  poolQueryOptions
} from "../services/opgg/api-router.mjs";

test("personal review pools are isolated by visitor scope", async () => {
  assert.equal(personalPoolId(null), "my-review");
  assert.equal(personalPoolId("scope-a"), "my-review-scope-a");
  assert.equal(isPersonalPool("my-review-scope-b"), true);
  assert.equal(authorizedPoolId("my-review", "scope-a"), "my-review-scope-a");
  assert.equal(authorizedPoolId("my-review-scope-a", "scope-a"), "my-review-scope-a");
  assert.equal(authorizedPoolId("my-review-scope-b", "scope-a"), null);

  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "my-review-scope-a", name: "A", region: "na" });
  createPool(database, { id: "my-review-scope-b", name: "B", region: "na" });
  createPool(database, { id: "default-na-pro", name: "Pros", region: "na" });
  registerPlayer(database, {
    id: "private-a",
    displayName: "Private A",
    gameName: "Private A",
    tagLine: "NA1",
    region: "na"
  }, "my-review-scope-a");
  registerPlayer(database, {
    id: "pro",
    displayName: "Pro",
    gameName: "Pro",
    tagLine: "NA1",
    region: "na"
  }, "default-na-pro");

  assert.equal(canAccessPlayer(database, "private-a", "scope-a"), true);
  assert.equal(canAccessPlayer(database, "private-a", "scope-b"), false);
  assert.equal(canAccessPlayer(database, "pro", "scope-b"), true);
  database.close();
});

test("custom pool metadata drives PBE aggregation and stays owner scoped", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, {
    id: "pbe-experts",
    name: "S18 PBE 观察池",
    region: "pbe",
    environment: "pbe",
    ownerType: "user",
    ownerId: "scope-a"
  });
  const pool = accessiblePool(database, "pbe-experts", "scope-a");
  assert.equal(pool.region, "pbe");
  assert.deepEqual(poolQueryOptions(pool, new URLSearchParams()), {
    poolId: "pbe-experts",
    region: "pbe",
    perPlayerLimit: 20
  });
  assert.equal(accessiblePool(database, "pbe-experts", "scope-b"), null);
  assert.equal(renamePool(database, "pbe-experts", "pbe高手").name, "pbe高手");
  database.close();
});
