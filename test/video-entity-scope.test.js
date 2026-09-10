import assert from "node:assert/strict";
import test from "node:test";
import { createVideoEntityScope } from "../src/domain/tft/video-entity-scope.js";
import { BilibiliStrategyVideoService, resolveBilibiliMcpConfig } from "../services/bilibili/service.mjs";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { unitDisplayOverrideByApiName } from "../src/data/entity-display-overrides.js";

const catalog = {
  units: [
    { apiName: "TFT17_MasterYi", zhName: "易", aliases: ["剑圣", "无极剑圣", "Master Yi", "Yi"] },
    { apiName: "TFT17_Xayah", zhName: "霞", aliases: ["逆羽", "Xayah"] }
  ],
  items: [
    { apiName: "rageblade", zhName: "鬼索的狂暴之刃", aliases: ["羊刀", "鬼索"] },
    { apiName: "radiant-rageblade", zhName: "鬼索的清算", aliases: ["光明羊刀"] },
    { apiName: "edge", zhName: "无尽之刃", aliases: ["无尽"] }
  ],
  traits: [
    { apiName: "TFT17_Brawler", zhName: "斗士", aliases: ["格斗家"] },
    { apiName: "TFT17_Stargazer", zhName: "观星者", aliases: ["观星"] }
  ],
  augments: [{ apiName: "augment-test", zhName: "测试强化", aliases: ["强化别名"] }]
};
const resources = { catalog };

test("the actual S18 catalog retains the requested Master Yi aliases", () => {
  const record = unitDisplayOverrideByApiName.get("DA_18_MasterYi_AD");
  for (const query of ["剑圣", "易", "无极剑圣", "Master Yi"]) {
    const matcher = createVideoEntityScope(query, { catalog: { units: [record] } });
    assert.equal(matcher.scope.status, "resolved");
    assert.equal(matcher.matchTitle("云顶之弈 剑圣教学").accepted, true);
    assert.equal(matcher.matchTitle("云顶之弈 霞教学").accepted, false);
  }
});

test("entity titles resolve canonical names, aliases, traditional Chinese and Latin boundaries", () => {
  const matcher = createVideoEntityScope("帮我找剑圣的视频", resources);
  assert.equal(matcher.scope.status, "resolved");
  for (const title of ["云顶之弈 无极剑圣", "三星易主C", "雲頂 劍聖攻略", "TFT Master Yi guide"]) {
    assert.equal(matcher.matchTitle(title).accepted, true, title);
  }
  for (const title of ["霞阵容教学", "轻易吃鸡", "简单容易上分", "轻易主C上分", "TFT playing guide"]) {
    assert.equal(matcher.matchTitle(title).accepted, false, title);
  }
  assert.equal(createVideoEntityScope("易", resources).scope.entities.length, 1);
  assert.equal(createVideoEntityScope("轻易上分的视频", resources).scope.status, "unscoped");
});

test("items, traits and augments share title matching; longest item identity wins", () => {
  for (const [query, good, bad] of [
    ["羊刀攻略", "鬼索的狂暴之刃教学", "无尽之刃教学"],
    ["斗士阵容视频", "格斗家剑圣攻略", "观星霞教学"],
    ["强化别名", "测试强化教学", "其他强化教学"]
  ]) {
    const matcher = createVideoEntityScope(query, resources);
    assert.equal(matcher.matchTitle(good).accepted, true);
    assert.equal(matcher.matchTitle(bad).accepted, false);
  }
  assert.equal(createVideoEntityScope("羊刀", resources).matchTitle("光明羊刀教学").accepted, false);
  const radiant = createVideoEntityScope("光明羊刀", resources);
  assert.deepEqual(radiant.scope.entities.map((entity) => entity.id), ["item:radiant-rageblade"]);
});

test("composition descriptors require every constituent; alternatives retain OR semantics", () => {
  const matcher = createVideoEntityScope("斗士剑圣阵容视频", resources);
  assert.equal(matcher.scope.entities.length, 2);
  assert.equal(matcher.matchTitle("格斗家 无极剑圣教学").accepted, true);
  assert.equal(matcher.matchTitle("斗士霞教学").accepted, false);
  assert.equal(matcher.matchTitle("剑圣教学").accepted, false);
  const alternative = createVideoEntityScope("剑圣或霞的视频", resources);
  assert.equal(alternative.matchTitle("逆羽教学").accepted, true);
  assert.equal(createVideoEntityScope("剑圣/易", resources).scope.entities.length, 1);
  const withItem = createVideoEntityScope("剑圣/易羊刀", resources);
  assert.equal(withItem.scope.operator, "all");
  assert.equal(withItem.matchTitle("剑圣教学").accepted, false);
  assert.equal(createVideoEntityScope("剑圣和霞或羊刀", resources).scope.status, "ambiguous");
});

test("known composition identities use their own aliases and do not match just any member", () => {
  const input = { catalog: { ...catalog, compositions: [
    { compId: "comp-1", name: "斗士剑圣", aliases: ["格斗易", "测试阵容名"] }
  ] } };
  const matcher = createVideoEntityScope("测试阵容名的视频", input);
  assert.equal(matcher.matchTitle("斗士剑圣教学").accepted, true);
  assert.equal(matcher.matchTitle("斗士霞教学").accepted, false);
  assert.equal(createVideoEntityScope("剑圣", input).matchTitle("斗士剑圣教学").accepted, true);
  const fromProvider = createVideoEntityScope("测试阵容名", {
    catalog, compsData: { compOptions: [{ cluster: 123, comp_name: "测试阵容名" }] }
  });
  assert.equal(fromProvider.scope.entities[0].type, "composition");
  const fromCluster = createVideoEntityScope("测试阵容名", {
    catalog, compsData: { latestClusterInfo: [{ Cluster: 123, name_string: "测试阵容名" }] }
  });
  assert.equal(fromCluster.scope.entities[0].type, "composition");
});

test("ambiguous names, missing catalogs and exclusions do not silently widen exact scope", () => {
  const ambiguous = createVideoEntityScope("羊刀", { catalog: { ...catalog,
    items: [...catalog.items, { apiName: "duplicate", name: "其他装备", aliases: ["羊刀"] }]
  } });
  assert.equal(ambiguous.scope.status, "ambiguous");
  assert.equal(ambiguous.matchTitle("羊刀教学").accepted, false);
  assert.equal(createVideoEntityScope("剑圣不要霞", resources).scope.status, "ambiguous");
  assert.equal(createVideoEntityScope("剑圣", {}).matchTitle("剑圣教学").accepted, false);
  const absent = createVideoEntityScope("剑圣", { catalog: {
    units: [{ ...catalog.units[0], current: false }], items: catalog.items
  } });
  assert.equal(absent.scope.status, "unscoped");
  assert.equal(createVideoEntityScope("当前版本热门阵容视频", resources).scope.status, "unscoped");
});

function video(videoId, title, extra = {}) {
  return { videoId, title, url: `https://www.bilibili.com/video/${videoId}`,
    tags: "云顶之弈", publishedAt: "2026-09-09", searchRank: 1, ...extra };
}
function service(mode, videos, detail = {}) {
  const calls = [];
  return { calls, instance: new BilibiliStrategyVideoService({
    now: () => Date.parse("2026-09-09T00:00:00Z"),
    config: resolveBilibiliMcpConfig({ entityMatchMode: mode }, {}),
    adapter: {
      async searchVideos(input) { calls.push(["search", input]); return { videos, warnings: [] }; },
      async getVideoDetail({ videoId }) {
        calls.push(["detail", videoId]); return { video: detail[videoId] ?? {}, warnings: [] };
      }
    }
  }) };
}

test("enforce filters before detail and after changed titles; unrelated descriptions cannot pass", async () => {
  const { instance, calls } = service("enforce", [
    video("good", "剑圣教学"),
    video("bad", "霞教学", { description: "剑圣 易 无极剑圣", viewCount: 1000000 }),
    video("changed", "剑圣攻略")
  ], { changed: { title: "霞攻略" } });
  const result = await instance.search({ query: "剑圣视频" }, resources);
  assert.equal(result.status, "found");
  assert.deepEqual(result.videos.map((entry) => entry.videoId), ["good"]);
  assert.equal(calls.some(([method, id]) => method === "detail" && id === "bad"), false);
  assert.equal(result.entityFilter.rejected, 1);
  assert.equal(result.entityFilter.detailTitleRejected, 1);
  assert.equal(result.videos[0].evidence.titleEntityMatch.accepted, true);
});

test("shadow preserves legacy results and tool calls; off restores the original behavior", async () => {
  const videos = [video("unrelated", "霞教学"), video("good", "剑圣教学")];
  const off = service("off", videos);
  const shadow = service("shadow", videos);
  const a = await off.instance.search({ query: "剑圣" }, resources);
  const b = await shadow.instance.search({ query: "剑圣" }, resources);
  assert.deepEqual(a.videos, b.videos);
  assert.deepEqual(off.calls, shadow.calls);
  assert.equal(b.entityFilter.mode, "shadow");
  assert.deepEqual(b.entityFilter.returnedOutsideScope, ["unrelated"]);
  assert.equal(resolveBilibiliMcpConfig({}, {}).entityMatchMode, "shadow");
});

test("no matches returns empty results, including cross-ecosystem and old-patch candidates", async () => {
  const { instance } = service("enforce", [
    video("other", "云顶之弈 金铲铲之战 霞教学", { publishedAt: "2026-01-01" })
  ]);
  const result = await instance.search({ query: "羊刀", ecosystem: "both" }, resources);
  assert.equal(result.status, "no_results");
  assert.ok(result.groups.every((group) => group.videos.length === 0));
});

test("registered handler uses server resources and forwards cancellation; clients cannot replace the catalog", async () => {
  const { instance } = service("enforce", [video("good", "剑圣教学"), video("bad", "霞教学")]);
  const { handlers } = createTftToolHandlers({ strategyVideoSearchService: instance,
    loadVideoEntityResources: async () => resources });
  const result = await handlers.strategy_video_search({ query: "剑圣" }, {
    loadVideoEntityResources: async () => ({ catalog: {} })
  });
  assert.deepEqual(result.videos.map((entry) => entry.videoId), ["good"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(handlers.strategy_video_search({ query: "剑圣" }, { signal: controller.signal }),
    { name: "AbortError" });
});

test("mode is server-owned, off does not load resources, and unavailable catalogs are visible", async () => {
  for (const mode of ["off", "shadow", "enforce"]) {
    const { instance } = service(mode, [video("unrelated", "霞攻略")]);
    const seen = [];
    const { handlers } = createTftToolHandlers({ strategyVideoSearchService: instance,
      loadVideoEntityResources: async (context) => { seen.push(context.videoEntityMatchMode); throw new Error("unavailable"); }
    });
    const result = await handlers.strategy_video_search({ query: "剑圣" }, { videoEntityMatchMode: "off" });
    assert.deepEqual(seen, mode === "off" ? [] : [mode]);
    assert.equal(result.videos.length, mode === "enforce" ? 0 : 1);
    if (mode === "enforce") assert.ok(result.warnings.includes("video_entity_scope_catalog_unavailable"));
  }
});

test("old matching entity remains eligible when the current patch only has unrelated titles", async () => {
  const { instance } = service("enforce", [
    video("current", "霞攻略"), video("previous", "鬼索的狂暴之刃攻略", { publishedAt: "2026-08-01", searchRank: 20 })
  ]);
  instance.config.tftPatchWindows = [
    { patchId: "current", startAt: "2026-09-01", endAt: null },
    { patchId: "previous", startAt: "2026-08-01", endAt: "2026-09-01" }
  ];
  const result = await instance.search({ query: "羊刀" }, { ...resources, currentPatch: "current", previousPatch: "previous" });
  assert.deepEqual(result.videos.map((entry) => entry.videoId), ["previous"]);
  assert.equal(result.fallbackType, "previous_patch");
});

test("malformed scope metadata cannot break shadow search or bypass strict filtering", async () => {
  for (const mode of ["shadow", "enforce"]) {
    const { instance } = service(mode, [video("unrelated", "霞教学")]);
    const result = await instance.search({ query: "剑圣" }, { catalog: { units: [null] } });
    assert.equal(result.entityFilter.status, "catalog_unavailable");
    assert.equal(result.videos.length, mode === "shadow" ? 1 : 0);
  }
});
