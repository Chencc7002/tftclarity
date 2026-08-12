import assert from "node:assert/strict";
import test from "node:test";
import {
  BilibiliStrategyVideoService,
  resolveBilibiliMcpConfig
} from "../services/bilibili/service.mjs";

function video(id, publishedAt, overrides = {}) {
  return {
    source: "bilibili",
    videoId: id,
    url: `https://www.bilibili.com/video/${id}`,
    title: `霞攻略 ${id}`,
    tags: "云顶之弈 攻略",
    authorName: "UP",
    publishedAt,
    viewCount: 1000,
    searchRank: 1,
    raw: {},
    ...overrides
  };
}

const config = resolveBilibiliMcpConfig({
  recallLimit: 10,
  detailLimit: 5,
  resultLimit: 5,
  minCurrentResults: 3,
  patchWindows: [
    { patchId: "18.3", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" },
    { patchId: "18.2", startAt: "2026-07-22T00:00:00Z", endAt: "2026-08-05T00:00:00Z" }
  ]
}, {});

test("strategy video service searches, enriches, ranks and traces current-patch videos", async () => {
  const adapter = {
    detailToolName: "bilibili-video-detail",
    async searchVideos() {
      return {
        toolName: "bilibili-search-summary",
        warnings: [],
        videos: [
          video("BV0000000001", "2026-08-08"),
          video("BV0000000002", "2026-08-07"),
          video("BV0000000003", "2026-08-06"),
          video("BV0000000004", "2026-08-01", { viewCount: 1_000_000 })
        ]
      };
    },
    async getVideoDetail({ videoId }) {
      return {
        warnings: [],
        video: { videoId, viewCount: 50000, likeCount: 4000, favoriteCount: 2000, coinCount: 1000 }
      };
    }
  };
  const service = new BilibiliStrategyVideoService({
    adapter,
    config,
    now: () => new Date("2026-08-10T00:00:00Z").getTime()
  });
  const result = await service.search({ query: "霞", limit: 5 }, {
    currentPatch: "18.3",
    previousPatch: "18.2"
  });
  assert.equal(result.status, "found");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.videos.length, 3);
  assert.ok(result.videos.every((entry) => entry.patchTimeStatus === "current"));
  assert.equal(result.detailSucceeded, 4);
  assert.equal(result.videos[0].evidence.searchTool, "bilibili-search-summary");
  assert.equal(result.videos[0].evidence.patchId, "18.3");
  assert.equal("raw" in result.videos[0], false);
});

test("detail failure degrades to clickable search results and previous-patch fallback", async () => {
  const adapter = {
    detailToolName: "bilibili-video-detail",
    async searchVideos() {
      return {
        toolName: "bilibili-search-summary",
        warnings: [],
        videos: [
          video("BV0000000001", "2026-08-08"),
          video("BV0000000002", "2026-08-01"),
          video("BV0000000003", "2026-07-30")
        ]
      };
    },
    async getVideoDetail() {
      throw Object.assign(new Error("down"), { code: "bilibili_mcp_tool_error" });
    }
  };
  const service = new BilibiliStrategyVideoService({ adapter, config });
  const result = await service.search({ query: "霞" }, {
    currentPatch: "18.3",
    previousPatch: "18.2"
  });
  assert.equal(result.status, "found");
  assert.equal(result.fallbackType, "previous_patch");
  assert.equal(result.videos.length, 3);
  assert.ok(result.videos.every((entry) => entry.detailStatus === "unavailable"));
  assert.ok(result.videos.every((entry) => entry.detailFailureCode === "bilibili_mcp_tool_error"));
  assert.ok(result.videos.every((entry) => entry.url.startsWith("https://")));
});

test("search failure returns structured unavailable evidence without fabricating videos", async () => {
  const service = new BilibiliStrategyVideoService({
    config,
    adapter: {
      async searchVideos() {
        throw Object.assign(new Error("network"), { code: "bilibili_mcp_timeout" });
      }
    }
  });
  const result = await service.search({ query: "霞" }, { currentPatch: "18.3" });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.videos, []);
  assert.equal(result.failure.code, "bilibili_mcp_timeout");
});

test("Golden Spatula results use an isolated patch window and ecosystem evidence", async () => {
  const goldenConfig = resolveBilibiliMcpConfig({
    resultLimit: 5,
    goldenSpatulaCurrentPatch: "S15.4",
    goldenSpatulaPatchWindows: [
      { patchId: "S15.4", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" }
    ]
  }, {});
  const adapter = {
    async searchVideos() {
      return {
        toolName: "bilibili-search-summary",
        warnings: [],
        videos: [video("BVGOLDEN0001", "2026-08-08", { tags: "金铲铲之战 阵容攻略" })]
      };
    },
    async getVideoDetail({ videoId }) {
      return { warnings: [], video: { videoId, detailViewCount: 5000, favoriteCount: 500 } };
    }
  };
  const service = new BilibiliStrategyVideoService({ adapter, config: goldenConfig });
  const result = await service.search({ query: "金铲铲之战 霞阵容攻略" });
  assert.equal(result.status, "found");
  assert.equal(result.requestedEcosystem, "golden_spatula");
  assert.equal(result.ecosystemSource, "explicit");
  assert.equal(result.resultShortage, true);
  assert.equal(result.videos[0].patchTimeStatus, "current");
  assert.equal(result.videos[0].evidence.patchEcosystem, "golden_spatula");
});

test("explicit dual request returns two separately ranked groups", async () => {
  const dualConfig = resolveBilibiliMcpConfig({
    tftPatchWindows: [{ patchId: "18.3", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" }],
    goldenSpatulaPatchWindows: [{ patchId: "S15.4", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" }],
    goldenSpatulaCurrentPatch: "S15.4"
  }, {});
  const searchQueries = [];
  const adapter = {
    async searchVideos({ query }) {
      searchQueries.push(query);
      const golden = query.includes("金铲铲");
      return {
        toolName: "bilibili-search-summary",
        warnings: [],
        videos: [video(golden ? "BVGOLDEN0002" : "BVTFT0000002", "2026-08-08", {
          tags: golden ? "金铲铲之战 阵容攻略" : "云顶之弈 阵容攻略"
        })]
      };
    },
    async getVideoDetail({ videoId }) {
      return { warnings: [], video: { videoId, detailViewCount: 5000 } };
    }
  };
  const service = new BilibiliStrategyVideoService({ adapter, config: dualConfig });
  const result = await service.search({ query: "云顶之弈和金铲铲分别找霞攻略" }, { currentPatch: "18.3" });
  assert.equal(result.status, "found");
  assert.deepEqual(result.groups.map((group) => group.ecosystem), ["tft_pc", "golden_spatula"]);
  assert.deepEqual(result.groups.map((group) => group.videos.length), [1, 1]);
  assert.ok(result.groups.every((group) => group.resultShortage === true));
  assert.equal(result.videos.length, 0);
  assert.match(searchQueries[0], /云顶之弈/u);
  assert.doesNotMatch(searchQueries[0], /和|分别|金铲铲/u);
  assert.doesNotMatch(searchQueries[0], /金铲铲/u);
  assert.match(searchQueries[1], /金铲铲之战/u);
  assert.doesNotMatch(searchQueries[1], /云顶之弈/u);
});

test("explicit ecosystem=both preserves dual scope when the model sends a concise query", async () => {
  const adapter = {
    detailToolName: "bilibili-video-detail",
    async searchVideos(input) {
      const golden = input.query.includes("金铲铲");
      return {
        toolName: "bilibili-search-summary",
        videos: [video(golden ? "BVGOLDENSCOPE" : "BVTFTSCOPE001", "2026-08-08", {
          title: golden ? "金铲铲九五阵容攻略" : "云顶之弈九五阵容攻略",
          tags: golden ? "金铲铲之战 阵容攻略" : "云顶之弈 阵容攻略"
        })]
      };
    },
    async getVideoDetail({ videoId }) {
      return { video: { videoId, viewCount: 1000 } };
    }
  };
  const service = new BilibiliStrategyVideoService({ adapter, config });
  const result = await service.search({ query: "九五阵容攻略", ecosystem: "both" });
  assert.equal(result.requestedEcosystem, "both");
  assert.deepEqual(result.groups.slice(0, 2).map((group) => group.ecosystem), ["tft_pc", "golden_spatula"]);
});

test("single-ecosystem selection prefers exact ecosystem and uses cross videos only as supplements", async () => {
  const noWindowConfig = resolveBilibiliMcpConfig({ resultLimit: 1, recallLimit: 5, detailLimit: 0 }, {});
  const service = new BilibiliStrategyVideoService({
    config: noWindowConfig,
    adapter: {
      async searchVideos() {
        return {
          toolName: "bilibili-search-summary",
          warnings: [],
          videos: [
            video("BVCROSS00001", "2026-08-10", { title: "云顶之弈 金铲铲 霞阵容攻略", tags: "云顶之弈 金铲铲" }),
            video("BVTFTEXACT01", "2026-08-09", { title: "云顶之弈 霞阵容攻略", tags: "云顶之弈 攻略", searchRank: 2 })
          ]
        };
      }
    }
  });
  const result = await service.search({ query: "云顶之弈 霞阵容攻略", limit: 1 });
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].videoId, "BVTFTEXACT01");
  assert.equal(result.videos[0].ecosystem, "tft_pc");
});

test("cross-ecosystem supplements use the requested ecosystem patch window", async () => {
  const crossConfig = resolveBilibiliMcpConfig({
    resultLimit: 1,
    detailLimit: 0,
    tftPatchWindows: [
      { patchId: "18.3", startAt: "2026-08-05T00:00:00Z", endAt: "2026-08-19T00:00:00Z" }
    ]
  }, {});
  const service = new BilibiliStrategyVideoService({
    config: crossConfig,
    adapter: {
      async searchVideos() {
        return {
          toolName: "bilibili-search-summary",
          warnings: [],
          videos: [video("BVCROSS00003", "2026-08-10", {
            title: "云顶之弈 金铲铲 霞阵容攻略",
            tags: "云顶之弈 金铲铲之战 攻略"
          })]
        };
      }
    }
  });
  const result = await service.search({ query: "云顶之弈 霞阵容攻略", limit: 1 }, { currentPatch: "18.3" });
  assert.equal(result.videos[0].ecosystem, "cross_ecosystem");
  assert.equal(result.videos[0].patchTimeStatus, "current");
  assert.equal(result.videos[0].patchTimeReason, null);
});

test("dual search displays a duplicated cross-ecosystem video only once", async () => {
  const noWindowConfig = resolveBilibiliMcpConfig({ resultLimit: 2, recallLimit: 5, detailLimit: 0 }, {});
  const service = new BilibiliStrategyVideoService({
    config: noWindowConfig,
    adapter: {
      async searchVideos() {
        return {
          toolName: "bilibili-search-summary",
          warnings: [],
          videos: [video("BVCROSS00002", "2026-08-10", {
            title: "云顶之弈 金铲铲 霞阵容运营攻略",
            tags: "云顶之弈 金铲铲之战 攻略"
          })]
        };
      }
    }
  });
  const result = await service.search({ query: "云顶之弈和金铲铲分别找霞攻略", limit: 2 });
  assert.deepEqual(result.groups.map((group) => group.ecosystem), ["tft_pc", "golden_spatula", "cross_ecosystem"]);
  assert.equal(result.groups[0].videos.length, 0);
  assert.equal(result.groups[1].videos.length, 0);
  assert.equal(result.groups[2].videos.length, 1);
  assert.equal(result.groups[2].videos[0].evidence.patchWindowEcosystem, null);
  assert.equal(result.groups.flatMap((group) => group.videos).filter((entry) => entry.videoId === "BVCROSS00002").length, 1);
});
