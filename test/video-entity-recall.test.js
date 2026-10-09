import assert from "node:assert/strict";
import test from "node:test";
import { createVideoEntityScope } from "../src/domain/tft/video-entity-scope.js";
import { BilibiliStrategyVideoService, resolveBilibiliMcpConfig } from "../services/bilibili/service.mjs";

const resources = { catalog: {
  units: [{ apiName: "TFT18_MasterYi", name: "易", aliases: ["剑圣", "无极剑圣"] },
    { apiName: "TFT18_Xayah", name: "霞", aliases: ["逆羽"] }],
  items: [{ apiName: "rageblade", name: "鬼索的狂暴之刃", aliases: ["羊刀"] },
    { apiName: "edge", name: "无尽之刃", aliases: ["无尽"] },
    { apiName: "radiant", name: "鬼索的清算", aliases: ["光明羊刀"] }],
  traits: [{ apiName: "brawler", name: "斗士", aliases: ["格斗家"] }],
  compositions: [{ compId: "named", name: "测试命名阵容", aliases: ["测试外号"] }]
} };
const scope = (query) => createVideoEntityScope(query, resources, { policy: "balanced" });
const video = (id, title, extra = {}) => ({ videoId: id, title, url: `https://www.bilibili.com/video/${id}`,
  tags: "云顶之弈", publishedAt: "2026-10-09", searchRank: 1, ...extra });
function setup(search, options = {}, details = async () => ({})) {
  const calls = [], detailCalls = [];
  const instance = new BilibiliStrategyVideoService({
    config: resolveBilibiliMcpConfig({ entityMatchMode: "enforce", entityRecallMode: "enforce", ...options }, {}),
    now: () => Date.parse("2026-10-09"),
    adapter: {
      async searchVideos(input, context) {
        calls.push(input);
        return { toolName: "bilibili-search-summary", videos: await search(input, calls.length, context), warnings: [] };
      },
      async getVideoDetail({ videoId }, context) { detailCalls.push(videoId); return { video: await details(videoId, context), warnings: [] }; }
    }
  });
  return { instance, calls, detailCalls };
}

test("mixed descriptions preserve their subject and rank secondary matches without requiring them", () => {
  for (const [query, good, bad, required] of [
    ["剑圣带羊刀怎么玩", "剑圣攻略", "羊刀霞攻略", "unit:TFT18_MasterYi"],
    ["剑圣带羊刀无尽怎么玩", "剑圣攻略", "羊刀无尽攻略", "unit:TFT18_MasterYi"],
    ["斗士剑圣阵容", "剑圣攻略", "斗士霞攻略", "unit:TFT18_MasterYi"],
    ["羊刀给剑圣怎么样", "羊刀攻略", "剑圣攻略", "item:rageblade"],
    ["剑圣斗士羊刀", "剑圣攻略", "斗士羊刀攻略", "unit:TFT18_MasterYi"]
  ]) {
    const matcher = scope(query);
    assert.deepEqual(matcher.scope.requiredEntityIds, [required], query);
    assert.equal(matcher.matchTitle(good).accepted, true, query);
    assert.equal(matcher.matchTitle(bad).accepted, false, query);
  }
  assert.equal(scope("剑圣带羊刀").matchTitle("剑圣羊刀攻略").preferredMatchCount, 1);
  assert.equal(scope("剑圣带羊刀").matchTitle("剑圣攻略").allEntitiesMatched, false);
});

test("paired empty-result regressions recover relevant core titles without accepting unrelated candidates", async () => {
  for (const [query, title] of [
    ["剑圣带羊刀", "剑圣出装教学"], ["斗士剑圣阵容", "无极剑圣攻略"],
    ["羊刀给剑圣怎么样", "鬼索的狂暴之刃攻略"], ["剑圣带羊刀无尽", "剑圣出装教学"]
  ]) {
    const rows = [video("relevant", title), video("unrelated", "霞阵容教学")];
    const old = setup(async () => rows, { entityRecallMode: "off" });
    const next = setup(async () => rows);
    assert.equal((await old.instance.search({ query }, resources)).videos.length, 0, query);
    const result = await next.instance.search({ query }, resources);
    assert.deepEqual(result.videos.map((v) => v.videoId), ["relevant"], query);
  }
});

test("single entities, named compositions, explicit conjunctions and OR keep precise semantics", () => {
  for (const query of ["剑圣和羊刀", "剑圣羊刀都要", "标题同时包含剑圣羊刀", "剑圣以及羊刀"]) {
    assert.equal(scope(query).matchTitle("剑圣攻略").accepted, false, query);
    assert.equal(scope(query).matchTitle("剑圣羊刀攻略").accepted, true, query);
  }
  assert.equal(scope("剑圣霞").matchTitle("剑圣攻略").accepted, false);
  assert.equal(scope("剑圣或霞").matchTitle("逆羽攻略").accepted, true);
  assert.equal(scope("剑圣/易").scope.requiredEntityIds.length, 1);
  assert.equal(scope("测试外号").matchTitle("测试命名阵容攻略").accepted, true);
  assert.equal(scope("测试外号").matchTitle("剑圣攻略").accepted, false);
  assert.equal(scope("羊刀").matchTitle("光明羊刀攻略").accepted, false);
  assert.equal(scope("易").matchTitle("轻易吃鸡").accepted, false);
  assert.equal(scope("剑圣不要霞").scope.status, "ambiguous");
});

test("balanced selection recovers core-only videos and prefers the fully matching title", async () => {
  const rows = [video("core", "剑圣攻略", { viewCount: 1000000 }), video("full", "剑圣羊刀攻略"), video("wrong", "羊刀霞攻略")];
  const candidate = setup(async () => rows);
  const result = await candidate.instance.search({ query: "剑圣带羊刀", limit: 2 }, resources);
  assert.deepEqual(result.videos.map((v) => v.videoId), ["full", "core"]);
  assert.equal(candidate.calls.length, 1);
  assert.equal(candidate.calls[0].limit, 10, "output limit must not shrink recall");
  assert.equal(result.videos[1].evidence.titleEntityMatch.allEntitiesMatched, false);
  assert.ok(result.warnings.includes("video_entity_secondary_terms_unconfirmed"));
  const legacy = setup(async () => rows, { entityRecallMode: "off" });
  const old = await legacy.instance.search({ query: "剑圣带羊刀", limit: 2 }, resources);
  assert.deepEqual(old.videos.map((v) => v.videoId), ["full"]);
});

test("empty first pass uses simplified query then page two; returned evidence records the actual source", async () => {
  const run = setup(async (input, n) => n === 3 ? [video("found", "无极剑圣攻略"), video("bad", "霞攻略")] : []);
  const result = await run.instance.search({ query: "帮我找剑圣带羊刀的视频", limit: 1 }, resources);
  assert.deepEqual(run.calls.slice(1).map(({ query, page }) => ({ query, page })), [
    { query: "剑圣 云顶之弈", page: 1 }, { query: "剑圣 云顶之弈", page: 2 }
  ]);
  assert.deepEqual(result.videos.map((v) => v.videoId), ["found"]);
  assert.equal(result.videos[0].evidence.searchQuery, "剑圣 云顶之弈");
  assert.equal(result.videos[0].evidence.searchPage, 2);
  assert.equal(result.entityFilter.recallAttempts.length, 3);
  assert.deepEqual(result.entityFilter.returnedOutsideScope, []);
});

test("an already simple query tries a verified alternate alias without repeating the same request", async () => {
  const run = setup(async (input) => input.query === "无极剑圣 云顶之弈" ? [video("found", "剑圣攻略")] : []);
  const result = await run.instance.search({ query: "剑圣", limit: 1 }, resources);
  assert.equal(result.videos.length, 1);
  assert.deepEqual(run.calls.map((c) => c.query), ["剑圣 云顶之弈", "无极剑圣 云顶之弈"]);
});

test("supplement deduplicates results, retains original provenance and does not repeat or expand detail calls", async () => {
  const run = setup(async (_, n) => n === 1 ? [video("one", "剑圣攻略")]
    : [video("one", "剑圣攻略"), video("two", "剑圣羊刀攻略"), video("bad", "霞攻略")], { detailLimit: 1 });
  const result = await run.instance.search({ query: "剑圣带羊刀", limit: 3 }, resources);
  assert.equal(result.videos.length, 2);
  assert.equal(run.calls.length, 3);
  assert.deepEqual(run.detailCalls, ["one"]);
  assert.equal(result.detailRequested, 1);
  assert.equal(result.videos.find((v) => v.videoId === "one").evidence.searchQuery, run.calls[0].query);
});

test("a changed detail title cannot return and its shortage triggers supplementary search", async () => {
  const run = setup(async (_, n) => n === 1 ? [video("changed", "剑圣攻略")] : [video("good", "剑圣攻略")], {},
    async (id) => id === "changed" ? { title: "霞攻略" } : {});
  const result = await run.instance.search({ query: "剑圣", limit: 1 }, resources);
  assert.deepEqual(result.videos.map((v) => v.videoId), ["good"]);
  assert.equal(result.entityFilter.detailTitleRejected, 1);
  assert.equal(run.calls.length, 2);
});

test("supplement failure preserves verified partial results and emits an operational warning", async () => {
  const run = setup(async (_, n) => { if (n > 1) throw new Error("upstream timeout"); return [video("one", "剑圣攻略")]; });
  const result = await run.instance.search({ query: "剑圣", limit: 3 }, resources);
  assert.equal(result.videos.length, 1);
  assert.ok(result.warnings.includes("video_entity_supplement_unavailable"));
  assert.equal(result.searchTool, "bilibili-search-summary");
  assert.equal(run.calls.length, 2);
});

test("secondary matches cannot displace current-patch core results with older videos", async () => {
  const run = setup(async () => [video("current", "剑圣攻略"), video("old", "剑圣羊刀攻略", { publishedAt: "2026-09-01" })], {
    tftPatchWindows: [{ patchId: "new", startAt: "2026-10-01" },
      { patchId: "old", startAt: "2026-09-01", endAt: "2026-10-01" }], detailLimit: 1
  });
  const result = await run.instance.search({ query: "剑圣带羊刀", limit: 1 }, { ...resources, currentPatch: "new", previousPatch: "old" });
  assert.deepEqual(result.videos.map((v) => v.videoId), ["current"]);
  assert.deepEqual(run.detailCalls, ["current"]);
  assert.equal(run.calls.length, 1);
});

test("supplemental lookup receives a bounded signal and preserves partials on its own timeout", async () => {
  const run = setup(async (_, n, context) => {
    if (n === 1) return [video("one", "剑圣攻略")];
    assert.ok(context.signal, "supplements must carry a deadline even without a caller signal");
    throw new DOMException("provider timed out", "TimeoutError");
  });
  const result = await run.instance.search({ query: "剑圣", limit: 2 }, resources);
  assert.equal(result.videos.length, 1);
  assert.equal(result.entityFilter.recallStoppedReason, "upstream_unavailable");
  assert.equal(run.calls.length, 2);
});

test("abort during supplemental search propagates and stops further retrieval/detail calls", async () => {
  const controller = new AbortController();
  const run = setup(async (_, n, context) => {
    assert.ok(context.signal);
    if (n === 2) { controller.abort(); context.signal.throwIfAborted(); }
    return [];
  });
  await assert.rejects(run.instance.search({ query: "剑圣" }, { ...resources, signal: controller.signal }), { name: "AbortError" });
  assert.equal(run.calls.length, 2);
  assert.equal(run.detailCalls.length, 0);
});

test("both ecosystems share the extra-call cap and never substitute nonmatching titles", async () => {
  const run = setup(async () => [video("bad", "云顶之弈 金铲铲之战 霞攻略")]);
  const result = await run.instance.search({ query: "剑圣", ecosystem: "both" }, resources);
  assert.equal(run.calls.length, 4, "two initial calls plus two supplements total");
  assert.equal(result.status, "no_results");
  assert.equal(run.detailCalls.length, 0);
});

test("shadow keeps strict results, order, evidence and calls unchanged while observing candidate recall", async () => {
  const rows = [video("core", "剑圣攻略"), video("full", "剑圣羊刀攻略")];
  const off = setup(async () => rows, { entityRecallMode: "off" });
  const shadow = setup(async () => rows, { entityRecallMode: "shadow" });
  const a = await off.instance.search({ query: "剑圣带羊刀" }, resources);
  const b = await shadow.instance.search({ query: "剑圣带羊刀" }, resources);
  assert.deepEqual(a.videos, b.videos);
  assert.deepEqual(off.calls, shadow.calls);
  assert.deepEqual(off.detailCalls, shadow.detailCalls);
  assert.equal(b.entityFilter.balancedShadow.accepted, 2);
  assert.equal(b.entityFilter.accepted, 1);
  assert.equal(resolveBilibiliMcpConfig({}, {}).entityRecallMode, "shadow");
});

test("recall is server-owned, requires strict entity mode, and does not retry unresolved queries", async () => {
  for (const entityMatchMode of ["off", "shadow"]) {
    const run = setup(async () => [video("bad", "霞攻略")], { entityMatchMode });
    await run.instance.search({ query: "剑圣" }, resources);
    assert.equal(run.calls.length, 1);
  }
  for (const query of ["剑圣不要霞", "当前热门阵容"]) {
    const run = setup(async () => []);
    await run.instance.search({ query, entityRecallMode: "enforce" }, resources);
    assert.equal(run.calls.length, 1);
  }
  const run = setup(async () => [], { entityRecallMode: "off" });
  await run.instance.search({ query: "剑圣" }, { ...resources, entityRecallMode: "enforce" });
  assert.equal(run.calls.length, 1);
});
