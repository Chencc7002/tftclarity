import assert from "node:assert/strict";
import test from "node:test";
import {
  createOnlinePatchWindowProvider,
  parseGoldenSpatulaPatchEntries,
  parseRiotTftPatchEntries
} from "../services/bilibili/patch-window-provider.mjs";

test("Riot patch discovery extracts official patch ids and publish times", () => {
  const entries = parseRiotTftPatchEntries(`
    <a aria-label="Teamfight Tactics patch 17.8"><time dateTime="2026-07-28T18:00:00.000Z"></time></a>
    <a aria-label="Teamfight Tactics patch 17.7"><time dateTime="2026-07-14T18:00:00.000Z"></time></a>
  `);
  assert.deepEqual(entries.map((entry) => entry.patchId), ["17.8", "17.7"]);
  assert.equal(entries[0].startAt, "2026-07-28T18:00:00.000Z");
});

test("Golden Spatula discovery extracts version dates from online update titles", () => {
  const entries = parseGoldenSpatulaPatchEntries(`
    《金铲铲之战》17.7b版本 7月23日更新公告
    《金铲铲之战》17.7版本 7月16日更新公告
  `, new Date("2026-08-10T00:00:00Z").getTime());
  assert.deepEqual(entries.map((entry) => entry.patchId), ["17.7b", "17.7"]);
  assert.equal(entries[0].startAt, "2026-07-23T04:00:00.000Z");
});

test("online patch provider caches current and previous windows", async () => {
  let calls = 0;
  const provider = createOnlinePatchWindowProvider({
    tftSourceUrl: "https://example.test/tft",
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async text() {
          return `
            <a aria-label="Teamfight Tactics patch 17.8"><time dateTime="2026-07-28T18:00:00.000Z"></time></a>
            <a aria-label="Teamfight Tactics patch 17.7"><time dateTime="2026-07-14T18:00:00.000Z"></time></a>
          `;
        }
      };
    }
  }, {});
  const first = await provider.resolve("tft_pc");
  const second = await provider.resolve("tft_pc");
  assert.equal(first.currentPatch, "17.8");
  assert.equal(first.previousPatch, "17.7");
  assert.equal(first.windows[1].endAt, first.windows[0].startAt);
  assert.equal(second.currentPatch, "17.8");
  assert.equal(calls, 1);
});
