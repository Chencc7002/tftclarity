import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompsPageSnapshot,
  inspectOfficialCompTrendGate
} from "../src/index.js";

function responseWith(comps) {
  return {
    updated: 123,
    results: { data: { cluster_id: 409, ...(comps === undefined ? {} : { comps }) } }
  };
}

test("official trend gate stays closed when results.data.comps is missing", () => {
  const gate = inspectOfficialCompTrendGate(responseWith(undefined));
  assert.equal(gate.ready, false);
  assert.equal(gate.status, "field_missing");
  assert.equal(gate.sourceType, null);
  assert.equal(gate.sourcePath, "results.data.comps");
  assert.equal(gate.rawMeasuredCount, 0);
  assert.equal(gate.pageMeasuredCount, 0);
  assert.deepEqual(gate.leaders, []);
});

test("official trend gate never exposes a partial top three", () => {
  const gate = inspectOfficialCompTrendGate(responseWith({
    409001: { "Average Placement Change": -0.25 },
    409002: { "Average Placement Change": -0.11 },
    409003: { "Average Placement Change": -0.10 },
    409004: { average_placement_change: -0.50 },
    409005: { "Average Placement Change": null },
    409006: { "Average Placement Change": "" }
  }));
  assert.equal(gate.status, "insufficient");
  assert.equal(gate.measuredCount, 3);
  assert.equal(gate.eligibleCount, 2);
  assert.deepEqual(gate.leaders, []);
});

test("official trend gate returns the real three only after the exact threshold is met", () => {
  const gate = inspectOfficialCompTrendGate(responseWith({
    409001: { "Average Placement Change": -0.18 },
    409002: { "Average Placement Change": -0.38 },
    409003: { "Average Placement Change": -0.25 },
    409004: { "Average Placement Change": -0.09 }
  }));
  assert.equal(gate.ready, true);
  assert.equal(gate.status, "ready");
  assert.deepEqual(gate.leaders, [
    { clusterId: "409002", avgPlacementChange: -0.38 },
    { clusterId: "409003", avgPlacementChange: -0.25 },
    { clusterId: "409001", avgPlacementChange: -0.18 }
  ]);
});

test("official trend gate reproduces MetaTFT page values from daily trends", () => {
  const response = responseWith(undefined);
  response.results.data.cluster_details = {
    409045: { trends: [
      { day: "2026-07-14", count: 28000, avg: 4.4269 },
      { day: "2026-07-15", count: 30000, avg: 4.20 },
      { day: "2026-07-16", count: 31719, avg: 4.1058 },
      { day: "2026-07-17", count: 5621, avg: 4.0578 }
    ] },
    409054: { trends: [
      { day: "2026-07-14", count: 1694, avg: 4.4227 },
      { day: "2026-07-15", count: 3891, avg: 4.3007 },
      { day: "2026-07-16", count: 4886, avg: 4.2341 },
      { day: "2026-07-17", count: 772, avg: 4.2785 }
    ] },
    409066: { trends: [
      { day: "2026-07-14", count: 1820, avg: 6.0780 },
      { day: "2026-07-15", count: 4694, avg: 4.7831 },
      { day: "2026-07-16", count: 7295, avg: 4.5391 },
      { day: "2026-07-17", count: 1396, avg: 4.5372 }
    ] }
  };
  const gate = inspectOfficialCompTrendGate(response);
  assert.equal(gate.ready, true);
  assert.equal(gate.sourceType, "page_calculated");
  assert.equal(gate.sourcePath, "results.data.cluster_details[*].trends");
  assert.deepEqual(gate.leaders.map((entry) => [entry.clusterId, Number(entry.avgPlacementChange.toFixed(2))]), [
    ["409066", -1.54],
    ["409045", -0.32],
    ["409054", -0.19]
  ]);
});

test("comps page snapshot preserves the exact upstream gate for cold-start diagnostics", () => {
  const snapshot = createCompsPageSnapshot(responseWith(undefined), {
    cluster_id: 409,
    results: [{ cluster: "", places: [0] }]
  });
  assert.equal(snapshot.officialTrendGate.status, "field_missing");
  assert.equal(snapshot.officialTrendGate.ready, false);
  assert.deepEqual(snapshot.officialTrendGate.leaders, []);
});
