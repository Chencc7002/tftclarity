import test from "node:test";
import assert from "node:assert/strict";
import { fetchOfficialTftItemDetails } from "../src/data/official-item-details.js";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { officialItemEvidenceFailure, officialItemBatchEvidenceFailure, currentOfficialItemRetrieval } from "../src/agent/official-item-evidence.js";
import { validateFinishAction } from "../src/react/termination-policy.js";
import { createSmallWindowRuntime, createDefaultReactToolHandlerBundle } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";

const payload = JSON.stringify({ season: "TFT18", version: "16.17", time: "2026-08-27T10:00:00Z",
  data: [{ englishName: "DA_SpearOfShojin", equipId: "1", name: "朔极之矛", effect: "每次普攻提供5额外法力值。" }] });

async function fixture() {
  let calls = 0;
  const catalog = await fetchOfficialTftItemDetails({ captureRetrieval: true,
    fetchImpl: async () => { calls += 1; return { ok: true, text: async () => payload }; } });
  const handlers = createTftToolHandlers({ officialItemEvidenceV1: true,
    seasonContext: { id: "set18-live", currentPatch: "18.1" },
    loadOfficialItemDetails: async () => catalog }).handlers;
  const value = await handlers.item_details({ apiName: "DA_SpearOfShojin" });
  const entry = { evidenceId: "item", toolName: "item_details", source: "official_catalog", value,
    updatedAt: value.updatedAt, validatedAt: new Date().toISOString(), metadata: { updatedAt: value.updatedAt } };
  return { catalog, handlers, entry, calls: () => calls };
}

test("official item receipts distinguish HTTP retrieval from publication and cached reads", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.catalog.meta);
  const second = await f.handlers.item_details({ apiName: "DA_SpearOfShojin" });
  assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(f.catalog.meta), before);
  assert.deepEqual(second.source.retrieval, f.entry.value.source.retrieval);
  assert.equal(second.updatedAt, "2026-08-27T10:00:00Z");
  assert.equal(officialItemEvidenceFailure(f.entry), null);
  assert.equal(second.facts.numericFormulaComplete, true);
  const currentCatalog = structuredClone(f.entry);
  currentCatalog.value.source.retrieval.catalogSeason = "2026.S18";
  assert.equal(officialItemEvidenceFailure(currentCatalog),null);
  const legacy = createTftToolHandlers({ seasonContext: { id: "set18-live", currentPatch: "18.1" },
    loadOfficialItemDetails: async () => f.catalog }).handlers;
  assert.equal((await legacy.item_details({apiName:"DA_SpearOfShojin"})).source.retrieval, undefined);
});

test("official item batch validates every ordered item with the same receipt policy", async () => {
  const f = await fixture();
  const value = await f.handlers.item_details_batch({ apiNames: ["DA_SpearOfShojin"], seasonContextId: "set18-live" });
  const entry = { evidenceId: "batch", toolName: "item_details_batch", source: "official_catalog", value,
    updatedAt: value.updatedAt, validatedAt: new Date().toISOString(), metadata: { updatedAt: value.updatedAt } };
  assert.equal(officialItemBatchEvidenceFailure(entry, { seasonContextId: "set18-live" }), null);
  for (const mutate of [
    candidate => { candidate.value.selection.apiNames[0] = "another"; },
    candidate => { candidate.value.items[0].apiName = "another"; },
    candidate => { delete candidate.value.items[0].source.retrieval; },
    candidate => { candidate.value.items[0].scope.seasonContextId = "set17-live"; }
  ]) {
    const candidate = structuredClone(entry);
    mutate(candidate);
    assert.notEqual(officialItemBatchEvidenceFailure(candidate, { seasonContextId: "set18-live" }), null);
  }
});

test("fresh read timestamps cannot revive missing, expired, historical or conflicting official receipts", async () => {
  const f = await fixture();
  for (const mutate of [
    e => { delete e.value.source.retrieval; },
    e => { e.value.source.retrieval.fetchedAt = "2020-01-01T00:00:00Z"; },
    e => { e.value.source.retrieval.fetchedAt = "2100-01-01T00:00:00Z"; },
    e => { e.temporalStatus = "historical"; },
    e => { e.metadata.freshnessStatus = "stale"; },
    e => { e.value.source.retrieval.catalogSeason = "TFT17"; },
    e => { e.value.scope.seasonContextId = "set18-pbe"; },
    e => { e.value.source.retrieval.sourceId = "https://unrelated.test/"; },
    e => { e.value.source.updatedAt = new Date().toISOString(); },
    e => { e.value.entityRef.apiName = "another"; },
    e => { e.metadata.cache = {expiresAt:"2020-01-01T00:00:00Z"}; }
  ]) {
    const entry = structuredClone(f.entry);
    mutate(entry);
    entry.value.source.retrievedAt = entry.validatedAt = new Date().toISOString();
    assert.notEqual(officialItemEvidenceFailure(entry), null);
  }
  const fetched = Date.parse(f.catalog.meta.retrieval.fetchedAt);
  assert.equal(currentOfficialItemRetrieval(f.catalog.meta.retrieval, fetched + 30 * 60 * 1000), false);
});

test("opt-in finish uses the same official receipt policy and never upgrades old saved evidence", async () => {
  const f = await fixture();
  const action = { reasonCode: "sufficient_evidence", answer: "官方装备提供法力回复。", evidenceIds: ["item"] };
  const ledger = { resolve: () => [f.entry] };
  assert.equal(validateFinishAction(action, ledger, {officialItemEvidenceV1:true,seasonContextId:"set18-live"}).valid,true);
  delete f.entry.value.source.retrieval;
  assert.equal(validateFinishAction(action, ledger).valid,true, "legacy unchanged");
  assert.equal(validateFinishAction(action, ledger, {officialItemEvidenceV1:true}).valid,false);
  const omitted = { ...action, answer:"朔极之矛每次普攻提供法力回复。", evidenceIds:["build"] };
  const build = {evidenceId:"build",toolName:"unit_builds",value:{cards:[{items:[{apiName:"DA_SpearOfShojin",name:"青龙刀"}]}]}};
  const completeLedger = {resolve:ids=>[build,f.entry].filter(e=>ids.includes(e.evidenceId)),snapshot:()=>({entries:[build,f.entry]})};
  assert.equal(validateFinishAction(omitted,completeLedger,{officialItemEvidenceV1:true}).valid,false);
  assert.equal(validateFinishAction({...omitted,answer:"青龙刀每次普攻提供法力回复。"},completeLedger,{officialItemEvidenceV1:true}).valid,false);
});

test("failed HTTP responses and legacy fetches do not create retrieval receipts", async () => {
  await assert.rejects(fetchOfficialTftItemDetails({ captureRetrieval:true,
    fetchImpl:async()=>({ok:false,status:503,statusText:"Unavailable"}) }), /503/u);
  const legacy = await fetchOfficialTftItemDetails({fetchImpl:async()=>({ok:true,text:async()=>payload})});
  assert.equal(legacy.meta.retrieval,undefined);
});

test("server-only opt-in refreshes an unattested cache once and shares that HTTP receipt", async () => {
  let calls = 0;
  const runtime = createSmallWindowRuntime({cacheStore:new MemoryCacheStore(),officialItemDetailsFetch:async()=>{
    calls += 1; return {ok:true,text:async()=>payload};
  }});
  const request = {seasonContextId:"set18-live",locale:"zh-CN",reactOfficialItemEvidenceV1:true};
  const legacy = await createDefaultReactToolHandlerBundle({request,runtime});
  assert.equal((await legacy.handlers.item_details({apiName:"DA_SpearOfShojin"})).source.retrieval,undefined);
  runtime.reactOfficialItemEvidenceV1 = true;
  const candidate = await createDefaultReactToolHandlerBundle({request,runtime});
  const values = await Promise.all([1,2,3].map(()=>candidate.handlers.item_details({apiName:"DA_SpearOfShojin"})));
  assert.equal(calls,2,"one legacy download, one attested refresh; concurrent readers share the refresh");
  assert.deepEqual(values.map(v=>v.source.retrieval),[values[0].source.retrieval,values[0].source.retrieval,values[0].source.retrieval]);
  assert.equal(values[0].source.retrieval.catalogSeason,"TFT18");
  assert.equal(values[0].updatedAt,"2026-08-27T10:00:00Z");
});
