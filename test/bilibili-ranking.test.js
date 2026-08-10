import assert from "node:assert/strict";
import test from "node:test";
import {
  attachRankingSignals,
  classifyPatchTime,
  interactionSignals,
  selectPatchAwareResults,
  sortRankedVideos
} from "../services/bilibili/ranking.mjs";

const windows = {
  current: { patchId: "18.3", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" },
  previous: { patchId: "18.2", startAt: "2026-07-22T00:00:00Z", endAt: "2026-08-05T00:00:00Z" }
};

test("patch time classification never guesses when publish time or windows are missing", () => {
  assert.equal(classifyPatchTime("2026-08-08", windows), "current");
  assert.equal(classifyPatchTime("2026-08-01", windows), "previous");
  assert.equal(classifyPatchTime("2026-07-01", windows), "older");
  assert.equal(classifyPatchTime(null, windows), "unknown");
  assert.equal(classifyPatchTime("2026-08-08", {}), "unknown");
});

test("current patch accepts an open-ended online patch window", () => {
  assert.equal(classifyPatchTime("2026-08-09T00:00:00Z", {
    current: { patchId: "17.8", startAt: "2026-07-28T18:00:00Z", endAt: null },
    previous: { patchId: "17.7", startAt: "2026-07-14T18:00:00Z", endAt: "2026-07-28T18:00:00Z" }
  }), "current");
});

test("patch-aware selection uses previous and older videos only as explicit fallback", () => {
  const current = Array.from({ length: 2 }, (_, index) => ({ videoId: `c${index}`, patchTimeStatus: "current" }));
  const previous = Array.from({ length: 4 }, (_, index) => ({ videoId: `p${index}`, patchTimeStatus: "previous" }));
  const selected = selectPatchAwareResults([...current, ...previous], {
    resultLimit: 5,
    minCurrentResults: 3
  });
  assert.equal(selected.fallbackUsed, true);
  assert.equal(selected.fallbackType, "previous_patch");
  assert.deepEqual(selected.videos.map((video) => video.videoId), ["c0", "c1", "p0", "p1", "p2"]);

  const olderOnly = selectPatchAwareResults([
    { videoId: "old", patchTimeStatus: "older" }
  ]);
  assert.equal(olderOnly.fallbackType, "older_patch");
});

test("small-sample protection prevents a 20-view outlier from winning on rate alone", () => {
  const tiny = interactionSignals({ viewCount: 20, favoriteCount: 10 });
  const established = interactionSignals({ viewCount: 100000, favoriteCount: 5000 });
  assert.ok(tiny.favoriteRate > established.favoriteRate);
  assert.ok(tiny.interactionScore < established.interactionScore);

  const ranked = sortRankedVideos(attachRankingSignals([
    { videoId: "tiny", title: "霞攻略", searchRank: 1, patchTimeStatus: "current", publishedAt: "2026-08-08", viewCount: 20, favoriteCount: 10 },
    { videoId: "established", title: "霞攻略", searchRank: 2, patchTimeStatus: "current", publishedAt: "2026-08-08", viewCount: 100000, favoriteCount: 5000 }
  ], { query: "霞", now: new Date("2026-08-10").getTime() }));
  assert.equal(ranked[0].videoId, "established");
});

test("ranking shows current-patch and newer videos before older high-score results", () => {
  const ranked = sortRankedVideos([
    { videoId: "old-high-score", patchTimeStatus: "older", publishedAt: "2026-06-01", rankingSignals: { totalScore: 0.99 } },
    { videoId: "current-older", patchTimeStatus: "current", publishedAt: "2026-08-07", rankingSignals: { totalScore: 0.95 } },
    { videoId: "current-newest", patchTimeStatus: "current", publishedAt: "2026-08-10", rankingSignals: { totalScore: 0.5 } },
    { videoId: "unknown-new", patchTimeStatus: "unknown", publishedAt: "2026-08-09", rankingSignals: { totalScore: 0.98 } }
  ]);
  assert.deepEqual(ranked.map((video) => video.videoId), [
    "current-newest",
    "current-older",
    "unknown-new",
    "old-high-score"
  ]);
});
