import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSemanticCorpus,
  catalogFromRuntimeCacheSnapshot,
  createStaticCompCatalog,
  loadCompleteSemanticCatalog
} from "../src/index.js";

function runtimeSnapshot() {
  return {
    itemCatalogs: {
      current: {
        value: {
          patch: "current",
          items: [
            {
              apiName: "TFT_Item_GuinsoosRageblade",
              zhName: "鬼索的狂暴之刃",
              aliases: ["羊刀"],
              category: "ordinary_completed",
              current: true
            }
          ]
        }
      }
    },
    domainCatalogs: {
      current: {
        value: {
          patch: "current",
          units: [
            {
              apiName: "TFT17_MasterYi",
              zhName: "易大师",
              aliases: ["剑圣"],
              current: true
            },
            {
              apiName: "TFT17_PVE_ElderDragon",
              aliases: ["PVE_ElderDragon"],
              current: true
            }
          ],
          traits: [
            {
              apiName: "TFT17_DarkStar",
              filterId: "TFT17_DarkStar_1",
              zhName: "暗星",
              displayName: "2暗星",
              aliases: ["暗星2"],
              current: true
            },
            {
              apiName: "TFT17_DarkStar",
              filterId: "TFT17_DarkStar_2",
              zhName: "暗星",
              displayName: "4暗星",
              aliases: ["暗星4"],
              current: true
            }
          ]
        }
      }
    }
  };
}

function compsSnapshot() {
  return {
    results: {
      data: {
        cluster_details: {
          409001: {
            Cluster: 409001,
            name: [{ name: "TFT17_DarkStar" }, { name: "TFT17_MasterYi" }],
            name_string: "TFT17_DarkStar, TFT17_MasterYi",
            units_string: "TFT17_MasterYi",
            traits_string: "TFT17_DarkStar_2",
            overall: { count: 12345, avg: 3.7 },
            trends: [{ count: 100, avg: 3.8 }]
          }
        }
      }
    }
  };
}

test("runtime catalog snapshot produces complete deduplicated entity identity catalogs", () => {
  const catalog = catalogFromRuntimeCacheSnapshot(runtimeSnapshot());
  assert.equal(catalog.units.length, 1);
  assert.equal(catalog.units[0].apiName, "TFT17_MasterYi");
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.traits.length, 1);
  assert.ok(catalog.traits[0].aliases.includes("暗星2"));
  assert.ok(catalog.traits[0].aliases.includes("暗星4"));
  assert.ok(catalog.traits[0].aliases.includes("TFT17_DarkStar_2"));
});

test("comp catalog keeps identity aliases but excludes realtime statistics", () => {
  const catalog = catalogFromRuntimeCacheSnapshot(runtimeSnapshot());
  const comps = createStaticCompCatalog(compsSnapshot(), catalog);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].displayName, "暗星 易大师");
  assert.equal(comps[0].source, "metatft_comp_identity_snapshot");
  assert.equal("overall" in comps[0], false);
  assert.equal("trends" in comps[0], false);
  const documents = buildSemanticCorpus({ ...catalog, comps });
  const compDocument = documents.find((document) => document.documentType === "comp");
  assert.ok(compDocument);
  assert.equal(compDocument.content.includes("12345"), false);
  assert.equal(compDocument.content.includes("3.7"), false);
});

test("complete semantic catalog loader combines runtime cache and comp identity snapshot", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tft-semantic-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalogPath = join(directory, "runtime-cache.json");
  const compsPath = join(directory, "comps.json");
  await writeFile(catalogPath, JSON.stringify(runtimeSnapshot()), "utf8");
  await writeFile(compsPath, JSON.stringify(compsSnapshot()), "utf8");
  const catalog = await loadCompleteSemanticCatalog({
    catalogCachePath: catalogPath,
    compsInputPath: compsPath
  });
  assert.deepEqual({
    units: catalog.units.length,
    items: catalog.items.length,
    traits: catalog.traits.length,
    comps: catalog.comps.length
  }, {
    units: 1,
    items: 1,
    traits: 1,
    comps: 1
  });
  assert.equal(catalog.semanticCatalogSource, "runtime_catalog_cache");
});
