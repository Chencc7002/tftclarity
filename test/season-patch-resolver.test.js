import test from "node:test";
import assert from "node:assert/strict";
import {
  createPatchResolver,
  parseLatestTftPatch,
  resolveLatestTftPatch
} from "../src/season/patch-resolver.js";
import { SeasonContextService } from "../src/season/season-context.js";

test("parseLatestTftPatch picks the highest patch mention", () => {
  assert.equal(parseLatestTftPatch("Patch 17.7 notes and 17.8 preview 17.6"), "17.8");
  assert.equal(parseLatestTftPatch("no patch here"), null);
  assert.equal(parseLatestTftPatch(""), null);
});

test("resolveLatestTftPatch fails closed on non-ok or throwing fetch", async () => {
  assert.equal(await resolveLatestTftPatch({ fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await resolveLatestTftPatch({
    fetchImpl: async () => {
      throw new Error("offline");
    }
  }), null);
});

test("resolveLatestTftPatch parses official news html", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async text() {
      return "<html>Teamfight Tactics Patch 17.7 / 17.8 coming</html>";
    }
  });
  assert.equal(await resolveLatestTftPatch({ fetchImpl }), "17.8");
});

test("createPatchResolver prefers configured patch without network", async () => {
  let calls = 0;
  const resolver = createPatchResolver({
    configuredPatch: "17.8",
    previousPatch: "17.7",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, text: async () => "Patch 17.9" };
    }
  });
  const state = await resolver.ensureFresh();
  assert.equal(state.currentPatch, "17.8");
  assert.equal(state.source, "configured");
  assert.equal(calls, 0);
});

test("createPatchResolver resolves official patch and derives the previous patch", async () => {
  const resolver = createPatchResolver({
    fetchImpl: async () => ({ ok: true, text: async () => "Patch 17.8 notes" })
  });
  const state = await resolver.refresh();
  assert.equal(state.currentPatch, "17.8");
  assert.equal(state.previousPatch, "17.7");
  assert.equal(state.source, "official_riot_news");
  assert.ok(state.resolvedAt);
});

test("createPatchResolver keeps fallback state when resolution fails", async () => {
  const resolver = createPatchResolver({
    fetchImpl: async () => {
      throw new Error("offline");
    }
  });
  const state = await resolver.ensureFresh();
  assert.equal(state.currentPatch, null);
  assert.equal(state.source, "season_context");
});

test("SeasonContextService.updateProviderPatch replaces current and previous patch", () => {
  const service = new SeasonContextService();
  const updated = service.updateProviderPatch("set17-live", "17.9", "17.8", "official_riot_news");
  assert.equal(updated.source.currentPatch, "17.9");
  assert.equal(updated.source.previousPatch, "17.8");
  assert.equal(updated.patchResolution.source, "official_riot_news");
  const resolved = service.resolveForQuery("set17-live");
  assert.equal(resolved.currentPatch, "17.9");
  assert.equal(resolved.previousPatch, "17.8");
});
