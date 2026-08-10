import test from "node:test";
import assert from "node:assert/strict";
import { PostgresStore } from "../src/storage/postgres/postgres-store.js";

function recordingPool() {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return { rows: [], rowCount: 0 };
  };
  return {
    calls,
    query,
    async connect() {
      return { query, release() {} };
    }
  };
}

function callContaining(pool, pattern) {
  return pool.calls.find((call) => pattern.test(call.sql));
}

const pbeContext = {
  seasonContextId: "set18-pbe",
  provider: "metatft",
  providerVersion: "metatft-pbe.v1",
  queue: "PBE",
  fetchedAt: "2026-08-08T00:00:00.000Z"
};

test("PostgresStore serializes catalog JSONB and deletes stale ids transactionally", async () => {
  const pool = recordingPool();
  const store = new PostgresStore({ pool });
  const item = {
    apiName: "DA_JeweledGauntlet",
    zhName: "珠光护手",
    aliases: ["法爆"],
    category: "ordinary_completed"
  };
  const unit = {
    apiName: "DA_Nidalee18_AP",
    canonicalApiName: "TFT18_Nidalee",
    zhName: "奈德丽",
    aliases: ["奈德丽", "TFT18_Nidalee"]
  };
  const trait = {
    apiName: "DA_Primal18",
    filterId: "DA_Primal18_2",
    zhName: "远古",
    aliases: ["远古"]
  };

  await store.setItemCatalog("current", [item], pbeContext);
  await store.setDomainCatalog("current", { units: [unit], traits: [trait] }, pbeContext);

  const itemInsert = callContaining(pool, /INSERT INTO item_catalog/u);
  const unitInsert = callContaining(pool, /INSERT INTO units/u);
  const traitInsert = callContaining(pool, /INSERT INTO traits/u);
  assert.equal(itemInsert.params[12], JSON.stringify(item.aliases));
  assert.equal(itemInsert.params[13], JSON.stringify(item));
  assert.equal(unitInsert.params[9], JSON.stringify(unit.aliases));
  assert.equal(unitInsert.params[11], JSON.stringify(unit));
  assert.equal(traitInsert.params[11], JSON.stringify(trait.aliases));
  assert.equal(traitInsert.params[13], JSON.stringify(trait));

  assert.deepEqual(callContaining(pool, /DELETE FROM item_catalog/u).params, [
    "set18-pbe", "metatft", "current", ["DA_JeweledGauntlet"]
  ]);
  assert.deepEqual(callContaining(pool, /DELETE FROM units/u).params, [
    "set18-pbe", "metatft", "current", ["DA_Nidalee18_AP"]
  ]);
  assert.deepEqual(callContaining(pool, /DELETE FROM traits/u).params, [
    "set18-pbe", "metatft", "current", ["DA_Primal18"]
  ]);
});

test("PostgresStore reads catalogs within the requested provider version", async () => {
  const pool = recordingPool();
  const store = new PostgresStore({ pool });

  assert.equal(await store.getItemCatalog("current", pbeContext), null);
  assert.equal(await store.getDomainCatalog("current", pbeContext), null);

  const selects = pool.calls.filter((call) => /^SELECT \*/u.test(call.sql));
  assert.equal(selects.length, 3);
  for (const call of selects) {
    assert.match(call.sql, /provider_version=\$3/u);
    assert.deepEqual(call.params, ["set18-pbe", "metatft", "metatft-pbe.v1", "current"]);
  }
});
