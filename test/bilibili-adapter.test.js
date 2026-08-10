import assert from "node:assert/strict";
import test from "node:test";
import { BilibiliMcpAdapter, bilibiliAdapterInternals } from "../services/bilibili/adapter.mjs";

test("Bilibili MCP adapter uses the real external tool schemas and normalizes results", async () => {
  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "bilibili-search-summary") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify([{
              title: "<em class=\"keyword\">霞</em> 阵容教学",
              author: "测试UP",
              play_count: 12345,
              duration: "12:34",
              publish_date: "2026-08-08",
              url: "https://www.bilibili.com/video/BV1234567890",
              bvid: "BV1234567890",
              upic: "https://i.example/up.jpg",
              pic: "https://i.example/cover.jpg",
              description: "当前版本霞攻略"
            }])
          }]
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            bvid: "BV1234567890",
            title: "霞 阵容教学",
            publish_date: "2026-08-08",
            owner: { mid: 42, name: "测试UP" },
            stat: { view: 20000, like: 1600, favorite: 900, coin: 500, reply: 80 }
          })
        }]
      };
    }
  };
  const adapter = new BilibiliMcpAdapter({ client });
  const search = await adapter.searchVideos({ query: "霞", page: 1, limit: 10 });
  assert.deepEqual(calls[0], {
    name: "bilibili-search-summary",
    args: { keyword: "霞", page: 1, limit: 10 }
  });
  assert.equal(search.videos[0].videoId, "BV1234567890");
  assert.equal(search.videos[0].title, "霞 阵容教学");
  assert.equal(search.videos[0].durationSeconds, 754);
  assert.equal(search.videos[0].viewCount, 12345);

  const detail = await adapter.getVideoDetail({ videoId: "BV1234567890" });
  assert.deepEqual(calls[1], {
    name: "bilibili-video-detail",
    args: { videoId: "BV1234567890" }
  });
  assert.equal(detail.video.favoriteCount, 900);
  assert.equal(detail.video.coinCount, 500);
  assert.equal(detail.video.authorName, "测试UP");
});

test("Bilibili adapter preserves unknown metrics as null", () => {
  const detail = bilibiliAdapterInternals.normalizeDetail({
    bvid: "BV1234567890",
    stat: { view: 10 }
  }, "BV1234567890");
  assert.equal(detail.viewCount, 10);
  assert.equal(detail.likeCount, null);
  assert.equal(detail.favoriteCount, null);
  assert.equal(detail.coinCount, null);
});

test("Bilibili adapter maps successful but unreadable tool content to a schema failure", async () => {
  const adapter = new BilibiliMcpAdapter({
    client: {
      async callTool() {
        return { content: [{ type: "text", text: "not-json" }] };
      }
    }
  });
  await assert.rejects(
    adapter.searchVideos({ query: "云顶之弈攻略", page: 1, limit: 5 }),
    (error) => error.code === "bilibili_mcp_schema_error"
  );
});

test("Bilibili adapter enforces the requested recall limit when upstream ignores it", async () => {
  const adapter = new BilibiliMcpAdapter({
    client: {
      async callTool() {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(Array.from({ length: 4 }, (_, index) => ({
              bvid: `BV000000000${index}`,
              title: `云顶之弈攻略 ${index}`,
              url: `https://www.bilibili.com/video/BV000000000${index}`
            })))
          }]
        };
      }
    }
  });
  const result = await adapter.searchVideos({ query: "云顶之弈攻略", limit: 2 });
  assert.equal(result.videos.length, 2);
});
