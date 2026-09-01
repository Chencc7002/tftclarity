import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { compositionCardPayload } from "./fixtures/composition-card-payload.js";
import { collectCompositionResultGroups } from "../src/app/small-window-ui/composition-result-groups.js";
import { hasBoundTacticalEvidence } from "../src/app/small-window-ui/composition-card-details.js";

const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
function harness() {
  const context = vm.createContext({ collectCompositionResultGroups, hasBoundTacticalEvidence,
    conclusionDisplayText: (value) => value, t: (key) => key, escapeHtml: (value) => String(value ?? ""),
    state: { seasonContextId: "set18-live", compDetailCache: new Map(), compDetailDescriptors: new Map(), compDetailRequests: new Map() },
    fetch: () => { throw new Error("snapshot cards must not retrieve data"); },
    renderCompFormation: (_comp, formation, placed) => `formation:${formation?.status ?? "unavailable"}:${placed.size}`
  });
  vm.runInContext(app.slice(app.indexOf("function normalizeReactCompositionRankings("), app.indexOf("function reactChatMessages(")), context);
  vm.runInContext(app.slice(app.indexOf("function compDetailDescriptor("), app.indexOf("function normalizedCompDetailStatus(")), context);
  vm.runInContext(app.slice(app.indexOf("function renderCompDetailContent("), app.indexOf("function renderCompCard(")), context);
  return context;
}
const cards = (value) => Object.values(value.rankings).flat();

async function scopedPayload() {
  const payload = await compositionCardPayload({ includeEquipment: true });
  const parent = payload.evidence[0];
  const child = structuredClone(parent);
  child.evidenceId = "resolved-first-card";
  child.value.results = [child.value.results[0]];
  child.value.resolution = { status: "resolved", mention: child.value.results[0].compositionRef.compId };
  delete child.value.results[0].tacticalDetailQueryPlan.resolutionPrerequisite;
  delete child.value.query.unit;
  child.value.query.limit = 20;
  payload.evidence.push(child);
  payload.compositionCardScope = true;
  payload.cardEvidenceIds = payload.evidence.filter(entry => entry.toolName !== "unit_builds").map(entry => entry.evidenceId);
  payload.evidenceIds = [child.evidenceId, payload.evidence.find(entry => entry.toolName === "unit_builds").evidenceId];
  return payload;
}

test("candidate receipt preserves omitted cards and removes only identical resolution copies", async () => {
  const payload = await scopedPayload(), original = structuredClone(payload);
  const data = harness().normalizeEndpointPayload(payload);
  assert.equal(data.compositionResultGroups.length, 1);
  const rows = cards(data.compositionResultGroups[0].result);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.compId), payload.evidence[0].value.results.map(row => row.compositionRef.compId));
  assert.deepEqual(rows.map(row => row.tacticalDetail.status), ["ready", "ready", "unavailable"]);
  assert.deepEqual(payload, original, "model citations and source payload remain untouched");
  const withoutEquipment = { ...payload, evidence: payload.evidence.filter(entry => entry.toolName !== "unit_builds") };
  assert.equal(cards(harness().normalizeEndpointPayload(withoutEquipment)).length, 3, "single group is also the primary result");
});

test("different scope, statistics, clock or prerequisite keeps separate composition groups", async () => {
  const original = await scopedPayload();
  for (const change of [
    value => { value.query.days = 7; }, value => { value.query.patch = "another"; },
    value => { value.query.seasonContextId = "set18-live"; }, value => { value.query.minSamples = 1000; },
    value => { value.results[0].stats.games = 12345; }, value => { value.source.updatedAt += 1; },
    value => { value.resolution.mention = "different input"; }
  ]) {
    const payload = structuredClone(original); change(payload.evidence.at(-1).value);
    assert.equal(collectCompositionResultGroups(payload, harness().normalizeReactCompositionRankings).length, 2);
  }
});

test("isolated card receipt cannot promote uncited ordinary evidence or alter the legacy path", async () => {
  const payload = await scopedPayload();
  const noReceipt = { ...payload, evidenceIds: [], cardEvidenceIds: [] };
  assert.equal(collectCompositionResultGroups(noReceipt, harness().normalizeReactCompositionRankings).length, 0);
  assert.equal(harness().normalizeEndpointPayload(noReceipt).type, "react_chat_result");
  const legacy = { ...payload, compositionCardScope: false, evidenceIds: payload.evidence.map(entry => entry.evidenceId) };
  assert.equal(collectCompositionResultGroups(legacy, harness().normalizeReactCompositionRankings).length, 2);
});

test("real tool results retain every composition with its own formation regardless of completion order", async () => {
  const payload = await compositionCardPayload();
  const before = structuredClone(payload);
  for (const order of [[0, 1, 2], [0, 2, 1], [2, 1, 0]]) {
    const data = harness().normalizeEndpointPayload({ ...payload, evidence: order.map((index) => payload.evidence[index]) });
    assert.equal(data.type, "comp_rankings", "a standalone board must not replace all cards");
    const rows = cards(data);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.compId), payload.evidence[0].value.results.map((row) => row.compositionRef.compId));
    for (const [index, row] of rows.entries()) {
      assert.equal(row.tacticalDetail.status, index < 2 ? "ready" : "unavailable");
      if (index < 2) {
        assert.equal(row.tacticalDetail.data.compId, row.tacticalDetailQueryPlan.compositionId);
        assert.equal(row.tacticalDetail.data.formation.units[0].cell, index * 7 + 1);
        assert.deepEqual(row.tacticalDetail.data, payload.evidence[index + 1].value);
      } else assert.equal(row.tacticalDetail.data, null);
    }
  }
  assert.deepEqual(payload, before);
});

test("equipment remains visible with supplemental composition cards and bound positioning", async () => {
  const payload = await compositionCardPayload({ includeEquipment: true });
  const data = harness().normalizeEndpointPayload(payload);
  assert.equal(data.type, "unit_build_rankings");
  assert.deepEqual(data.cards, payload.evidence.at(-1).value.cards);
  assert.equal(data.compositionResultGroups.length, 1);
  assert.equal(cards(data.compositionResultGroups[0].result).length, 3);
  assert.equal(cards(data.compositionResultGroups[0].result)[1].tacticalDetail.data.formation.units[0].cell, 8);
});

test("wrong composition, cluster, season, roster, cells or timestamps cannot be attached", async () => {
  const original = await compositionCardPayload();
  for (const mutate of [
    (entry) => { entry.value.compId = "different"; },
    (entry) => { entry.value.clusterId = "different"; },
    (entry) => { entry.value.seasonContextId = "set18-live"; },
    (entry) => { entry.value.formation.source.compId = "different"; },
    (entry) => { entry.value.formation.units.pop(); },
    (entry) => { entry.value.formation.units[0].apiName = "TFT17_Unknown"; },
    (entry) => { entry.value.formation.units[0].boardPosition.rowFromFront = 2; },
    (entry) => { entry.value.formation.units[1].cell = entry.value.formation.units[0].cell; },
    (entry) => { entry.value.formation.source.updatedAt = "2000-01-01T00:00:00Z"; },
    (entry) => { entry.value.cache.expiresAt = "2000-01-01T00:00:00Z"; },
    (entry) => { entry.temporalStatus = "historical"; },
    (entry) => { entry.metadata.cache = { stale: true }; },
    (entry) => { entry.validatedAt = null; }
  ]) {
    const payload = structuredClone(original);
    mutate(payload.evidence[1]);
    const groups = collectCompositionResultGroups(payload, harness().normalizeReactCompositionRankings);
    const rows = cards(groups[0].result);
    assert.equal(rows[0].tacticalDetail.status, "unavailable");
    assert.equal(rows[1].tacticalDetail.status, "ready", "one bad card must not discard another card's valid formation");
  }
});

test("partial formation stays in its own card and cannot silently fill missing units", async () => {
  const payload = await compositionCardPayload();
  const formation = payload.evidence[1].value.formation;
  const absent = formation.units.pop();
  formation.missingUnitApiNames = [absent.apiName];
  formation.status = "partial";
  const data = harness().normalizeEndpointPayload(payload);
  const bound = cards(data)[0].tacticalDetail.data.formation;
  assert.equal(bound.status, "partial");
  assert.deepEqual(bound.missingUnitApiNames, [absent.apiName]);
  assert.ok(!bound.units.some((unit) => unit.apiName === absent.apiName));
});

test("uncited data is not bound and standalone tactical queries keep their legacy view", async () => {
  const legacyGroup = { result: { rankings: { top4: [{}] } } };
  assert.equal(hasBoundTacticalEvidence(legacyGroup, undefined), false);
  assert.equal(hasBoundTacticalEvidence(legacyGroup, null), false);
  const payload = await compositionCardPayload();
  const standalone = harness().normalizeEndpointPayload({ ...payload, evidence: [payload.evidence[1]], evidenceIds: [payload.evidence[1].evidenceId] });
  assert.equal(standalone.type, "composition_tactical_details");
  assert.equal(standalone.compositionResultGroups, undefined);
  payload.evidenceIds = [payload.evidence[0].evidenceId];
  const groups = collectCompositionResultGroups(payload, harness().normalizeReactCompositionRankings);
  assert.ok(cards(groups[0].result).every((row) => row.tacticalDetail.status === "unavailable"));
});

test("snapshot cards keep their own season, never share detail keys and never lazy-fetch", async () => {
  const payload = await compositionCardPayload();
  const ui = harness();
  const rows = cards(ui.normalizeEndpointPayload(payload));
  const descriptors = rows.map((row) => ui.compDetailDescriptor(row));
  assert.ok(descriptors.every((entry) => entry.seasonContextId === "set17-live"));
  assert.equal(new Set(descriptors.map((entry) => entry.key)).size, 3);
  for (const descriptor of descriptors) await ui.loadCompDetail(descriptor);
  assert.equal(ui.renderCompDetailContent(descriptors[2]), "formation:unavailable:0");
  assert.equal(ui.state.compDetailCache.size, 0);
});

test("snapshot details do not replace the original lazy path for Quick Task cards", async () => {
  const payload = await compositionCardPayload();
  const ui = harness();
  const legacy = { ...cards(ui.normalizeEndpointPayload(payload))[0] };
  delete legacy.tacticalDetail;
  const descriptor = ui.compDetailDescriptor(legacy);
  assert.equal(descriptor.embeddedDetail, null);
  assert.equal(descriptor.seasonContextId, "set18-live");
});
