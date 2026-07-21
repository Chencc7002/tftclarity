import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildItemCatalogFromItemsResponse,
  buildTraitCatalogFromCompsData,
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromCompsData,
  buildUnitCatalogFromExplorerRows,
  calculatePlacementStats,
  classifyItemApiName,
  clearEntityCandidateIndex,
  createCatalog,
  createEntityCandidateIndex,
  evaluateClarification,
  findItemAvailabilityOverride,
  ITEM_AVAILABILITY_OVERRIDES,
  getOrCreateEntityCandidateIndex,
  mergeCatalogItems,
  normalizeCompBuildsResponse,
  normalizeCompOptionsResponse,
  normalizeLatestClusterInfoResponse,
  normalizeUnitBuildRows,
  JsonFileCacheStore,
  MemoryCacheStore,
  makeDefaultContextCacheKey,
  makeQueryCacheKey,
  MetaTFTClient,
  CompsContextClient,
  createUnavailableCompConstraint,
  SQLITE_CACHE_SCHEMA,
  SQLiteCacheStore,
  planQuery,
  recommendFromRows,
  recommendForInput,
  retrieveEntityCandidates,
  SESSION_LAST_QUERY_KEY,
  selectDefaultContextForUnit,
  validateQueryContext,
  validateStructuredParserOutput
} from "../src/index.js";
import {
  TRAIT_ALIAS_OVERRIDES,
  TRAIT_TIER_COUNTS
} from "../src/data/domain-alias-overrides.js";

const fixtureRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [300, 200, 100, 100, 50, 20, 10, 5]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_SpearOfShojin|TFT_Item_Deathblade",
    placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
  }
];

function readProbeJson(name) {
  return JSON.parse(readFileSync(new URL(`../.probe/${name}`, import.meta.url), "utf8"));
}

function fakeJsonResponse(payload, options = {}) {
  const status = options.status ?? 200;
  const headers = new Map(Object.entries({
    "content-type": "application/json",
    ...(options.headers ?? {})
  }).map(([key, value]) => [key.toLowerCase(), String(value)]));

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: options.statusText ?? (status === 200 ? "OK" : "Error"),
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) ?? null;
      }
    },
    async json() {
      if (options.jsonError) throw options.jsonError;
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

class FakeSQLiteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  run(...params) {
    return this.database.run(this.sql, params);
  }

  get(...params) {
    return this.database.get(this.sql, params);
  }

  all(...params) {
    return this.database.all(this.sql, params);
  }
}

class FakeSQLiteDatabase {
  constructor() {
    this.schema = "";
    this.tables = {
      query_cache: new Map(),
      default_context_cache: new Map(),
      session_state: new Map(),
      user_preferences: new Map(),
      entity_aliases: new Map(),
      query_events: new Map(),
      feedback_events: new Map()
    };
    this.nextEntityAliasId = 1;
    this.nextFeedbackEventId = 1;
  }

  exec(sql) {
    this.schema += sql;
  }

  prepare(sql) {
    return new FakeSQLiteStatement(this, sql);
  }

  run(sql, params) {
    if (/INSERT INTO query_cache/i.test(sql)) {
      const [
        cache_key,
        value_json,
        request_json,
        response_json,
        computed_json,
        source,
        patch,
        expires_at,
        updated_at
      ] = params;
      this.tables.query_cache.set(cache_key, {
        cache_key,
        value_json,
        request_json,
        response_json,
        computed_json,
        source,
        patch,
        expires_at,
        updated_at
      });
      return { changes: 1 };
    }

    if (/INSERT INTO default_context_cache/i.test(sql)) {
      const [
        cache_key,
        unit,
        cluster_id,
        comp_name,
        units_json,
        traits_json,
        value_json,
        source_endpoint,
        rank,
        days,
        patch,
        queue,
        score,
        count,
        avg,
        expires_at,
        updated_at
      ] = params;
      this.tables.default_context_cache.set(cache_key, {
        cache_key,
        unit,
        cluster_id,
        comp_name,
        units_json,
        traits_json,
        value_json,
        source_endpoint,
        rank,
        days,
        patch,
        queue,
        score,
        count,
        avg,
        expires_at,
        updated_at
      });
      return { changes: 1 };
    }

    if (/INSERT INTO user_preferences/i.test(sql)) {
      const [key, value_json, updated_at] = params;
      this.tables.user_preferences.set(key, {
        key,
        value_json,
        updated_at
      });
      return { changes: 1 };
    }

    if (/INSERT INTO session_state/i.test(sql)) {
      const [key, value_json, expires_at, updated_at] = params;
      this.tables.session_state.set(key, {
        key,
        value_json,
        expires_at,
        updated_at
      });
      return { changes: 1 };
    }

    if (/INSERT INTO entity_aliases/i.test(sql)) {
      const [
        alias,
        normalized_alias,
        entity_type,
        api_name,
        confidence,
        source,
        patch,
        enabled,
        updated_at
      ] = params;
      const id = this.nextEntityAliasId++;
      this.tables.entity_aliases.set(id, {
        id,
        alias,
        normalized_alias,
        entity_type,
        api_name,
        confidence,
        source,
        patch,
        enabled,
        updated_at
      });
      return {
        changes: 1,
        lastInsertRowid: id
      };
    }

    if (/INSERT INTO feedback_events/i.test(sql)) {
      const [
        feedback_id,
        query_id,
        visitor_scope,
        feedback_target,
        feedback_type,
        rating,
        card_index,
        reason,
        payload_json,
        status,
        created_at,
        updated_at
      ] = params;
      const duplicate = [...this.tables.feedback_events.values()]
        .find((row) => row.feedback_id === feedback_id);
      if (duplicate) return { changes: 0 };
      const id = this.nextFeedbackEventId++;
      this.tables.feedback_events.set(id, {
        id,
        feedback_id,
        query_id,
        visitor_scope,
        feedback_target,
        feedback_type,
        rating,
        card_index,
        reason,
        payload_json,
        status,
        created_at,
        updated_at
      });
      return {
        changes: 1,
        lastInsertRowid: id
      };
    }

    if (/UPDATE entity_aliases\s+SET enabled = \?, updated_at = \?\s+WHERE id = \?/i.test(sql)) {
      const [enabled, updated_at, id] = params;
      const row = this.tables.entity_aliases.get(id);
      if (!row) return { changes: 0 };
      row.enabled = enabled;
      row.updated_at = updated_at;
      return { changes: 1 };
    }

    if (/DELETE FROM entity_aliases WHERE enabled = \?/i.test(sql)) {
      const enabled = Number(params[0]);
      let changes = 0;
      for (const [id, row] of this.tables.entity_aliases.entries()) {
        if (Number(row.enabled) !== enabled) continue;
        this.tables.entity_aliases.delete(id);
        changes += 1;
      }
      return { changes };
    }

    const deleteByKey = sql.match(/DELETE FROM (\w+) WHERE (\w+) = \?/i);
    if (deleteByKey) {
      const table = this.tables[deleteByKey[1]];
      const deleted = table.delete(params[0]);
      return { changes: deleted ? 1 : 0 };
    }

    const deleteExpired = sql.match(/DELETE FROM (\w+) WHERE expires_at IS NOT NULL AND expires_at <= \?/i);
    if (deleteExpired) {
      let changes = 0;
      for (const [key, row] of this.tables[deleteExpired[1]].entries()) {
        if (row.expires_at && row.expires_at <= params[0]) {
          this.tables[deleteExpired[1]].delete(key);
          changes += 1;
        }
      }
      return { changes };
    }

    const deleteAll = sql.match(/DELETE FROM (\w+)$/i);
    if (deleteAll) {
      const table = this.tables[deleteAll[1]];
      const changes = table.size;
      table.clear();
      return { changes };
    }

    throw new Error(`FakeSQLiteDatabase does not support SQL: ${sql}`);
  }

  get(sql, params) {
    if (/FROM entity_aliases\s+WHERE id = \?/i.test(sql)) {
      return this.tables.entity_aliases.get(params[0]) ?? null;
    }
    if (/FROM feedback_events\s+WHERE feedback_id = \?/i.test(sql)) {
      return [...this.tables.feedback_events.values()]
        .find((row) => row.feedback_id === params[0]) ?? null;
    }
    const match = sql.match(/FROM (\w+) WHERE (\w+) = \?/i);
    if (!match) throw new Error(`FakeSQLiteDatabase does not support SQL: ${sql}`);
    return this.tables[match[1]].get(params[0]) ?? null;
  }

  all(sql, params) {
    if (/FROM entity_aliases/i.test(sql)) {
      let rows = [...this.tables.entity_aliases.values()];
      if (/WHERE normalized_alias = \? AND enabled = \?/i.test(sql)) {
        const [normalizedAlias, enabled] = params;
        rows = rows.filter((row) => row.normalized_alias === normalizedAlias && row.enabled === enabled);
        if (/AND entity_type = \?/i.test(sql)) {
          rows = rows.filter((row) => row.entity_type === params[2]);
        }
        rows.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return b.id - a.id;
        });
      } else {
        let cursor = 0;
        if (/entity_type = \?/i.test(sql)) {
          rows = rows.filter((row) => row.entity_type === params[cursor]);
          cursor += 1;
        }
        if (/api_name = \?/i.test(sql)) {
          rows = rows.filter((row) => row.api_name === params[cursor]);
          cursor += 1;
        }
        if (/patch = \?/i.test(sql)) {
          rows = rows.filter((row) => row.patch === params[cursor]);
          cursor += 1;
        }
        if (/enabled = \?/i.test(sql)) {
          rows = rows.filter((row) => row.enabled === params[cursor]);
          cursor += 1;
        }
        if (/confidence >= \?/i.test(sql)) {
          rows = rows.filter((row) => row.confidence >= params[cursor]);
          cursor += 1;
        }
        if (/normalized_alias = \?/i.test(sql)) {
          rows = rows.filter((row) => row.normalized_alias === params[cursor]);
          cursor += 1;
        }
        if (/lower\(alias\) LIKE \?/i.test(sql)) {
          const needle = String(params[cursor] ?? "").replace(/%/g, "").toLowerCase();
          rows = rows.filter((row) => [
            row.alias,
            row.normalized_alias,
            row.entity_type,
            row.api_name,
            row.source
          ].some((value) => String(value ?? "").toLowerCase().includes(needle)));
          cursor += 5;
        }
        rows.sort((a, b) => b.id - a.id);
      }
      const hasOffset = /LIMIT \? OFFSET \?/i.test(sql);
      const limit = hasOffset ? params[params.length - 2] : (params[params.length - 1] ?? rows.length);
      const offset = hasOffset ? params[params.length - 1] : 0;
      return rows.slice(offset, offset + limit);
    }

    if (/FROM feedback_events/i.test(sql)) {
      const rows = [...this.tables.feedback_events.values()].sort((a, b) => b.id - a.id);
      const limit = params[0] ?? rows.length;
      return rows.slice(0, limit);
    }

    throw new Error(`FakeSQLiteDatabase does not support SQL: ${sql}`);
  }
}

test("plans a standard Xayah Stargazer unit_builds query", () => {
  const result = planQuery("2星霞，3观星，携带哪三件普通装备最好？");

  assert.equal(result.validation.valid, true);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.starLevel, [2]);
  assert.equal(result.query.itemCount, 3);
  assert.deepEqual(result.query.traitFilters, ["TFT17_Stargazer_1"]);
  assert.equal(result.plan.params.unit_tier_numitems_unique, "TFT17_Xayah-1_2_3");
  assert.deepEqual(result.plan.params.trait, ["TFT17_Stargazer_1"]);
});

test("expands multiple star levels into MetaTFT unit_tier_numitems_unique values", () => {
  const result = planQuery("1星和2星霞，3观星，三件普通装备");

  assert.equal(result.validation.valid, true);
  assert.deepEqual(result.query.starLevel, [1, 2]);
  assert.equal(
    result.plan.params.unit_tier_numitems_unique,
    "TFT17_Xayah-1_1_3,TFT17_Xayah-1_2_3"
  );
});

test("normalizes a Traditional Chinese query before planning", () => {
  const result = planQuery("２星霞，３觀星，攜帶哪三件普通裝備最好？");

  assert.equal(result.validation.valid, true);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.starLevel, [2]);
  assert.deepEqual(result.query.traitFilters, ["TFT17_Stargazer_1"]);
  assert.equal(result.query.itemPolicy, "ordinary_only");
  assert.equal(result.plan.params.unit_tier_numitems_unique, "TFT17_Xayah-1_2_3");
  assert.deepEqual(result.plan.params.trait, ["TFT17_Stargazer_1"]);
});

test("recognizes explicit pinyin aliases for seed and dynamic domain entities", () => {
  const seedResult = planQuery("2星 xia，3guanxing，三件普通装备");
  assert.equal(seedResult.query.unit, "TFT17_Xayah");
  assert.deepEqual(seedResult.query.traitFilters, ["TFT17_Stargazer_1"]);
  assert.equal(seedResult.parsed.parser.highConfidenceEntityResolutions.length, 0);
  assert.equal(seedResult.parsed.parser.entityMatches.some((match) => match.alias === "xia"), true);
  assert.equal(seedResult.parsed.parser.entityMatches.some((match) => match.alias === "guanxing"), true);

  const catalog = createCatalog({
    units: buildUnitCatalogFromExplorerRows({
      data: [{ units_unique: "TFT17_Aatrox-1" }]
    }),
    traits: buildTraitCatalogFromExplorerRows({
      data: [{ traits: "TFT17_Stargazer_1" }]
    })
  });
  const dynamicResult = planQuery("2星 jianmo，3guanxing，三件普通装备", {
    catalog
  });

  assert.equal(dynamicResult.validation.valid, true);
  assert.equal(dynamicResult.query.unit, "TFT17_Aatrox");
  assert.deepEqual(dynamicResult.query.traitFilters, ["TFT17_Stargazer_1"]);
  assert.equal(dynamicResult.parsed.parser.entityMatches.some((match) => match.alias === "jianmo"), true);
});

test("recognizes a pinyin owned item without using fuzzy resolution", () => {
  const result = recommendFromRows("霞3观星，已经有yangdao，剩下两件怎么带？", fixtureRows);

  assert.deepEqual(result.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(result.parsed.parser.highConfidenceEntityResolutions.length, 0);
  assert.equal(result.parsed.parser.entityMatches.some((match) => match.alias === "yangdao"), true);
  assert.equal(result.clarification.blocking, false);
  assert.ok(result.rankedBuilds.length > 0);
  assert.ok(result.rankedBuilds.every((build) => build.items.includes("TFT_Item_GuinsoosRageblade")));
});

test("Traditional Chinese historical alias resolves to the current available item", async () => {
  let compsCalls = 0;
  let explorerCalls = 0;
  const result = await recommendForInput("霞能不能帶盧安娜的颶風？", {
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        return [];
      },
      async getCompOptions() {
        compsCalls += 1;
        return [];
      }
    },
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    },
    useSession: false
  });

  assert.equal(result.localDecision, undefined);
  assert.equal(result.query.ownedItems.includes("TFT_Item_RunaansHurricane"), true);
  assert.equal(result.rankedBuilds[0].items.includes("TFT_Item_RunaansHurricane"), true);
  assert.equal(compsCalls, 0);
  assert.equal(explorerCalls, 1);
});

test("calculates placement_count metrics locally", () => {
  const stats = calculatePlacementStats([100, 90, 80, 70, 60, 50, 40, 30]);

  assert.equal(stats.games, 520);
  assert.equal(Number(stats.winRate.toFixed(4)), 0.1923);
  assert.equal(Number(stats.top4Rate.toFixed(4)), 0.6538);
  assert.equal(Number(stats.avgPlacement.toFixed(4)), 3.6923);
});

test("keeps current red buff plus double Kraken in ordinary rankings", () => {
  const result = recommendFromRows("2星霞，3观星，携带哪三件普通装备最好？", fixtureRows);

  assert.equal(result.rankedBuilds.length, 3);
  assert.deepEqual(result.rankedBuilds[0].items, [
    "TFT_Item_RapidFireCannon",
    "TFT_Item_RunaansHurricane",
    "TFT_Item_RunaansHurricane"
  ]);
  assert.match(result.text, /推荐：红霸符 \+ 海妖之怒 \+ 海妖之怒/);
  assert.match(result.text, /查询条件：2星霞 \/ 3观星/);
  assert.match(result.text, /\/ 当前版本 \/ 近3天/);
  assert.doesNotMatch(result.text, /分裂弓/);
});

test("low-sample builds are shown as reference data without a recommendation claim", () => {
  const result = recommendFromRows("2星霞3观星，样本>=10，普通装备怎么带？", [{
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
  }]);

  assert.equal(result.rankedBuilds.length, 1);
  assert.match(result.text, /^低样本参考：/);
  assert.match(result.text, /仅供参考，不作稳定推荐/);
  assert.doesNotMatch(result.text, /^推荐：/);
});

test("query conditions do not label a custom rank subset as platinum and above", () => {
  const result = recommendFromRows("霞带哪三件装备最好？", fixtureRows, {
    preferences: {
      rankFilter: ["MASTER"]
    }
  });

  assert.match(result.text, /\/ MASTER \/ 样本>=100/);
  assert.doesNotMatch(result.text, /铂金以上/);
});

test("no-result responses retain defaults and default-comp provenance", () => {
  const result = recommendFromRows("霞带哪三件装备最好？", fixtureRows, {
    preferences: {
      minSamples: 1000
    },
    comp: createUnavailableCompConstraint({ stabilityThreshold: 1000 })
  });

  assert.equal(result.rankedBuilds.length, 0);
  assert.match(result.text, /没有找到满足条件的稳定三件套/);
  assert.match(result.text, /系统补全：默认 2星/);
  assert.match(result.text, /当前条件下未找到达到稳定门槛的 Comp；以下结果未限制 Comp/);
});

test("owned item query recommends only the remaining items", () => {
  const result = recommendFromRows("霞已经有羊刀，剩下两件怎么带？", fixtureRows);

  assert.equal(result.query.ownedItems[0], "TFT_Item_GuinsoosRageblade");
  assert.equal(result.query.itemCount, 3);
  assert.match(result.text, /已锁定：羊刀/);
  assert.match(result.text, /推荐补齐：无尽 \+ 巨杀/);
});

test("explicit item exclusions are not treated as owned items and are part of the cache key", () => {
  const rows = [
    fixtureRows[0],
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
    }
  ];
  const result = recommendFromRows("霞不要羊刀，其他三件普通装备怎么带？", rows);

  assert.deepEqual(result.query.ownedItems, []);
  assert.deepEqual(result.query.excludedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(result.rankedBuilds.length, 1);
  assert.equal(result.rankedBuilds[0].items.includes("TFT_Item_GuinsoosRageblade"), false);
  assert.match(result.text, /已排除：羊刀/);
  assert.notEqual(
    makeQueryCacheKey(result.query),
    makeQueryCacheKey({ ...result.query, excludedItems: [] })
  );
});

test("exclusions stay separate from comparison options and do not widen ordinary policy", () => {
  const compared = planQuery("霞比较无尽和巨杀，不要羊刀");
  const ordinary = planQuery("霞不要光明羊刀，只看普通装备");
  const widened = planQuery("霞已有羊刀，剩下两件允许光明装备");

  assert.deepEqual(compared.query.comparison.itemApiNames, [
    "TFT_Item_InfinityEdge",
    "TFT_Item_MadredsBloodrazor"
  ]);
  assert.deepEqual(compared.query.excludedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.deepEqual(compared.query.ownedItems, []);
  assert.equal(ordinary.query.itemPolicy, "ordinary_only");
  assert.deepEqual(ordinary.query.excludedItems, ["TFT5_Item_GuinsoosRagebladeRadiant"]);
  assert.equal(widened.query.itemPolicy, "include_radiant");
  assert.deepEqual(widened.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
});

test("user-specified radiant, artifact, and emblem items widen the local item policy", () => {
  const seedCatalog = createCatalog();
  const catalog = createCatalog({
    items: [
      ...seedCatalog.items,
      {
        apiName: "TFT_Item_Artifact_Fishbones",
        zhName: "鱼骨头",
        shortName: "鱼骨头",
        aliases: ["鱼骨头"],
        category: "artifact",
        current: true,
        obtainable: true
      },
      {
        apiName: "TFT17_Item_DarkStarEmblemItem",
        zhName: "暗星纹章",
        shortName: "暗星转",
        aliases: ["暗星转"],
        category: "emblem",
        current: true,
        obtainable: true
      }
    ]
  });
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [80, 70, 60, 50, 40, 30, 20, 10]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_Artifact_Fishbones|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [70, 60, 50, 40, 30, 20, 10, 5]
    },
    {
      unit_builds: "TFT17_Xayah&TFT17_Item_DarkStarEmblemItem|TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_InfinityEdge",
      placement_count: [60, 50, 40, 30, 20, 10, 5, 5]
    }
  ];

  const radiant = recommendFromRows("霞有光明羊刀，另外两件怎么带？", rows, { catalog });
  const artifact = recommendFromRows("霞有鱼骨头，另外两件怎么带？", rows, { catalog });
  const mixedSpecial = recommendFromRows("霞有暗星转和光明羊刀，剩下一件怎么带？", rows, { catalog });

  assert.equal(radiant.query.itemPolicy, "include_radiant");
  assert.deepEqual(radiant.query.ownedItems, ["TFT5_Item_GuinsoosRagebladeRadiant"]);
  assert.deepEqual(radiant.rankedBuilds[0].items, [
    "TFT5_Item_GuinsoosRagebladeRadiant",
    "TFT_Item_InfinityEdge",
    "TFT_Item_GiantSlayer"
  ]);
  assert.match(radiant.text, /已锁定：光明羊刀/);
  assert.match(radiant.text, /含光明装备/);

  assert.equal(artifact.query.itemPolicy, "include_artifact");
  assert.deepEqual(artifact.query.ownedItems, ["TFT_Item_Artifact_Fishbones"]);
  assert.equal(artifact.rankedBuilds.length, 1);
  assert.match(artifact.text, /已锁定：鱼骨头/);
  assert.match(artifact.text, /含神器装备/);

  assert.equal(mixedSpecial.query.itemPolicy, "include_special");
  assert.deepEqual(mixedSpecial.query.ownedItems, [
    "TFT17_Item_DarkStarEmblemItem",
    "TFT5_Item_GuinsoosRagebladeRadiant"
  ]);
  assert.equal(mixedSpecial.rankedBuilds.length, 1);
  assert.match(mixedSpecial.text, /含特殊装备/);
});

test("generic radiant and artifact build scopes require every returned trio to contain the requested special category", () => {
  const apiNames = [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge",
    "TFT_Item_GiantSlayer",
    "TFT5_Item_GuinsoosRagebladeRadiant",
    "TFT4_Item_OrnnDeathsDefiance"
  ];
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse({
      data: apiNames.map((items) => ({ items }))
    })
  });
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [200, 180, 160, 140, 120, 100, 80, 60]
    },
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [20, 18, 16, 14, 12, 10, 8, 6]
    },
    {
      unit_builds: "TFT17_Xayah&TFT4_Item_OrnnDeathsDefiance|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [18, 16, 14, 12, 10, 8, 6, 4]
    }
  ];

  const radiant = recommendFromRows("霞三件套要包含光明装备", rows, {
    catalog,
    preferences: { minSamples: 0 }
  });
  const artifact = recommendFromRows("霞三件套要包含神器", rows, {
    catalog,
    preferences: { minSamples: 0 }
  });
  const eitherSpecial = recommendFromRows("霞三件套要包含光明装备或神器", rows, {
    catalog,
    preferences: { minSamples: 0 }
  });

  assert.equal(radiant.type, "unit_build_rankings");
  assert.ok(radiant.rankedBuilds.length > 0);
  assert.ok(radiant.rankedBuilds.every((build) => build.items.includes("TFT5_Item_GuinsoosRagebladeRadiant")));
  assert.equal(artifact.type, "unit_build_rankings");
  assert.ok(artifact.rankedBuilds.length > 0);
  assert.ok(artifact.rankedBuilds.every((build) => build.items.includes("TFT4_Item_OrnnDeathsDefiance")));
  assert.equal(eitherSpecial.type, "unit_build_rankings");
  assert.ok(eitherSpecial.rankedBuilds.every((build) => build.items.some((apiName) => (
    ["TFT5_Item_GuinsoosRagebladeRadiant", "TFT4_Item_OrnnDeathsDefiance"].includes(apiName)
  ))));
});

test("radiant, artifact, and emblem questions rank only the requested item category with zero default threshold", () => {
  const apiNames = [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge",
    "TFT5_Item_GuinsoosRagebladeRadiant",
    "TFT5_Item_InfinityEdgeRadiant",
    "TFT4_Item_OrnnDeathsDefiance",
    "TFT4_Item_OrnnInfinityForce",
    "TFT17_Item_HPTankEmblemItem",
    "TFT17_Item_StargazerEmblemItem"
  ];
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse({
      data: apiNames.map((items) => ({ items }))
    })
  });
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [8, 6, 4, 2, 1, 1, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_InfinityEdgeRadiant|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [3, 3, 2, 2, 2, 1, 1, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT4_Item_OrnnDeathsDefiance|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [6, 5, 4, 3, 2, 1, 1, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT4_Item_OrnnInfinityForce|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [2, 2, 2, 2, 1, 1, 1, 1]
    },
    {
      unit_builds: "TFT17_Xayah&TFT17_Item_HPTankEmblemItem|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [5, 4, 3, 2, 1, 1, 1, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT17_Item_StargazerEmblemItem|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [2, 2, 2, 1, 1, 1, 1, 1]
    }
  ];
  const cases = [
    ["霞的光明装备哪个最好？", "radiant", "include_radiant"],
    ["霞最好的光明装备", "radiant", "include_radiant"],
    ["霞的神器哪个好？", "artifact", "include_artifact"],
    ["霞有哪些神器？", "artifact", "include_artifact"],
    ["霞有哪些光明装备？", "radiant", "include_radiant"],
    ["霞的纹章哪个最好？", "emblem", "include_special"],
    ["霞携带什么转职最强？", "emblem", "include_special"],
    ["霞有什么强的转职？", "emblem", "include_special"],
    ["霞应该携带什么转职？", "emblem", "include_special"],
    ["霞哪个转职好？", "emblem", "include_special"]
  ];

  for (const [input, category, itemPolicy] of cases) {
    const result = recommendFromRows(input, rows, {
      catalog,
      preferences: { minSamples: 100 }
    });
    assert.equal(result.type, category === "emblem" ? "unit_emblem_rankings" : "unit_item_rankings", `${input}:${JSON.stringify({
      clarification: result.clarification,
      unit: result.query.unit,
      ambiguities: result.parsed.parser.entityAmbiguities,
      hints: result.parsed.parser.unresolvedEntityHints
    })}`);
    assert.equal(result.query.itemPolicy, itemPolicy, input);
    assert.deepEqual(result.query.itemCategories, [category], input);
    assert.equal(result.query.minSamples, 0, input);
    assert.equal(result.query.constraints.min_samples.source, "system_default", input);
    assert.equal(result.itemRankings.length, 2, input);
    assert.equal(result.itemRankingReferences.length, 0, input);
    assert.ok(result.itemRankings.every((entry) => (
      catalog.itemByApiName.get(entry.apiName)?.category === category
    )), input);
  }

  const explicitThreshold = recommendFromRows("霞的纹章哪个最好，样本>=20？", rows, {
    catalog,
    preferences: { minSamples: 100 }
  });
  assert.equal(explicitThreshold.query.minSamples, 20);
  assert.equal(explicitThreshold.query.constraints.min_samples.source, "current_input");
  assert.equal(explicitThreshold.itemRankings.length, 0);
  assert.equal(explicitThreshold.itemRankingReferences.length, 2);

  const noRadiantSamples = recommendFromRows("霞的光明装备哪个最好？", fixtureRows, {
    catalog,
    preferences: { minSamples: 100 }
  });
  assert.equal(noRadiantSamples.itemRankings.length, 0);
  assert.equal(noRadiantSamples.itemRankingReferences.length, 0);
  assert.match(noRadiantSamples.text, /没有光明装备的单件携带样本/);
});

test("which-special-item wording keeps complete three-item aggregation", () => {
  for (const input of [
    "霞哪一件光明装备最好？",
    "霞应该带哪一件神器？"
  ]) {
    const result = planQuery(input);
    assert.equal(result.query.intent, "unit_item_rankings", input);
    assert.equal(result.query.itemCount, 3, input);
    assert.match(result.plan.params.unit_tier_numitems_unique, /_3$/u, input);
  }
});

test("radiant and artifact rankings use average placement only and do not let sample count change the order", () => {
  const apiNames = [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge",
    "TFT5_Item_GuinsoosRagebladeRadiant",
    "TFT5_Item_InfinityEdgeRadiant",
    "TFT5_Item_GiantSlayerRadiant",
    "TFT4_Item_OrnnDeathsDefiance",
    "TFT4_Item_OrnnInfinityForce",
    "TFT_Item_Artifact_Fishbones"
  ];
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse({
      data: apiNames.map((items) => ({ items }))
    })
  });
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [5, 0, 0, 0, 0, 0, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_InfinityEdgeRadiant|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [0, 30, 0, 0, 0, 0, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT5_Item_GiantSlayerRadiant|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [0, 0, 0, 1000, 0, 0, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT4_Item_OrnnDeathsDefiance|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [10, 0, 0, 0, 0, 0, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT4_Item_OrnnInfinityForce|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [0, 25, 0, 0, 0, 0, 0, 0]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_Artifact_Fishbones|TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge",
      placement_count: [0, 0, 1000, 0, 0, 0, 0, 0]
    }
  ];

  const radiant = recommendFromRows("霞的光明装备排行", rows, { catalog });
  const artifact = recommendFromRows("霞的神器排行", rows, { catalog });

  assert.equal(radiant.itemRankingMethodology.methodology, "special_item_outlier_cleaned_avg_placement_only");
  assert.equal(radiant.itemRankingMethodology.sampleFloor.outlierFloor, 20);
  assert.equal(radiant.itemRankings[0].apiName, "TFT5_Item_InfinityEdgeRadiant");
  assert.ok(radiant.itemRankings[0].stats.games < radiant.itemRankings[1].stats.games);
  assert.ok(radiant.itemRankings[0].stats.avgPlacement < radiant.itemRankings[1].stats.avgPlacement);
  assert.equal(radiant.itemRankingReferences[0].apiName, "TFT5_Item_GuinsoosRagebladeRadiant");
  assert.equal(radiant.itemRankingReferences[0].excludedReason, "special_item_outlier_sample");
  assert.match(radiant.text, /仅按平均名次从低到高排列/);

  assert.equal(artifact.itemRankingMethodology.methodology, "special_item_outlier_cleaned_avg_placement_only");
  assert.equal(artifact.itemRankingMethodology.sampleFloor.outlierFloor, 20);
  assert.equal(artifact.itemRankings[0].apiName, "TFT4_Item_OrnnInfinityForce");
  assert.ok(artifact.itemRankings[0].stats.games < artifact.itemRankings[1].stats.games);
  assert.ok(artifact.itemRankings[0].stats.avgPlacement < artifact.itemRankings[1].stats.avgPlacement);
  assert.equal(artifact.itemRankingReferences[0].apiName, "TFT4_Item_OrnnDeathsDefiance");
  assert.equal(artifact.itemRankingReferences[0].excludedReason, "special_item_outlier_sample");

  const narrowArtifact = recommendFromRows("霞的神器排行", [
    { ...rows[3], placement_count: [1, 0, 0, 0, 0, 0, 0, 0] },
    { ...rows[4], placement_count: [0, 2, 0, 0, 0, 0, 0, 0] },
    { ...rows[5], placement_count: [0, 0, 3, 0, 0, 0, 0, 0] }
  ], { catalog });
  assert.equal(narrowArtifact.itemRankingMethodology.sampleFloor.outlierFloor, 1);
  assert.equal(narrowArtifact.itemRankings.length, 3);
  assert.equal(narrowArtifact.itemRankingReferences.length, 0);
});

test("Brawler emblem shorthand locks the emblem and keeps Master Yi across follow-ups", async () => {
  const emblemApiName = "TFT17_Item_HPTankEmblemItem";
  const catalog = createCatalog({
    units: [{
      apiName: "TFT17_MasterYi",
      zhName: "易",
      aliases: ["易", "剑圣", "无极剑圣", "master yi", "yi"]
    }],
    items: buildItemCatalogFromItemsResponse({
      data: [
        { items: emblemApiName },
        { items: "TFT_Item_GuinsoosRageblade" },
        { items: "TFT_Item_GiantSlayer" },
        { items: "TFT_Item_InfinityEdge" }
      ]
    })
  });
  const rows = [
    {
      unit_builds: `TFT17_MasterYi&${emblemApiName}|TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer`,
      placement_count: [20, 18, 14, 10, 7, 5, 3, 2]
    },
    {
      unit_builds: "TFT17_MasterYi&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
    }
  ];
  const cacheStore = new MemoryCacheStore();
  const emblem = catalog.itemByApiName.get(emblemApiName);

  assert.equal(emblem.zhName, "斗士纹章");
  assert.equal(emblem.aliases.includes("斗转"), true);

  const explicit = await recommendForInput("剑圣携带斗转", {
    catalog,
    response: rows,
    cacheStore
  });
  assert.equal(explicit.query.unit, "TFT17_MasterYi");
  assert.deepEqual(explicit.query.ownedItems, [emblemApiName]);
  assert.equal(explicit.query.itemPolicy, "include_special");
  assert.equal(explicit.query.minSamples, 0);
  assert.equal(explicit.clarification.needsClarification, false);
  assert.equal(explicit.rankedBuilds.length, 1);

  const followUp = await recommendForInput("携带斗转", {
    catalog,
    response: rows,
    cacheStore
  });
  assert.equal(followUp.cache.session.inherited, true);
  assert.equal(followUp.cache.session.inheritedKeys.includes("unit"), true);
  assert.equal(followUp.query.unit, "TFT17_MasterYi");
  assert.deepEqual(followUp.query.ownedItems, [emblemApiName]);
  assert.equal(followUp.clarification.needsClarification, false);
  assert.equal(followUp.rankedBuilds.length, 1);
});

test("removing the sample threshold in a follow-up keeps the unit and uses zero", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞什么装备最好？", {
    cacheStore,
    response: fixtureRows,
    preferences: { minSamples: 100 }
  });
  const result = await recommendForInput("移除样本下限", {
    cacheStore,
    response: fixtureRows,
    preferences: { minSamples: 100 }
  });

  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.equal(result.query.minSamples, 0);
  assert.equal(result.query.constraints.min_samples.source, "current_input");
  assert.equal(result.cache.session.inherited, true);
  assert.equal(result.cache.session.inheritedKeys.includes("unit"), true);
  assert.equal(result.rankedBuilds.length, fixtureRows.length);
  assert.equal(result.query.comp, null);
  assert.equal(Object.keys(result.plan.params).some((key) => key.startsWith("sf[")), false);
});

test("selects a default comps context containing the target unit", () => {
  const context = selectDefaultContextForUnit("TFT17_Xayah", {
    compOptions: [
      {
        cluster: "1",
        units_list: "TFT17_Aatrox&TFT17_Xayah",
        traits_list: "TFT17_Stargazer_1&TFT17_Sniper_1",
        count: 800,
        score: 70,
        avg: 4.5
      },
      {
        cluster: "2",
        units_list: "TFT17_Xayah&TFT17_Lulu",
        traits_list: "TFT17_Stargazer_1",
        count: 1200,
        score: 60,
        avg: 4.7
      }
    ]
  });

  assert.equal(context.found, true);
  assert.equal(context.clusterId, "2");
  assert.deepEqual(context.traitFilters, ["TFT17_Stargazer_1"]);
});

test("default comps context excludes explicit special candidates unless requested", () => {
  const data = {
    compOptions: [
      {
        cluster: "ordinary",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1",
        count: 600,
        score: 65,
        avg: 4.4
      },
      {
        cluster: "unique",
        units_list: "TFT17_Xayah&TFT17_Rhaast",
        traits_list: "TFT17_XayahUniqueTrait_1",
        count: 1200,
        score: 90,
        avg: 3.6
      }
    ]
  };

  const defaultContext = selectDefaultContextForUnit("TFT17_Xayah", data);
  const specialContext = selectDefaultContextForUnit("TFT17_Xayah", data, {
    specialContextMode: "prefer"
  });
  const fallbackContext = selectDefaultContextForUnit("TFT17_Xayah", {
    compOptions: [data.compOptions[1]]
  });

  assert.equal(defaultContext.clusterId, "ordinary");
  assert.equal(defaultContext.excludedSpecialCandidateCount, 1);
  assert.equal(defaultContext.candidates.some((candidate) => candidate.specialContext), false);
  assert.match(defaultContext.warning, /\u5df2\u6392\u9664/);
  assert.equal(specialContext.clusterId, "unique");
  assert.equal(specialContext.specialContext, true);
  assert.equal(specialContext.specialContextMode, "prefer");
  assert.equal(fallbackContext.clusterId, "unique");
  assert.equal(fallbackContext.specialContextFallback, true);
  assert.match(fallbackContext.warning, /\u53ea\u627e\u5230/);
  assert.notEqual(
    makeDefaultContextCacheKey({ unit: "TFT17_Xayah", specialContextMode: "exclude" }),
    makeDefaultContextCacheKey({ unit: "TFT17_Xayah", specialContextMode: "prefer" })
  );
});

test.skip("obsolete: recommendForInput prefers special context only for explicit special-play terms", async () => {
  const metaTFTClient = {
    async getUnitBuilds() {
      return { data: fixtureRows };
    }
  };
  const compsData = {
    compOptions: [
      {
        cluster: "ordinary",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1",
        count: 600,
        score: 65,
        avg: 4.4
      },
      {
        cluster: "unique",
        units_list: "TFT17_Xayah&TFT17_Rhaast",
        traits_list: "TFT17_XayahUniqueTrait_1",
        count: 1200,
        score: 90,
        avg: 3.6
      }
    ]
  };
  const options = {
    metaTFTClient,
    compsData,
    cacheStore: new MemoryCacheStore(),
    defaultContextOptions: { minClusterSamples: 100 },
    useSession: false
  };

  const ordinary = await recommendForInput("xayah", options);
  const special = await recommendForInput("xayah \u82f1\u96c4\u5f3a\u5316", options);

  assert.equal(ordinary.query.defaultContext.clusterId, "ordinary");
  assert.equal(special.query.defaultContext.clusterId, "unique");
  assert.equal(special.query.defaultContext.specialContextMode, "prefer");
  assert.notEqual(ordinary.cache.defaultContext.key, special.cache.defaultContext.key);
});

test("default comps context keeps comp_builds evidence for the selected unit", () => {
  const compBuilds = normalizeCompBuildsResponse({
    results: {
      "cluster-xayah": {
        builds: [
          {
            cluster: "cluster-xayah",
            unit: "TFT17_Xayah",
            buildName: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
            count: 1200,
            avg: 3.8,
            score: 0.7,
            place_change: -0.4,
            unit_numitems_count: 5000
          },
          {
            cluster: "cluster-xayah",
            unit_buildNames: "TFT17_Xayah&TFT_Item_Deathblade|TFT_Item_LastWhisper|TFT_Item_GuinsoosRageblade",
            count: 800,
            avg: 3.6,
            adjusted_score: 0.8,
            num_items: 3
          },
          {
            cluster: "cluster-xayah",
            unit: "TFT17_Jhin",
            buildName: ["TFT_Item_InfinityEdge"],
            count: 9999,
            avg: 2.5,
            score: 9
          }
        ]
      }
    }
  });
  const context = selectDefaultContextForUnit("TFT17_Xayah", {
    compOptions: [
      {
        cluster: "cluster-xayah",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1",
        count: 500,
        score: 70,
        avg: 4.1
      }
    ],
    compBuilds
  });

  assert.equal(compBuilds.length, 3);
  assert.equal(context.found, true);
  assert.equal(context.compBuilds.length, 2);
  assert.deepEqual(context.compBuilds[0].items, [
    "TFT_Item_Deathblade",
    "TFT_Item_LastWhisper",
    "TFT_Item_GuinsoosRageblade"
  ]);
  assert.equal(context.compBuilds[0].sourceEndpoint, "tft-comps-api/comp_builds");
});

test("default comps context can use top4, score, or average placement strategy", () => {
  const data = {
    compOptions: [
      {
        cluster: "popular",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1",
        count: 1500,
        score: 55,
        avg: 4.8,
        top4_rate: 0.51
      },
      {
        cluster: "top4",
        units_list: "TFT17_Xayah&TFT17_Zyra",
        traits_list: "TFT17_Stargazer_1",
        count: 450,
        score: 72,
        avg: 4.1,
        top4_rate: 0.66
      },
      {
        cluster: "score",
        units_list: "TFT17_Xayah&TFT17_Lulu",
        traits_list: "TFT17_Stargazer_1&TFT17_Sniper_1",
        count: 700,
        score: 88,
        avg: 4.2,
        top4_rate: 0.57
      },
      {
        cluster: "avg",
        units_list: "TFT17_Xayah&TFT17_Jhin",
        traits_list: "TFT17_Sniper_1",
        count: 500,
        score: 70,
        avg: 3.7,
        top4_rate: 0.61
      }
    ]
  };

  const popular = selectDefaultContextForUnit("TFT17_Xayah", data, { strategy: "popular" });
  const top4 = selectDefaultContextForUnit("TFT17_Xayah", data, { strategy: "top4" });
  const score = selectDefaultContextForUnit("TFT17_Xayah", data, { strategy: "score" });
  const avg = selectDefaultContextForUnit("TFT17_Xayah", data, { strategy: "avg" });

  assert.equal(popular.clusterId, "popular");
  assert.equal(popular.strategy, "popular");
  assert.deepEqual(popular.candidates.map((candidate) => candidate.clusterId), ["popular", "score", "avg"]);
  assert.deepEqual(popular.alternatives.map((candidate) => candidate.clusterId), ["score", "avg"]);
  assert.equal(popular.ambiguity.reason, "different_trait_candidates");
  assert.equal(popular.ambiguity.significant, false);
  assert.match(popular.warning, /默认阵容存在不同羁绊候选/);
  assert.match(popular.sourceDescription, /样本数/);
  assert.equal(top4.clusterId, "top4");
  assert.equal(top4.strategy, "top4");
  assert.equal(top4.top4Rate, 0.66);
  assert.match(top4.sourceDescription, /前四率/);
  assert.equal(score.clusterId, "score");
  assert.equal(score.strategy, "score");
  assert.match(score.sourceDescription, /score/);
  assert.equal(avg.clusterId, "avg");
  assert.equal(avg.strategy, "avg");
  assert.match(avg.sourceDescription, /平均名次/);
  assert.notEqual(
    makeDefaultContextCacheKey({ unit: "TFT17_Xayah", strategy: "popular" }),
    makeDefaultContextCacheKey({ unit: "TFT17_Xayah", strategy: "avg" })
  );
});

test.skip("obsolete: close default contexts with materially different traits require clarification before Explorer", async () => {
  let explorerCalls = 0;
  const options = {
    catalog: createCatalog(),
    useSession: false,
    cacheStore: new MemoryCacheStore(),
    compsData: {
      compOptions: [
        {
          cluster: "stargazer-xayah",
          comp_name: "观星霞",
          units_list: "TFT17_Xayah&TFT17_Aatrox",
          traits_list: "TFT17_Stargazer_1",
          count: 1000,
          score: 70,
          avg: 4.05
        },
        {
          cluster: "sniper-xayah",
          comp_name: "狙神霞",
          units_list: "TFT17_Xayah&TFT17_Jhin",
          traits_list: "TFT17_Sniper_1",
          count: 900,
          score: 69,
          avg: 4.08
        }
      ]
    },
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    }
  };

  const result = await recommendForInput("xayah", options);

  assert.equal(result.validation.valid, true);
  assert.equal(result.query.defaultContext.ambiguity.significant, true);
  assert.equal(result.clarification.reason, "ambiguous_default_context");
  assert.equal(result.clarification.blocking, true);
  assert.match(result.clarification.question, /观星霞 \/ 狙神霞/);
  assert.equal(result.clarification.suggestions.length, 2);
  assert.equal(result.clarification.suggestions.every((value) => value.includes("霞")), true);
  assert.equal(result.rankedBuilds.length, 0);
  assert.equal(explorerCalls, 0);
});

test("answers current-patch historical item aliases through the normal data path", async () => {
  const catalog = createCatalog();
  const cacheStore = new MemoryCacheStore();
  let explorerCalls = 0;
  let compsCalls = 0;
  const result = await recommendForInput("霞能不能带分裂弓？", {
    catalog,
    cacheStore,
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        return [];
      },
      async getCompOptions() {
        compsCalls += 1;
        return [];
      }
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.localDecision, undefined);
  assert.equal(result.query.ownedItems.includes("TFT_Item_RunaansHurricane"), true);
  assert.equal(result.plan.endpoint, "unit_builds");
  assert.equal(explorerCalls, 1);
  assert.equal(compsCalls, 0);
  assert.equal(cacheStore.getSessionState(SESSION_LAST_QUERY_KEY).value.query.unit, "TFT17_Xayah");
});

test("synchronous recommendation treats the historical Runaan name as current Kraken", () => {
  const result = recommendFromRows("霞能不能带分裂弓？", fixtureRows);

  assert.equal(result.localDecision, undefined);
  assert.equal(result.query.ownedItems.includes("TFT_Item_RunaansHurricane"), true);
  assert.equal(result.rankedBuilds.length, 1);
});

test("clarification policy asks for the missing unit", () => {
  const result = recommendFromRows("羊刀怎么带？", fixtureRows);

  assert.equal(result.validation.valid, false);
  assert.equal(result.clarification.needsClarification, true);
  assert.equal(result.clarification.reason, "missing_unit_with_item");
  assert.match(result.text, /要查哪个英雄/);
});

test("clarification policy does not block a valid query", () => {
  const planned = planQuery("xayah");
  const clarification = evaluateClarification(planned.parsed, planned.query, planned.validation);

  assert.equal(clarification.needsClarification, false);
  assert.equal(clarification.canAutoFix, true);
});

test("query validation blocks unknown traits instead of passing them to Explorer", () => {
  const catalog = createCatalog();
  const query = {
    unit: "TFT17_Xayah",
    starLevel: [2],
    itemCount: 3,
    traitFilters: ["TFT17_NotInCurrentSet_1"],
    itemPolicy: "ordinary_only",
    ownedItems: []
  };
  const validation = validateQueryContext(query, { catalog });
  const clarification = evaluateClarification({}, query, validation, { catalog });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("；"), /不在当前版本羁绊字典中/);
  assert.equal(clarification.blocking, true);
  assert.equal(clarification.reason, "validation_failed");
});

test("query validation rejects default contexts without a target-unit roster", () => {
  const catalog = createCatalog();
  const query = {
    unit: "TFT17_Xayah",
    starLevel: [2],
    itemCount: 3,
    traitFilters: ["TFT17_Stargazer_1"],
    itemPolicy: "ordinary_only",
    ownedItems: [],
    defaultContext: {
      found: true,
      clusterId: "incomplete-context"
    }
  };
  const validation = validateQueryContext(query, { catalog });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("；"), /默认阵容 cluster 不包含目标英雄/);
});

test("deterministic alias collisions require explicit entity clarification", () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [
      ...base.units,
      {
        apiName: "TFT17_TestAlpha",
        zhName: "阿尔法",
        aliases: ["carry", "shadow carry"]
      },
      {
        apiName: "TFT17_TestBeta",
        zhName: "贝塔",
        aliases: ["carry"]
      }
    ]
  });
  const result = recommendFromRows("carry三件套", fixtureRows, { catalog });

  assert.equal(result.validation.valid, false);
  assert.equal(result.query.unit, undefined);
  assert.equal(result.parsed.parser.entityAmbiguities.length, 1);
  assert.equal(result.clarification.needsClarification, true);
  assert.equal(result.clarification.reason, "ambiguous_entity");
  assert.match(result.clarification.question, /阿尔法 \/ 贝塔/);
  assert.deepEqual(
    result.clarification.entityCandidates.map((candidate) => candidate.apiName),
    ["TFT17_TestAlpha", "TFT17_TestBeta"]
  );
  assert.equal(result.rankedBuilds.length, 0);

  const longerAlias = planQuery("shadow carry三件套", { catalog });
  assert.equal(longerAlias.validation.valid, true);
  assert.equal(longerAlias.query.unit, "TFT17_TestAlpha");
  assert.equal(longerAlias.parsed.parser.entityAmbiguities.length, 0);
});

test("alias collisions are not overwritten by session inheritance or automatic LLM parsing", async () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [
      ...base.units,
      { apiName: "TFT17_TestAlpha", zhName: "阿尔法", aliases: ["carry"] },
      { apiName: "TFT17_TestBeta", zhName: "贝塔", aliases: ["carry"] }
    ]
  });
  const cacheStore = new MemoryCacheStore();
  let structuredParserCalls = 0;

  await recommendForInput("xayah", {
    catalog,
    response: fixtureRows,
    cacheStore
  });
  const result = await recommendForInput("carry", {
    catalog,
    response: fixtureRows,
    cacheStore,
    structuredParser: async () => {
      structuredParserCalls += 1;
      return {};
    },
    useStructuredParser: "auto"
  });

  assert.equal(structuredParserCalls, 0);
  assert.equal(result.cache.session.inherited, false);
  assert.equal(result.query.unit, undefined);
  assert.equal(result.clarification.reason, "ambiguous_entity");
});

test("multiple different units block the single-unit query before remote lookup", async () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [
      ...base.units,
      {
        apiName: "TFT17_Aatrox",
        zhName: "亚托克斯",
        aliases: ["亚托克斯", "剑魔", "aatrox"]
      }
    ]
  });
  let remoteCalls = 0;
  const result = await recommendForInput("霞和剑魔哪个装备更好？", {
    catalog,
    useSession: false,
    metaTFTClient: {
      async getUnitBuilds() {
        remoteCalls += 1;
        return { data: fixtureRows };
      }
    }
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.clarification.needsClarification, true);
  assert.equal(result.clarification.reason, "multiple_units");
  assert.equal(result.clarification.blocking, true);
  assert.deepEqual(
    result.clarification.entityCandidates.map((candidate) => candidate.apiName),
    ["TFT17_Xayah", "TFT17_Aatrox"]
  );
  assert.equal(remoteCalls, 0);
  assert.equal(result.rankedBuilds.length, 0);
});

test("repeating aliases for the same unit does not trigger multiple-unit clarification", () => {
  const result = recommendFromRows("霞 xayah 三件套", fixtureRows);
  const unitMatches = result.parsed.parser.entityMatches
    .filter((match) => match.entityType === "unit");

  assert.equal(unitMatches.length, 2);
  assert.equal(result.clarification.needsClarification, false);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.ok(result.rankedBuilds.length > 0);
});

test("conflicting sort intents block the query before remote lookup", async () => {
  let remoteCalls = 0;
  const result = await recommendForInput("霞吃鸡优先，但也要稳健高样本", {
    useSession: false,
    metaTFTClient: {
      async getUnitBuilds() {
        remoteCalls += 1;
        return { data: fixtureRows };
      }
    }
  });

  assert.deepEqual(result.parsed.parser.constraintConflicts, [{
    type: "sort",
    values: ["win_first", "robust_first"]
  }]);
  assert.equal(result.validation.valid, true);
  assert.equal(result.clarification.reason, "conflicting_sort");
  assert.equal(result.clarification.blocking, true);
  assert.deepEqual(result.clarification.suggestions, ["吃鸡优先", "稳健高样本"]);
  assert.equal(remoteCalls, 0);
  assert.equal(result.rankedBuilds.length, 0);
});

test("a single explicit sort intent remains executable", () => {
  const top4 = recommendFromRows("霞前四优先", fixtureRows);
  const win = recommendFromRows("霞吃鸡优先", fixtureRows);
  const robust = recommendFromRows("霞稳健高样本", fixtureRows);

  assert.equal(top4.clarification.needsClarification, false);
  assert.equal(top4.query.sort, "top4_first");
  assert.equal(win.clarification.needsClarification, false);
  assert.equal(win.query.sort, "win_first");
  assert.equal(robust.clarification.needsClarification, false);
  assert.equal(robust.query.sort, "robust_first");
});

test("comparison queries with only one recognized item ask for the missing option", async () => {
  let remoteCalls = 0;
  const result = await recommendForInput("霞的羊刀和神秘刀哪个好？", {
    useSession: false,
    metaTFTClient: {
      async getUnitBuilds() {
        remoteCalls += 1;
        return { data: fixtureRows };
      }
    }
  });

  assert.deepEqual(result.parsed.parser.comparison, {
    requested: true,
    itemApiNames: ["TFT_Item_GuinsoosRageblade"],
    ownedItemApiNames: []
  });
  assert.equal(result.validation.valid, false);
  assert.equal(result.clarification.reason, "missing_comparison_option");
  assert.match(result.clarification.question, /羊刀/);
  assert.equal(result.clarification.blocking, true);
  assert.equal(remoteCalls, 0);
  assert.equal(result.rankedBuilds.length, 0);
});

test("ordinary owned-item completion is not mistaken for comparison", () => {
  const result = recommendFromRows("霞已经有羊刀，剩下两件怎么带？", fixtureRows);

  assert.deepEqual(result.parsed.parser.comparison, {
    requested: false,
    itemApiNames: [],
    ownedItemApiNames: []
  });
  assert.equal(result.clarification.needsClarification, false);
  assert.ok(result.rankedBuilds.length > 0);
});

test("recognized comparison options are aggregated separately instead of locked together", () => {
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [100, 90, 80, 70, 40, 30, 20, 10]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [70, 60, 50, 40, 40, 30, 20, 10]
    }
  ];
  const result = recommendFromRows("2星霞3观星，羊刀和无尽哪个更好？", rows);

  assert.deepEqual(result.query.ownedItems, []);
  assert.deepEqual(result.query.comparison.itemApiNames, [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge"
  ]);
  assert.equal(result.comparison.winner, "TFT_Item_GuinsoosRageblade");
  assert.equal(result.comparison.allQualified, true);
  assert.equal(result.comparison.entries[0].stats.games, 440);
  assert.equal(result.comparison.entries[1].stats.games, 320);
  assert.equal(result.rankedBuilds[0].comparisonOption, "TFT_Item_GuinsoosRageblade");
  assert.match(result.text, /当前条件的互斥完整出装样本中，羊刀表现领先/);
  assert.match(result.text, /每个候选只聚合包含自身且不含其他候选/);
});

test("comparison keeps explicit owned items separate from the alternatives", () => {
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_Deathblade",
      placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_MadredsBloodrazor|TFT_Item_Deathblade",
      placement_count: [60, 55, 50, 45, 40, 30, 20, 10]
    }
  ];
  const result = recommendFromRows("霞3观星，已有羊刀，无尽还是巨杀哪个好？", rows);

  assert.deepEqual(result.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.deepEqual(result.query.comparison.itemApiNames, [
    "TFT_Item_InfinityEdge",
    "TFT_Item_MadredsBloodrazor"
  ]);
  assert.equal(result.comparison.winner, "TFT_Item_InfinityEdge");
  assert.ok(result.filteredBuilds.every((build) => build.items.includes("TFT_Item_GuinsoosRageblade")));
  assert.match(result.text, /代表三件套：无尽 \+ 杀人剑|代表三件套：杀人剑 \+ 无尽/);
});

test("comparison does not declare a winner when one option is below the sample threshold", () => {
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [50, 40, 30, 20, 10, 10, 10, 10]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [2, 1, 1, 1, 1, 1, 1, 0]
    }
  ];
  const result = recommendFromRows("霞3观星，羊刀还是无尽哪个好？", rows, {
    preferences: { minSamples: 100 }
  });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.allQualified, false);
  assert.equal(result.comparison.entries.find((entry) => entry.apiName === "TFT_Item_InfinityEdge").qualified, false);
  assert.match(result.text, /暂不判断胜者：部分候选未达到最低样本门槛/);
  assert.match(result.text, /无尽.*低于样本>=100/);
});

test("comparison does not declare a winner when all options only clear a very low selected threshold", () => {
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [4, 4, 3, 2, 2, 1, 1, 1]
    }
  ];
  const result = recommendFromRows("2星霞3观星，样本>=10，羊刀和无尽哪个更好？", rows);

  assert.equal(result.comparison.allQualified, true);
  assert.equal(result.comparison.allStable, false);
  assert.equal(result.comparison.stabilityMinSamples, 200);
  assert.equal(result.comparison.winner, null);
  assert.match(result.text, /^暂不判断胜者：部分候选样本不足以形成稳定结论/);
});

test("comparison accepts Runaan as the current Kraken item", async () => {
  let compsCalls = 0;
  let explorerCalls = 0;
  const result = await recommendForInput("霞3观星，羊刀还是分裂弓哪个好？", {
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        return [];
      },
      async getCompOptions() {
        compsCalls += 1;
        return [];
      }
    },
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    },
    useSession: false
  });

  assert.equal(result.localDecision, undefined);
  assert.equal(result.comparison.entries.some((entry) => entry.apiName === "TFT_Item_RunaansHurricane"), true);
  assert.equal(result.comparison.options.includes("TFT_Item_RunaansHurricane"), true);
  assert.equal(compsCalls, 0);
  assert.equal(explorerCalls, 1);
});

test("local entity candidate retriever suggests typo matches without resolving them", () => {
  const candidates = retrieveEntityCandidates("xayha best items", {
    catalog: createCatalog(),
    entityTypes: ["unit"]
  });

  assert.equal(candidates[0].entityType, "unit");
  assert.equal(candidates[0].apiName, "TFT17_Xayah");
  assert.equal(candidates[0].matchedAlias, "xayah");
  assert.equal(candidates[0].inputFragment, "xayha");
  assert.equal(candidates[0].matchType, "fuzzy");

  const result = recommendFromRows("xayha best items", fixtureRows);

  assert.equal(result.validation.valid, false);
  assert.equal(result.query.unit, undefined);
  assert.equal(result.clarification.needsClarification, true);
  assert.equal(result.clarification.reason, "missing_unit");
  assert.equal(result.clarification.entityCandidates[0].apiName, "TFT17_Xayah");
  assert.equal(result.rankedBuilds.length, 0);
});

test("unique high-confidence English typo resolves through the local catalog", () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [{
      apiName: "TFT17_TwistedFate",
      zhName: "卡牌",
      aliases: ["twistedfate"],
      current: true
    }],
    traits: base.traits,
    items: base.items
  });
  const rows = [{
    unit_builds: "TFT17_TwistedFate&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [80, 70, 60, 50, 40, 30, 20, 10]
  }];

  const result = recommendFromRows("twisetdfate 2星 3观星 三件普通装备", rows, {
    catalog
  });

  assert.equal(result.query.unit, "TFT17_TwistedFate");
  assert.equal(result.parsed.parser.usedLLM, false);
  assert.deepEqual(result.parsed.parser.highConfidenceEntityResolutions.map((resolution) => ({
    entityType: resolution.entityType,
    apiName: resolution.apiName,
    inputFragment: resolution.inputFragment,
    matchType: resolution.matchType
  })), [{
    entityType: "unit",
    apiName: "TFT17_TwistedFate",
    inputFragment: "twisetdfate",
    matchType: "high_confidence_fuzzy"
  }]);
  assert.match(result.query.warnings.join("；"), /twisetdfate.*卡牌/);
  assert.equal(result.validation.valid, true);
  assert.equal(result.clarification.blocking, false);
  assert.equal(result.rankedBuilds.length, 1);
});

test("unique high-confidence owned-item typo resolves before local filtering", () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: base.units,
    traits: base.traits,
    items: [
      ...base.items,
      {
        apiName: "TFT_Item_ChronoshiftBlade",
        zhName: "时移之刃",
        aliases: ["chronoshiftblade"],
        category: "ordinary_completed",
        current: true,
        obtainable: true
      }
    ]
  });
  const rows = [{
    unit_builds: "TFT17_Xayah&TFT_Item_ChronoshiftBlade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [80, 70, 60, 50, 40, 30, 20, 10]
  }];

  const result = recommendFromRows("霞3观星，已经有chronoshfitblade，剩下两件怎么带？", rows, {
    catalog
  });

  assert.deepEqual(result.query.ownedItems, ["TFT_Item_ChronoshiftBlade"]);
  assert.deepEqual(result.parsed.parser.unresolvedEntityHints, []);
  assert.equal(result.parsed.parser.highConfidenceEntityResolutions[0].entityType, "item");
  assert.match(result.query.warnings.join("；"), /chronoshfitblade.*时移之刃/);
  assert.equal(result.clarification.blocking, false);
  assert.equal(result.rankedBuilds.length, 1);
});

test("high-confidence fuzzy candidates with a close runner-up block before remote lookup", async () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [
      {
        apiName: "TFT17_TestAlpha",
        zhName: "测试甲",
        aliases: ["abcdefghij"],
        current: true
      },
      {
        apiName: "TFT17_TestBeta",
        zhName: "测试乙",
        aliases: ["abcdefghil"],
        current: true
      }
    ],
    traits: base.traits,
    items: base.items
  });

  let compsCalls = 0;
  let explorerCalls = 0;
  const result = await recommendForInput("abcdefghik 3观星 三件套", {
    catalog,
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        return [];
      },
      async getCompOptions() {
        compsCalls += 1;
        return [];
      }
    },
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: [] };
      }
    },
    useSession: false
  });

  assert.equal(result.query.unit, undefined);
  assert.deepEqual(result.parsed.parser.highConfidenceEntityResolutions, []);
  assert.equal(result.clarification.reason, "missing_unit");
  assert.equal(result.clarification.blocking, true);
  assert.equal(result.clarification.entityCandidates.length >= 2, true);
  assert.equal(result.rankedBuilds.length, 0);
  assert.equal(compsCalls, 0);
  assert.equal(explorerCalls, 0);
});

test("low-confidence owned-item text blocks before comps and Explorer", async () => {
  let compsCalls = 0;
  let explorerCalls = 0;
  const result = await recommendForInput("霞有guinso，剩下两件怎么带？", {
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        return [];
      },
      async getCompOptions() {
        compsCalls += 1;
        return [];
      }
    },
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    },
    useSession: false
  });

  assert.equal(result.clarification.blocking, true);
  assert.equal(result.clarification.reason, "unresolved_item");
  assert.equal(result.clarification.entityCandidates[0].apiName, "TFT_Item_GuinsoosRageblade");
  assert.match(result.clarification.entityCandidates[0].queryText, /羊刀/);
  assert.equal(compsCalls, 0);
  assert.equal(explorerCalls, 0);
});

test("unresolved explicit trait text asks for clarification instead of using a default trait", async () => {
  let explorerCalls = 0;
  const result = await recommendForInput("霞3观心装备", {
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    },
    useSession: false
  });

  assert.equal(result.clarification.blocking, true);
  assert.equal(result.clarification.reason, "unresolved_trait");
  assert.match(result.clarification.question, /观心/);
  assert.equal(result.query.defaultContext, null);
  assert.equal(explorerCalls, 0);
});

test("ordinary lazy input does not create unresolved entity hints", () => {
  const planned = planQuery("霞带哪三件装备最好？");

  assert.deepEqual(planned.parsed.parser.unresolvedEntityHints, []);
  assert.equal(planned.validation.valid, true);
});

test("local entity candidate retriever uses BM25 keyword matches for reordered aliases", () => {
  const catalog = createCatalog({
    units: [
      {
        apiName: "TFT17_TestShadowAssassin",
        zhName: "Shadow Assassin",
        aliases: ["shadow assassin"]
      },
      {
        apiName: "TFT17_TestVanguardMage",
        zhName: "Vanguard Mage",
        aliases: ["vanguard mage"]
      }
    ],
    items: [],
    traits: []
  });
  const candidates = retrieveEntityCandidates("assassin carry shadow", {
    catalog,
    entityTypes: ["unit"]
  });

  assert.equal(candidates[0].apiName, "TFT17_TestShadowAssassin");
  assert.equal(candidates[0].matchedAlias.toLowerCase(), "shadow assassin");
  assert.equal(candidates[0].matchType, "bm25_keyword");
  assert.equal(candidates[0].inputFragment, "assassin shadow");
});

test("local sparse TF-IDF vectors recall reordered aliases without auto-resolving them", async () => {
  const catalog = createCatalog({
    units: [{
      apiName: "TFT17_VectorTest",
      zhName: "向量测试",
      aliases: ["暗星刺客"],
      current: true
    }]
  });
  const candidates = retrieveEntityCandidates("刺客星暗", {
    catalog,
    entityTypes: ["unit"]
  });

  assert.equal(candidates[0].apiName, "TFT17_VectorTest");
  assert.equal(candidates[0].matchType, "tfidf_vector");
  assert.equal(candidates[0].confidence < 0.9, true);
  assert.equal(candidates[0].vectorScore > 0, true);
  assert.equal(candidates[0].vectorOverlap >= 3, true);

  let explorerCalls = 0;
  const result = await recommendForInput("刺客星暗带什么", {
    catalog,
    useSession: false,
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    }
  });
  assert.equal(result.query.unit, undefined);
  assert.equal(result.clarification.reason, "missing_unit");
  assert.equal(result.clarification.entityCandidates[0].apiName, "TFT17_VectorTest");
  assert.equal(explorerCalls, 0);
});

test("entity candidate indexes are reused by catalog identity and isolated by entity type", () => {
  const catalog = createCatalog();
  const allIndex = getOrCreateEntityCandidateIndex(catalog, {
    entityTypes: ["trait", "unit", "item"]
  });
  const reorderedIndex = getOrCreateEntityCandidateIndex(catalog, {
    entityTypes: ["item", "unit", "trait"]
  });
  const unitIndex = getOrCreateEntityCandidateIndex(catalog, {
    entityTypes: "unit"
  });
  const uncachedUnitIndex = createEntityCandidateIndex(catalog, {
    entityTypes: ["unit"]
  });
  const candidates = retrieveEntityCandidates("xayha best items", {
    catalog,
    index: unitIndex
  });

  assert.equal(allIndex, reorderedIndex);
  assert.notEqual(allIndex, unitIndex);
  assert.notEqual(unitIndex, uncachedUnitIndex);
  assert.deepEqual(unitIndex.entityTypes, ["unit"]);
  assert.ok(unitIndex.documents.length > 0);
  assert.equal(unitIndex.bm25Stats.documentCount, unitIndex.documents.length);
  assert.equal(unitIndex.vectorStats.documentCount, unitIndex.documents.length);
  assert.equal(unitIndex.vectorStats.dimensions > 0, true);
  assert.equal(unitIndex.documents.every((document) => document.vector.norm > 0), true);
  assert.equal(candidates[0].apiName, "TFT17_Xayah");
  assert.equal(clearEntityCandidateIndex(catalog), true);
  assert.notEqual(
    getOrCreateEntityCandidateIndex(catalog, { entityTypes: ["unit"] }),
    unitIndex
  );
});

test("structured parser can safely expand unresolved entity mentions before recommendation", async () => {
  let calls = 0;
  const structuredParser = async ({ parsed }) => {
    calls += 1;
    assert.equal(parsed.unit, undefined);
    return {
      intent: "unit_best_3_items",
      entities: {
        unit_mentions: ["霞"],
        item_mentions: ["羊刀"]
      },
      constraints: {
        item_count: 3,
        item_policy: "ordinary_only"
      },
      needs_clarification: false,
      clarification_question: null
    };
  };

  const result = await recommendForInput("羽毛女有鬼索刀怎么带", {
    response: fixtureRows,
    structuredParser
  });

  assert.equal(calls, 1);
  assert.equal(result.parsed.parser.usedLLM, true);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.ok(result.rankedBuilds.length > 0);
  assert.ok(result.rankedBuilds.every((build) => build.items.includes("TFT_Item_GuinsoosRageblade")));
});

test("provider-authored clarification prose cannot surface stale catalog entities", async () => {
  const result = await recommendForInput("哪个更好？", {
    response: fixtureRows,
    structuredParser: async () => ({
      intent: "clarification",
      entities: {
        unit_mentions: [],
        item_mentions: [],
        trait_mentions: []
      },
      constraints: {},
      needs_clarification: true,
      clarification_question: "你想比较什么？例如“霞和婕拉哪个好”。"
    })
  });

  assert.equal(result.clarification.reason, "structured_parser_clarification");
  assert.match(result.text, /当前版本的英雄、装备或羁绊名称/u);
  assert.doesNotMatch(result.text, /婕拉/u);
  assert.equal(result.parsed.parser.structuredParser.clarificationQuestion, null);
});

test("structured parser can resolve an explicit low-confidence item after the unit is known", async () => {
  let calls = 0;
  const result = await recommendForInput("霞有guinso，剩下两件怎么带？", {
    response: fixtureRows,
    structuredParser: async ({ parsed }) => {
      calls += 1;
      assert.equal(parsed.unit, "TFT17_Xayah");
      assert.deepEqual(parsed.parser.unresolvedEntityHints, [{
        entityType: "item",
        inputFragment: "guinso"
      }]);
      return {
        intent: "unit_best_3_items",
        entities: {
          item_mentions: ["guinsoo"]
        },
        constraints: {
          owned_items: ["guinsoo"]
        },
        needs_clarification: false,
        clarification_question: null
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.parsed.parser.usedLLM, true);
  assert.deepEqual(result.parsed.parser.unresolvedEntityHints, []);
  assert.deepEqual(result.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(result.clarification.needsClarification, false);
  assert.ok(result.rankedBuilds.length > 0);
});

test("structured parser exclusion output is resolved locally and never becomes an owned item", async () => {
  let calls = 0;
  const rows = [
    fixtureRows[0],
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
    }
  ];
  const result = await recommendForInput("霞别用那个攻速叠层装备", {
    response: rows,
    structuredParser: async ({ parsed }) => {
      calls += 1;
      assert.equal(parsed.unit, "TFT17_Xayah");
      assert.equal(parsed.parser.exclusion.requested, true);
      return {
        intent: "unit_best_3_items",
        entities: {
          item_mentions: ["羊刀"]
        },
        constraints: {
          excluded_items: ["羊刀"]
        },
        needs_clarification: false,
        clarification_question: null
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.parsed.parser.usedLLM, true);
  assert.deepEqual(result.query.ownedItems, []);
  assert.deepEqual(result.query.excludedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.ok(result.rankedBuilds.every((build) => !build.items.includes("TFT_Item_GuinsoosRageblade")));
});

test("structured parser stays out of the hot path when rules resolve the unit", async () => {
  let calls = 0;
  const result = await recommendForInput("xayah", {
    response: fixtureRows,
    structuredParser: async () => {
      calls += 1;
      return {
        entities: {
          unit_mentions: ["霞"]
        }
      };
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.parsed.parser.usedLLM, false);
  assert.equal(result.query.unit, "TFT17_Xayah");
});

test("structured parser output schema rejects unsupported constraints", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_best_3_items",
    entities: {
      unit_mentions: ["霞"]
    },
    constraints: {
      star_level: [4],
      item_policy: "anything_goes"
    },
    needs_clarification: "no"
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /constraints\.star_level/);
  assert.match(validation.errors.join("\n"), /constraints\.item_policy/);
  assert.match(validation.errors.join("\n"), /needs_clarification/);
});

test("structured parser schema accepts explicit excluded item mentions", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_best_3_items",
    entities: {
      unit_mentions: ["霞"],
      item_mentions: ["羊刀"]
    },
    constraints: {
      excluded_items: ["羊刀"]
    },
    needs_clarification: false,
    clarification_question: null
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.value.constraints.excludedItemMentions, ["羊刀"]);
});

test("structured parser schema accepts an explicit zero sample threshold", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_build_rankings",
    entities: {
      unit_mentions: ["霞"]
    },
    constraints: {
      min_samples: 0
    },
    needs_clarification: false,
    clarification_question: null
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.value.constraints.minSamples, 0);
});

test("structured parser schema rejects unknown root, entity, and constraint fields", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_best_3_items",
    entities: {
      unit_mentions: ["霞"],
      api_name: "TFT17_Xayah"
    },
    constraints: {
      item_count: 3,
      best_item: "羊刀"
    },
    needs_clarification: false,
    clarification_question: null,
    answer: "羊刀最强"
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /output\.answer is not supported/);
  assert.match(validation.errors.join("\n"), /entities\.api_name is not supported/);
  assert.match(validation.errors.join("\n"), /constraints\.best_item is not supported/);
});

test("structured parser schema rejects partial contracts and duplicate naming aliases", () => {
  const partial = validateStructuredParserOutput({
    entities: {
      unit_mentions: ["霞"]
    }
  });
  const duplicated = validateStructuredParserOutput({
    intent: "unit_best_3_items",
    entities: {
      unit_mentions: ["霞"],
      unitMentions: ["霞"]
    },
    constraints: {
      item_count: 3,
      itemCount: 2
    },
    needs_clarification: false,
    needsClarification: true,
    clarification_question: null
  });

  assert.equal(partial.valid, false);
  assert.match(partial.errors.join("\n"), /output\.intent is required/);
  assert.match(partial.errors.join("\n"), /output\.constraints is required/);
  assert.match(partial.errors.join("\n"), /output\.needs_clarification is required/);
  assert.equal(duplicated.valid, false);
  assert.match(duplicated.errors.join("\n"), /entities\.unit_mentions and entities\.unitMentions cannot both be set/);
  assert.match(duplicated.errors.join("\n"), /constraints\.item_count and constraints\.itemCount cannot both be set/);
  assert.match(duplicated.errors.join("\n"), /output\.needs_clarification and output\.needsClarification cannot both be set/);
});

test("unknown structured-parser fields cannot drive a query or remote lookup", async () => {
  let explorerCalls = 0;
  const result = await recommendForInput("羽毛女怎么带", {
    structuredParser: async () => ({
      intent: "unit_best_3_items",
      entities: {
        unit_mentions: ["霞"]
      },
      constraints: {
        item_count: 3,
        force_item: "TFT_Item_GuinsoosRageblade"
      },
      needs_clarification: false,
      clarification_question: null
    }),
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    }
  });

  assert.equal(result.parsed.parser.structuredParser.valid, false);
  assert.match(result.parsed.parser.structuredParser.errors.join("\n"), /constraints\.force_item/);
  assert.equal(result.clarification.reason, "missing_unit");
  assert.equal(explorerCalls, 0);
});

test("conflicting structured-parser aliases cannot drive a query or remote lookup", async () => {
  let explorerCalls = 0;
  const result = await recommendForInput("羽毛女怎么带", {
    structuredParser: async () => ({
      intent: "unit_best_3_items",
      entities: {
        unit_mentions: ["霞"]
      },
      constraints: {
        item_count: 3,
        itemCount: 2
      },
      needs_clarification: false,
      clarification_question: null
    }),
    metaTFTClient: {
      async getUnitBuilds() {
        explorerCalls += 1;
        return { data: fixtureRows };
      }
    }
  });

  assert.equal(result.parsed.parser.structuredParser.valid, false);
  assert.match(result.parsed.parser.structuredParser.errors.join("\n"), /cannot both be set/);
  assert.equal(result.clarification.reason, "missing_unit");
  assert.equal(explorerCalls, 0);
});

test("normalizes captured MetaTFT Explorer unit_builds response", () => {
  const response = readProbeJson("meta_builds_xayah_expanded.json");
  const rows = normalizeUnitBuildRows(response);

  assert.ok(rows.length > 100);
  assert.equal(rows[0].unit_builds.startsWith("TFT17_Xayah&"), true);
  assert.equal(Array.isArray(rows[0].placement_count), true);
});

test("normalizes captured /comps option and cluster responses", () => {
  const compOptions = normalizeCompOptionsResponse(readProbeJson("meta_comp_options.json"));
  const clusterInfo = normalizeLatestClusterInfoResponse(readProbeJson("meta_latest_cluster.json"));
  const compBuilds = normalizeCompBuildsResponse(readProbeJson("meta_comp_builds.json"));

  assert.ok(compOptions.length > 1000);
  assert.ok(clusterInfo.length > 10);
  assert.ok(compBuilds.length > 1000);

  const context = selectDefaultContextForUnit("TFT17_Xayah", {
    compOptions,
    clusterInfo,
    compBuilds
  }, {
    minClusterSamples: 10
  });

  assert.equal(context.found, true);
  assert.ok(context.units.includes("TFT17_Xayah"));
  assert.ok(context.compBuilds.length > 0);
  assert.equal(context.compBuilds[0].unit, "TFT17_Xayah");
});

test("builds a recommendation from a captured MetaTFT response wrapper", () => {
  const response = readProbeJson("meta_builds_xayah_expanded.json");
  const result = recommendFromRows("2星霞，3观星，携带哪三件普通装备最好？", response, {
    preferences: {
      minSamples: 100
    }
  });

  assert.ok(result.rows.length > 100);
  assert.ok(result.rankedBuilds.length > 0);
  assert.equal(result.rankedBuilds[0].items.includes("TFT_Item_RunaansHurricane"), false);
  assert.match(result.text, /推荐：/);
  assert.match(result.text, /查询条件：2星霞 \/ 3观星/);
});

test.skip("obsolete: recommendForInput can use captured comps data for lazy default context", async () => {
  const response = readProbeJson("meta_builds_xayah_expanded.json");
  const result = await recommendForInput("霞带哪三件装备最好？", {
    response,
    compsData: {
      latestClusterInfo: readProbeJson("meta_latest_cluster.json"),
      compOptions: readProbeJson("meta_comp_options.json"),
      compBuilds: readProbeJson("meta_comp_builds.json")
    },
    defaultContextOptions: {
      minClusterSamples: 10
    },
    preferences: {
      minSamples: 100
    }
  });

  assert.equal(result.validation.valid, true);
  assert.ok(result.query.defaultContext);
  assert.match(result.text, /默认阵容来源：MetaTFT \/comps/);
  assert.match(result.text, /阵容装备参考：/);
});

test("session memory lets an item-only follow-up inherit the previous unit", async () => {
  const cacheStore = new MemoryCacheStore();

  await recommendForInput("xayah", {
    response: fixtureRows,
    cacheStore
  });

  const result = await recommendForInput("guinsoo", {
    response: fixtureRows,
    cacheStore
  });

  assert.equal(result.cache.session.inherited, true);
  assert.equal(result.cache.session.inheritedKeys.includes("unit"), true);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.ownedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(result.query.itemPolicy, "ordinary_only");
  assert.equal(result.query.assumptions.find((entry) => entry.key === "unit").source, "conversation");
  assert.equal(result.query.assumptions.find((entry) => entry.key === "star_level").source, "conversation");
  assert.match(result.text, /沿用上轮：霞 \/ 2星/);
  assert.ok(result.rankedBuilds.length > 0);
  assert.ok(result.rankedBuilds.every((build) => build.items.includes("TFT_Item_GuinsoosRageblade")));
});

test("an emblem follow-up gives the inherited unit to the LLM before clarification", async () => {
  const base = createCatalog();
  const catalog = createCatalog({
    units: [
      ...base.units,
      {
        apiName: "TFT17_MasterYi",
        zhName: "易",
        aliases: ["易", "剑圣", "master yi", "yi"]
      }
    ],
    traits: buildTraitCatalogFromExplorerRows({
      data: [
        { traits: "TFT17_HPTank_1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
        { traits: "TFT17_HPTank_2", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
        { traits: "TFT17_HPTank_3", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
      ]
    }),
    items: buildItemCatalogFromItemsResponse({
      data: [
        {
          items: "TFT17_Item_HPTankEmblemItem",
          placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
        },
        {
          items: "TFT_Item_GuinsoosRageblade",
          placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
        },
        {
          items: "TFT_Item_GiantSlayer",
          placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
        },
        {
          items: "TFT_Item_InfinityEdge",
          placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
        }
      ]
    })
  });
  const rows = [
    {
      unit_builds: "TFT17_MasterYi&TFT17_Item_HPTankEmblemItem|TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer",
      placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
    },
    {
      unit_builds: "TFT17_MasterYi&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
      placement_count: [100, 90, 80, 70, 60, 50, 40, 30]
    }
  ];
  const cacheStore = new MemoryCacheStore();
  let structuredParserCalls = 0;

  await recommendForInput("易怎么出装？", { catalog, response: rows, cacheStore });
  const result = await recommendForInput("如果携带了斗士纹章呢？", {
    catalog,
    response: rows,
    cacheStore,
    useStructuredParser: "auto",
    structuredParser: async ({ parsed }) => {
      structuredParserCalls += 1;
      assert.equal(parsed.unit, "TFT17_MasterYi");
      assert.equal(parsed.sessionContext.inherited, true);
      return {
        intent: "unit_build_completion",
        entities: {
          unit_mentions: [],
          item_mentions: ["斗士纹章"],
          trait_mentions: []
        },
        constraints: {
          owned_items: ["斗士纹章"]
        },
        needs_clarification: false,
        clarification_question: null
      };
    }
  });

  assert.equal(structuredParserCalls, 1);
  assert.equal(result.cache.session.inherited, true);
  assert.equal(result.cache.session.inheritedKeys.includes("unit"), true);
  assert.equal(result.query.unit, "TFT17_MasterYi");
  assert.deepEqual(result.query.ownedItems, ["TFT17_Item_HPTankEmblemItem"]);
  assert.equal(result.query.itemPolicy, "include_special");
  assert.equal(result.clarification.needsClarification, false);
  assert.ok(result.rankedBuilds.length > 0);
  assert.ok(result.rankedBuilds.every((build) => build.items.includes("TFT17_Item_HPTankEmblemItem")));
});

test("a four-Brawler follow-up maps to the second current trait tier and inherits the unit", async () => {
  const base = createCatalog();
  const traits = buildTraitCatalogFromExplorerRows({
    data: [
      { traits: "TFT17_HPTank_1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  });
  const catalog = createCatalog({
    units: [
      ...base.units,
      {
        apiName: "TFT17_MasterYi",
        zhName: "易",
        aliases: ["易", "剑圣", "master yi", "yi"]
      }
    ],
    traits
  });
  const rows = [{
    unit_builds: "TFT17_MasterYi&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  }];
  const cacheStore = new MemoryCacheStore();
  let structuredParserCalls = 0;

  await recommendForInput("易怎么出装？", { catalog, response: rows, cacheStore });
  const result = await recommendForInput("如果开了4斗士羁绊呢？", {
    catalog,
    response: rows,
    cacheStore,
    useStructuredParser: "auto",
    structuredParser: async ({ parsed }) => {
      structuredParserCalls += 1;
      assert.equal(parsed.unit, "TFT17_MasterYi");
      assert.deepEqual(parsed.traitFilters, ["TFT17_HPTank_2"]);
      return {
        intent: "unit_build_rankings",
        entities: {
          unit_mentions: [],
          item_mentions: [],
          trait_mentions: ["4斗士"]
        },
        constraints: {},
        needs_clarification: false,
        clarification_question: null
      };
    }
  });

  assert.equal(traits.find((trait) => trait.filterId === "TFT17_HPTank_1").displayName, "2斗士");
  assert.equal(traits.find((trait) => trait.filterId === "TFT17_HPTank_2").displayName, "4斗士");
  assert.equal(traits.find((trait) => trait.filterId === "TFT17_HPTank_3").displayName, "6斗士");
  assert.equal(structuredParserCalls, 1);
  assert.equal(result.cache.session.inherited, true);
  assert.equal(result.query.unit, "TFT17_MasterYi");
  assert.deepEqual(result.query.traitFilters, ["TFT17_HPTank_2"]);
  assert.deepEqual(result.plan.params.trait, ["TFT17_HPTank_2"]);
  assert.equal(result.clarification.needsClarification, false);
});

test("an explicit exclusion in a follow-up overrides an inherited owned item", async () => {
  const cacheStore = new MemoryCacheStore();
  const rows = [
    fixtureRows[0],
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
    }
  ];

  await recommendForInput("霞有羊刀，剩下两件怎么带？", { response: rows, cacheStore });
  const result = await recommendForInput("那不要羊刀呢？", { response: rows, cacheStore });

  assert.equal(result.cache.session.inherited, true);
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.ownedItems, []);
  assert.deepEqual(result.query.excludedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.ok(result.rankedBuilds.every((build) => !build.items.includes("TFT_Item_GuinsoosRageblade")));
});

test.skip("obsolete: session follow-ups restore default comps context from cache instead of treating it as user input", async () => {
  const cacheStore = new MemoryCacheStore();
  const compsData = {
    compOptions: [
      {
        cluster: "session-context",
        comp_name: "观星霞",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1",
        count: 1000,
        score: 75,
        avg: 3.9
      }
    ]
  };
  const options = {
    response: fixtureRows,
    cacheStore,
    compsData
  };

  const first = await recommendForInput("xayah", options);
  const followUp = await recommendForInput("guinsoo", options);

  assert.equal(first.query.defaultContext.clusterId, "session-context");
  assert.equal(followUp.cache.session.inherited, true);
  assert.equal(followUp.cache.session.inheritedKeys.includes("traitFilters"), false);
  assert.equal(followUp.cache.defaultContext.hit, true);
  assert.equal(followUp.query.defaultContext.clusterId, "session-context");
  assert.equal(
    followUp.query.assumptions.find((entry) => entry.key === "trait_filters").source,
    "default_context"
  );
  assert.match(followUp.text, /默认阵容来源：MetaTFT \/comps/);
  assert.equal(followUp.query.constraints.trait_filters.source, "default_context");
});

test("recommendForInput reuses cached MetaTFT unit_builds responses", async () => {
  const cacheStore = new MemoryCacheStore();
  let calls = 0;
  const metaTFTClient = {
    async getUnitBuilds() {
      calls += 1;
      return { data: fixtureRows };
    }
  };

  const first = await recommendForInput("xayah", {
    metaTFTClient,
    cacheStore,
    useSession: false
  });
  const second = await recommendForInput("xayah", {
    metaTFTClient,
    cacheStore,
    useSession: false
  });

  assert.equal(calls, 1);
  assert.equal(first.cache.query.hit, false);
  assert.equal(typeof first.sourceUpdatedAt, "string");
  assert.equal(second.cache.query.hit, true);
  assert.equal(second.sourceUpdatedAt, first.sourceUpdatedAt);
  assert.ok(second.rankedBuilds.length > 0);
});

test("recommendForInput surfaces the update time when it falls back to an expired cache", async () => {
  let now = Date.parse("2026-07-10T04:00:00.000Z");
  const cacheStore = new MemoryCacheStore({ now: () => now });
  let shouldFail = false;
  const metaTFTClient = {
    async getUnitBuilds() {
      if (shouldFail) throw new Error("Explorer unavailable");
      return { data: fixtureRows };
    }
  };
  const options = {
    metaTFTClient,
    cacheStore,
    queryTtlMs: 1000,
    useSession: false
  };

  const first = await recommendForInput("2星霞，3观星，携带哪三件普通装备最好？", options);
  now += 1001;
  shouldFail = true;
  const second = await recommendForInput("2星霞，3观星，携带哪三件普通装备最好？", options);

  assert.equal(first.cache.query.hit, false);
  assert.equal(second.cache.query.hit, true);
  assert.equal(second.cache.query.stale, true);
  assert.equal(second.cache.query.updatedAt, "2026-07-10T04:00:00.000Z");
  assert.equal(second.sourceUpdatedAt, "2026-07-10T04:00:00.000Z");
  assert.match(second.query.warnings.join("；"), /MetaTFT 请求失败，已使用 2026-07-10T04:00:00.000Z 的缓存结果/);
  assert.match(second.text, /MetaTFT 请求失败，已使用 2026-07-10T04:00:00.000Z 的缓存结果/);
  assert.ok(second.rankedBuilds.length > 0);
});

test.skip("obsolete: recommendForInput reuses cached default context", async () => {
  const cacheStore = new MemoryCacheStore();
  let latestCalls = 0;
  let optionCalls = 0;
  const compsClient = {
    async getLatestClusterInfo() {
      latestCalls += 1;
      return [];
    },
    async getCompOptions() {
      optionCalls += 1;
      return [
        {
          cluster: "cache-test",
          units_list: "TFT17_Aatrox&TFT17_Xayah",
          traits_list: "TFT17_Stargazer_1",
          count: 250,
          score: 80,
          avg: 4.2
        }
      ];
    }
  };
  const metaTFTClient = {
    async getUnitBuilds() {
      return { data: fixtureRows };
    }
  };

  const first = await recommendForInput("xayah", {
    metaTFTClient,
    compsClient,
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });
  const second = await recommendForInput("xayah", {
    metaTFTClient,
    compsClient,
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });

  assert.equal(latestCalls, 1);
  assert.equal(optionCalls, 1);
  assert.equal(first.cache.defaultContext.hit, false);
  assert.equal(second.cache.defaultContext.hit, true);
  assert.deepEqual(second.query.traitFilters, ["TFT17_Stargazer_1"]);
});

test.skip("obsolete: recommendForInput invalidates cached default context when fresh comps data changes cluster", async () => {
  const cacheStore = new MemoryCacheStore();
  const metaTFTClient = {
    async getUnitBuilds() {
      return { data: fixtureRows };
    }
  };
  const oldCompsData = {
    latestClusterInfo: [],
    compOptions: [
      {
        cluster: "old-cluster",
        units_list: "TFT17_Aatrox&TFT17_Xayah",
        traits_list: "TFT17_Stargazer_1",
        count: 250,
        score: 80,
        avg: 4.2
      }
    ]
  };
  const newCompsData = {
    latestClusterInfo: [],
    compOptions: [
      {
        cluster: "new-cluster",
        units_list: "TFT17_Aatrox&TFT17_Xayah",
        traits_list: "TFT17_Stargazer_1",
        count: 500,
        score: 90,
        avg: 3.9
      }
    ]
  };

  const first = await recommendForInput("xayah", {
    metaTFTClient,
    compsData: oldCompsData,
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });
  const second = await recommendForInput("xayah", {
    metaTFTClient,
    compsData: newCompsData,
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });

  assert.equal(first.query.defaultContext.clusterId, "old-cluster");
  assert.equal(second.cache.defaultContext.invalidated, true);
  assert.equal(second.cache.defaultContext.invalidationReason, "cluster_changed");
  assert.equal(second.cache.defaultContext.previousClusterId, "old-cluster");
  assert.equal(second.query.defaultContext.clusterId, "new-cluster");
});

test.skip("obsolete: recommendForInput refreshes cached comp_builds evidence without changing the selected cluster", async () => {
  const cacheStore = new MemoryCacheStore();
  const metaTFTClient = {
    async getUnitBuilds() {
      return { data: fixtureRows };
    }
  };
  const compOptions = [
    {
      cluster: "xayah-cluster",
      units_list: "TFT17_Aatrox&TFT17_Xayah",
      traits_list: "TFT17_Stargazer_1",
      count: 250,
      score: 80,
      avg: 4.2
    }
  ];

  const first = await recommendForInput("xayah", {
    metaTFTClient,
    compsData: {
      latestClusterInfo: [],
      compOptions
    },
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });
  const second = await recommendForInput("xayah", {
    metaTFTClient,
    compsData: {
      latestClusterInfo: [],
      compOptions,
      compBuilds: [
        {
          cluster: "xayah-cluster",
          unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
          count: 123,
          score: 0.7,
          avg: 3.33
        }
      ]
    },
    cacheStore,
    defaultContextOptions: {
      minClusterSamples: 10
    },
    useSession: false
  });

  assert.equal(first.query.defaultContext.clusterId, "xayah-cluster");
  assert.deepEqual(first.query.defaultContext.compBuilds, []);
  assert.equal(second.cache.defaultContext.invalidated, true);
  assert.equal(second.cache.defaultContext.invalidationReason, "comp_builds_changed");
  assert.equal(second.query.defaultContext.clusterId, "xayah-cluster");
  assert.deepEqual(second.query.defaultContext.compBuilds[0].items, [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge",
    "TFT_Item_GiantSlayer"
  ]);
});

test("recommendForInput ignores prefetched Comp context unless the user specifies a Comp", async () => {
  let compsCalls = 0;
  const result = await recommendForInput("xayah", {
    response: fixtureRows,
    compsData: {
      latestClusterInfo: [],
      compOptions: [],
      compBuilds: []
    },
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls += 1;
        throw new Error("should not retry latest_cluster_info");
      },
      async getCompOptions() {
        compsCalls += 1;
        throw new Error("should not retry comp_options");
      }
    },
    useSession: false
  });

  assert.equal(compsCalls, 0);
  assert.equal(result.query.defaultContext, null);
  assert.equal(result.query.comp, null);
  assert.doesNotMatch(result.query.warnings.join("；"), /Comp/);
  assert.ok(result.rankedBuilds.length > 0);
});

test("memory cache entries expire unless stale reads are allowed", () => {
  let now = Date.parse("2026-07-05T00:00:00.000Z");
  const cacheStore = new MemoryCacheStore({
    now: () => now,
    ttlMs: {
      query: 1000
    }
  });

  cacheStore.setQuery("query:test", { response: { ok: true } });
  assert.equal(cacheStore.getQuery("query:test").value.response.ok, true);

  now += 1001;
  assert.equal(cacheStore.getQuery("query:test"), null);
  const stale = cacheStore.getQuery("query:test", { allowExpired: true });
  assert.equal(stale.expired, true);
  assert.equal(stale.value.response.ok, true);
});

test("json file cache store persists cache state across instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tft-agent-cache-"));
  try {
    const filePath = join(dir, "cache.json");
    const first = new JsonFileCacheStore({ filePath });
    await first.setSessionState("last_query", {
      query: {
        unit: "TFT17_Xayah"
      }
    });
    await first.setQuery("query:persisted", {
      response: {
        ok: true
      }
    });
    await first.setDefaultContext("default_context:persisted", {
      unit: "TFT17_Xayah",
      clusterId: "persisted"
    });
    await first.setUserPreference("small_window", {
      minSamples: 500
    });
    await first.setItemCatalog("current", [{
      apiName: "TFT_Item_PersistedTest",
      zhName: "持久化测试装备",
      aliases: ["测试装备"],
      category: "ordinary_completed",
      current: true,
      obtainable: true
    }]);
    await first.setDomainCatalog("current", {
      units: [{
        apiName: "TFT17_PersistedUnit",
        zhName: "持久化英雄",
        aliases: ["持久化英雄"],
        current: true
      }],
      traits: [{
        filterId: "TFT17_PersistedTrait_1",
        apiName: "TFT17_PersistedTrait",
        zhName: "持久化羁绊",
        displayName: "持久化羁绊",
        aliases: ["持久化羁绊"],
        current: true
      }]
    });
    await first.addEntityAlias({
      alias: "羽毛女",
      entityType: "unit",
      apiName: "TFT17_Xayah",
      confidence: 0.6,
      source: "feedback_candidate",
      enabled: false
    });
    await first.addFeedbackEvent("entity_correction", {
      feedbackId: "persisted-feedback",
      input: "羽毛女",
      correction: "TFT17_Xayah"
    });

    const second = new JsonFileCacheStore({ filePath });
    const session = await second.getSessionState("last_query");
    const query = await second.getQuery("query:persisted");
    const defaultContext = await second.getDefaultContext("default_context:persisted");
    const preferences = await second.getUserPreference("small_window");
    const itemCatalog = await second.getItemCatalog("current");
    const domainCatalog = await second.getDomainCatalog("current");
    const aliases = await second.listEntityAliases({
      enabled: false
    });
    const feedback = await second.listFeedbackEvents({
      feedbackType: "entity_correction"
    });

    assert.equal(session.value.query.unit, "TFT17_Xayah");
    assert.equal(query.value.response.ok, true);
    assert.equal(defaultContext.value.clusterId, "persisted");
    assert.equal(preferences.value.minSamples, 500);
    assert.equal(itemCatalog.value.items[0].apiName, "TFT_Item_PersistedTest");
    assert.equal(domainCatalog.value.units[0].apiName, "TFT17_PersistedUnit");
    assert.equal(domainCatalog.value.traits[0].filterId, "TFT17_PersistedTrait_1");
    assert.equal(aliases[0].alias, "羽毛女");
    assert.equal(aliases[0].enabled, false);
    assert.equal(feedback[0].payload.correction, "TFT17_Xayah");
    assert.equal((await second.findFeedbackEventByFeedbackId("persisted-feedback")).id, feedback[0].id);

    const cleared = await second.clearQueryHistory();
    assert.deepEqual(cleared, {
      queryCache: 1,
      defaultContextCache: 1,
      sessionState: 1
    });
    assert.equal(await second.getSessionState("last_query"), null);
    assert.equal(await second.getQuery("query:persisted"), null);
    assert.equal(await second.getDefaultContext("default_context:persisted"), null);
    assert.equal((await second.getUserPreference("small_window")).value.minSamples, 500);
    assert.equal((await second.getItemCatalog("current")).value.items.length, 1);
    assert.equal((await second.getDomainCatalog("current")).value.units.length, 1);
    assert.equal(await second.clearItemCatalog("current"), 1);
    assert.equal(await second.getItemCatalog("current"), null);
    assert.deepEqual(await second.clearDomainCatalog("current"), {
      units: 1,
      traits: 1
    });
    assert.equal(await second.getDomainCatalog("current"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite cache store exposes the cache interface and schema tables", () => {
  let now = Date.parse("2026-07-05T00:00:00.000Z");
  const database = new FakeSQLiteDatabase();
  const cacheStore = new SQLiteCacheStore({
    database,
    now: () => now,
    ttlMs: {
      query: 1000,
      session: 1000
    }
  });

  assert.match(SQLITE_CACHE_SCHEMA, /CREATE TABLE IF NOT EXISTS entity_aliases/);
  assert.match(SQLITE_CACHE_SCHEMA, /CREATE TABLE IF NOT EXISTS item_catalog/);
  assert.match(SQLITE_CACHE_SCHEMA, /CREATE TABLE IF NOT EXISTS units/);
  assert.match(SQLITE_CACHE_SCHEMA, /CREATE TABLE IF NOT EXISTS traits/);
  assert.match(database.schema, /CREATE TABLE IF NOT EXISTS query_cache/);

  cacheStore.setQuery("query:sqlite", {
    request: {
      path: "/tft-explorer-api/unit_builds/TFT17_Xayah"
    },
    response: {
      data: fixtureRows
    },
    query: {
      patch: "current"
    }
  });
  cacheStore.setSessionState("last_query", {
    query: {
      unit: "TFT17_Xayah"
    }
  });
  cacheStore.setUserPreference("small_window", {
    minSamples: 500
  });
  const disabledAlias = cacheStore.addEntityAlias({
    alias: "羽毛女",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 0.6,
    source: "feedback_candidate",
    enabled: false
  });
  cacheStore.addEntityAlias({
    alias: "逆羽",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 1,
    source: "manual",
    enabled: true
  });
  const feedback = cacheStore.addFeedbackEvent("entity_correction", {
    feedbackId: "sqlite-feedback",
    input: "羽毛女",
    correction: "TFT17_Xayah"
  });

  assert.equal(cacheStore.getQuery("query:sqlite").value.response.data.length, fixtureRows.length);
  assert.equal(database.tables.query_cache.get("query:sqlite").patch, "current");
  assert.equal(cacheStore.getSessionState("last_query").value.query.unit, "TFT17_Xayah");
  assert.equal(cacheStore.getUserPreference("small_window").value.minSamples, 500);
  assert.equal(cacheStore.findEntityAliases("逆羽")[0].apiName, "TFT17_Xayah");
  assert.equal(cacheStore.findEntityAliases("羽毛女").length, 0);
  assert.equal(cacheStore.listEntityAliases({ enabled: false })[0].alias, "羽毛女");
  assert.equal(cacheStore.setEntityAliasEnabled(disabledAlias.id, true).enabled, true);
  assert.equal(cacheStore.findEntityAliases("羽毛女")[0].apiName, "TFT17_Xayah");
  assert.equal(feedback.feedbackType, "entity_correction");
  assert.equal(cacheStore.findFeedbackEventByFeedbackId("sqlite-feedback").id, feedback.id);
  assert.equal(cacheStore.listFeedbackEvents({ feedbackType: "entity_correction" })[0].payload.correction, "TFT17_Xayah");

  cacheStore.addEntityAlias({
    alias: "待清候选",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 0.5,
    enabled: false
  });
  assert.equal(cacheStore.clearEntityAliases({ enabled: false }), 1);
  assert.equal(cacheStore.listEntityAliases({ enabled: false }).length, 0);
  assert.equal(cacheStore.clearFeedbackEvents(), 1);
  assert.equal(cacheStore.listFeedbackEvents().length, 0);

  now += 1001;
  assert.equal(cacheStore.getQuery("query:sqlite"), null);
  assert.equal(cacheStore.getQuery("query:sqlite", { allowExpired: true }).expired, true);
  assert.equal(cacheStore.getUserPreference("small_window").expired, false);

  cacheStore.clearExpired();
  assert.equal(cacheStore.getQuery("query:sqlite", { allowExpired: true }), null);

  cacheStore.setQuery("query:transient", {
    response: {
      data: fixtureRows
    }
  });
  cacheStore.setDefaultContext("default_context:transient", {
    unit: "TFT17_Xayah",
    clusterId: "sqlite-clear"
  });
  cacheStore.setSessionState("last_query", {
    query: {
      unit: "TFT17_Xayah"
    }
  });

  const cleared = cacheStore.clearQueryHistory();
  assert.deepEqual(cleared, {
    queryCache: 1,
    defaultContextCache: 1,
    sessionState: 1
  });
  assert.equal(cacheStore.getQuery("query:transient"), null);
  assert.equal(cacheStore.getDefaultContext("default_context:transient"), null);
  assert.equal(cacheStore.getSessionState("last_query"), null);
  assert.equal(cacheStore.getUserPreference("small_window").value.minSamples, 500);
});

test("builds item catalog categories from captured MetaTFT items response", () => {
  const items = buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"));
  const byApiName = new Map(items.map((item) => [item.apiName, item]));

  assert.ok(items.length > 100);
  assert.equal(byApiName.get("TFT_Item_RapidFireCannon").category, "ordinary_completed");
  assert.equal(byApiName.get("TFT_Item_RapidFireCannon").current, true);
  assert.equal(byApiName.get("TFT_Item_JeweledGauntlet").shortName, "法爆");
  assert.equal(byApiName.get("TFT_Item_JeweledGauntlet").aliases.includes("珠光护手"), true);
  assert.equal(byApiName.get("TFT_Item_TitansResolve").aliases.includes("泰坦"), true);
  assert.equal(byApiName.get("TFT_Item_TitansResolve").aliasSource, "manual");
  assert.equal(byApiName.get("TFT_Item_TitansResolve").aliasConfidence, 1);
  assert.equal(byApiName.get("TFT_Item_RecurveBow").category, "component");
  assert.equal(byApiName.get("TFT5_Item_GuinsoosRagebladeRadiant").category, "radiant");
  assert.equal(byApiName.get("TFT5_Item_BlueBuffRadiant").zhName, "光明版蓝霸符");
  assert.equal(byApiName.get("TFT5_Item_BlueBuffRadiant").aliases.includes("光明蓝buff"), true);
  assert.equal(byApiName.get("TFT5_Item_BlueBuffRadiant").aliases.includes("光蓝"), true);
  assert.equal(byApiName.get("TFT5_Item_GuinsoosRagebladeRadiant").aliases.includes("光羊刀"), true);
  assert.equal(byApiName.get("TFT5_Item_JeweledGauntletRadiant").aliases.includes("光法爆"), true);
  assert.equal(byApiName.get("TFT5_Item_BlueBuffRadiant").aliasSource, "derived_radiant_alias");
  assert.equal(byApiName.get("TFT5_Item_BlueBuffRadiant").nameSource, "tencent_lol_official_tft_catalog");
  assert.equal(byApiName.get("TFT_Item_PowerGauntlet").shortName, "破防");
  assert.equal(byApiName.get("TFT_Item_PowerGauntlet").aliases.includes("强袭者的链枷"), true);
  assert.equal(byApiName.get("TFT5_Item_TrapClawRadiant").shortName, "光破防");
  assert.equal(byApiName.get("TFT5_Item_TrapClawRadiant").aliases.includes("光破防"), true);
  assert.equal(byApiName.get("TFT5_Item_TrapClawRadiant").aliases.includes("光明女妖"), false);
  assert.equal(byApiName.get("TFT5_Item_TrapClawRadiant").aliases.includes("光明女妖之爪"), false);
  assert.equal(byApiName.get("TFT5_Item_TrapClawRadiant").aliasSource, "manual_player_alias");
  assert.equal(byApiName.get("TFT_Item_Artifact_NavoriFlickerblades").category, "artifact");
  assert.equal(byApiName.get("TFT_Item_Artifact_RapidFirecannon").shortName, "疾射火炮");
  assert.equal(byApiName.get("TFT_Item_Artifact_RapidFirecannon").aliasSource, "manual_official_name_with_historical_aliases");
  assert.equal(byApiName.get("TFT_Item_Artifact_StatikkShiv").aliases.includes("电刀神器"), true);
  assert.equal(byApiName.get("TFT_Item_Artifact_Fishbones").shortName, "鱼骨头");
  assert.equal(byApiName.get("TFT_Item_Artifact_Fishbones").aliasSource, "manual");
  assert.equal(byApiName.get("TFT4_Item_OrnnInfinityForce").shortName, "三相");
  assert.equal(byApiName.get("TFT17_Item_StargazerEmblemItem").category, "emblem");
  assert.equal(byApiName.get("TFT17_Item_StargazerEmblemItem").zhName, "观星者纹章");
  assert.equal(byApiName.get("TFT17_Item_DarkStarEmblemItem").shortName, "暗星转");
  assert.equal(byApiName.get("TFT17_Item_DarkStarEmblemItem").aliases.includes("暗星转职"), true);
  assert.equal(byApiName.get("TFT17_Item_DarkStarEmblemItem").aliasSource, "derived_emblem_alias");
  assert.equal(byApiName.get("TFT17_Item_FavoredEmblemItem").shortName, "法官纹章");
  assert.equal(byApiName.get("TFT17_Item_FavoredEmblemItem").aliasSource, "derived_unknown_emblem_alias");
  assert.equal(byApiName.get("TFT5_Item_HandOfJusticeRadiant").aliases.includes("光明正义"), true);
  assert.equal(byApiName.get("TFT_Item_TacticiansRing").shortName, "战术家戒指");
  assert.equal(byApiName.get("TFT_Item_Leviathan").shortName, "利维坦");
  assert.equal(byApiName.get("TFT5_Item_LeviathanRadiant").aliases.includes("光明利维坦"), true);
  assert.equal(byApiName.get("TFT_Item_Artifact_HellfireHatchet").shortName, "地狱火斧");
  assert.equal(byApiName.get("TFT7_Item_ShimmerscaleGamblersBlade").shortName, "投机刀");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow").category, "set_special");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow").zhName, "战兔十字弩");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow").aliasSource, "derived_set_special_alias");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_RadiantField").category, "set_special");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_RadiantField").shortName, "光辉力场");
  assert.equal(byApiName.get("TFT17_Item_PsyOps_DroneMod").shortName, "无人机改件");
  assert.equal(byApiName.get("TFT17_Item_PsyOps_DroneMod_Radiant").zhName, "无人机上行链路");
  assert.equal(byApiName.get("TFT17_Item_Artifact_AhriArtifact").shortName, "阿狸神器");
  assert.equal(byApiName.get("TFT17_EkkoOffering_AnomalyItem").shortName, "艾克异常");
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").zhName, "帽子饮品");
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").aliases.includes("Cappa Juice"), true);
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").nameStatus, "official_zh_cn");
  assert.equal(byApiName.get("TFT_Item_RunaansHurricane").category, "ordinary_completed");
  assert.equal(byApiName.get("TFT_Item_RunaansHurricane").current, true);
  assert.equal(byApiName.get("TFT_Item_RunaansHurricane").shortName, "海妖之怒");
});

test("builds item catalog from itemName/places MetaTFT captures", () => {
  const items = buildItemCatalogFromItemsResponse(readProbeJson("meta_items.json"));
  const byApiName = new Map(items.map((item) => [item.apiName, item]));

  assert.ok(items.length > 100);
  assert.equal(byApiName.get("TFT_Item_GuinsoosRageblade").category, "ordinary_completed");
  assert.equal(byApiName.get("TFT17_Item_StargazerEmblemItem").category, "emblem");
  assert.equal(byApiName.get("TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow").category, "set_special");
});

test("builds unit and trait catalogs from captured comps data", () => {
  const compsData = {
    latestClusterInfo: readProbeJson("meta_latest_cluster.json"),
    compOptions: readProbeJson("meta_comp_options.json")
  };
  const units = buildUnitCatalogFromCompsData(compsData);
  const traits = buildTraitCatalogFromCompsData(compsData);
  const unitByApiName = new Map(units.map((unit) => [unit.apiName, unit]));
  const traitByFilterId = new Map(traits.map((trait) => [trait.filterId, trait]));

  assert.ok(units.length > 50);
  assert.ok(traits.length > 50);
  assert.equal(unitByApiName.get("TFT17_Xayah").zhName, "霞");
  assert.equal(unitByApiName.get("TFT17_Xayah").aliases.includes("xayah"), true);
  assert.equal(unitByApiName.has("TFT17_Aatrox"), true);
  assert.equal(unitByApiName.get("TFT17_Aatrox").zhName, "亚托克斯");
  assert.equal(unitByApiName.get("TFT17_Aatrox").aliases.includes("剑魔"), true);
  assert.equal(unitByApiName.get("TFT17_Aatrox").aliases.includes("Aatrox"), true);
  assert.equal(unitByApiName.get("TFT17_Aatrox").aliasSource, "lol_champion_name");
  assert.equal(unitByApiName.get("TFT17_Aatrox").aliasConfidence, 1);
  assert.equal(traitByFilterId.get("TFT17_Stargazer_1").displayName, "3观星");
  assert.equal(traitByFilterId.get("TFT17_Stargazer_1").aliases.includes("观星"), true);
});

test("builds unit and trait catalogs from Explorer aggregate rows", () => {
  const units = buildUnitCatalogFromExplorerRows({
    data: [
      { units_unique: null, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { units_unique: "TFT17_Aatrox-1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] },
      { units_unique: "TFT17_Aatrox-2", placement_count: [1, 2, 3, 4, 5, 6, 7, 8] },
      { units_unique: "TFT17_TwistedFate-1", placement_count: [3, 4, 5, 6, 7, 8, 9, 10] },
      { units_unique: "TFT17_Xayah-2", placement_count: [8, 7, 6, 5, 4, 3, 2, 1] }
    ]
  });
  const traits = buildTraitCatalogFromExplorerRows({
    data: [
      { traits: null, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { traits: "TFT17_RangedTrait_1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] },
      { traits: "TFT17_Stargazer_1", placement_count: [8, 7, 6, 5, 4, 3, 2, 1] }
    ]
  });
  const unitByApiName = new Map(units.map((unit) => [unit.apiName, unit]));
  const traitByFilterId = new Map(traits.map((trait) => [trait.filterId, trait]));

  assert.equal(unitByApiName.has("TFT17_Aatrox"), true);
  assert.equal(unitByApiName.get("TFT17_Aatrox").zhName, "亚托克斯");
  assert.equal(unitByApiName.get("TFT17_Aatrox").aliases.includes("Aatrox"), true);
  assert.equal(unitByApiName.get("TFT17_TwistedFate").aliases.includes("卡牌"), true);
  assert.equal(unitByApiName.get("TFT17_Xayah").zhName, "霞");
  assert.equal(traitByFilterId.has("TFT17_RangedTrait_1"), true);
  assert.equal(traitByFilterId.get("TFT17_RangedTrait_1").zhName, "狙神");
  assert.equal(traitByFilterId.get("TFT17_RangedTrait_1").displayName, "2狙神");
  assert.equal(traitByFilterId.get("TFT17_RangedTrait_1").aliasSource, "trait_token_mapping");
  assert.equal(traitByFilterId.get("TFT17_Stargazer_1").displayName, "3观星");
});

test("generated domain catalog lets parser recognize non-seed unit tokens", () => {
  const catalog = createCatalog({
    units: buildUnitCatalogFromCompsData({
      latestClusterInfo: readProbeJson("meta_latest_cluster.json"),
      compOptions: readProbeJson("meta_comp_options.json")
    }),
    traits: buildTraitCatalogFromCompsData({
      latestClusterInfo: readProbeJson("meta_latest_cluster.json"),
      compOptions: readProbeJson("meta_comp_options.json")
    })
  });
  const result = planQuery("aatrox带哪三件装备？", { catalog });

  assert.equal(result.validation.valid, true);
  assert.equal(result.query.unit, "TFT17_Aatrox");
  assert.equal(result.plan.pathUnit, "TFT17_Aatrox");
});

test("generated domain catalog lets parser recognize manual Chinese unit aliases", () => {
  const catalog = createCatalog({
    units: buildUnitCatalogFromExplorerRows({
      data: [
        { units_unique: "TFT17_Aatrox-1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] },
        { units_unique: "TFT17_TwistedFate-1", placement_count: [3, 4, 5, 6, 7, 8, 9, 10] }
      ]
    }),
    traits: buildTraitCatalogFromExplorerRows({
      data: [
        { traits: "TFT17_Stargazer_1", placement_count: [8, 7, 6, 5, 4, 3, 2, 1] }
      ]
    })
  });
  const aatrox = planQuery("剑魔带哪三件装备？", { catalog });
  const twistedFate = planQuery("卡牌三件套", { catalog });

  assert.equal(aatrox.validation.valid, true);
  assert.equal(aatrox.query.unit, "TFT17_Aatrox");
  assert.equal(aatrox.parsed.unitAlias, "剑魔");
  assert.equal(twistedFate.validation.valid, true);
  assert.equal(twistedFate.query.unit, "TFT17_TwistedFate");
  assert.equal(twistedFate.parsed.unitAlias, "卡牌");
});

test("generated domain catalog recognizes api-level Chinese trait aliases", () => {
  const catalog = createCatalog({
    units: buildUnitCatalogFromExplorerRows({
      data: [
        { units_unique: "TFT17_Xayah-1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] }
      ]
    }),
    traits: buildTraitCatalogFromExplorerRows({
      data: [
        { traits: "TFT17_DarkStar_1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] },
        { traits: "TFT17_DarkStar_4", placement_count: [9, 8, 7, 6, 5, 4, 3, 2] },
        { traits: "TFT17_AnimaSquad_2", placement_count: [8, 7, 6, 5, 4, 3, 2, 1] },
        { traits: "TFT17_BlitzcrankUniqueTrait_1", placement_count: [7, 6, 5, 4, 3, 2, 1, 1] },
        { traits: "TFT17_Stargazer_Mountain_6", placement_count: [6, 5, 4, 3, 2, 1, 1, 1] },
        { traits: "TFT17_Stargazer_Wolf_4", placement_count: [5, 4, 3, 2, 1, 1, 1, 1] }
      ]
    })
  });
  const traitByFilterId = catalog.traitByFilterId;

  assert.equal(traitByFilterId.get("TFT17_DarkStar_4").zhName, "暗星");
  assert.equal(traitByFilterId.get("TFT17_DarkStar_4").displayName, "9暗星");
  assert.equal(traitByFilterId.get("TFT17_AnimaSquad_2").zhName, "幻灵战队");
  assert.equal(traitByFilterId.get("TFT17_BlitzcrankUniqueTrait_1").zhName, "汪星机器人");
  assert.equal(traitByFilterId.get("TFT17_Stargazer_Mountain_6").displayName, "8秀山观星");
  assert.equal(traitByFilterId.get("TFT17_Stargazer_Wolf_4").zhName, "野猪");
  assert.equal(traitByFilterId.get("TFT17_Stargazer_Wolf_4").displayName, "6野猪观星");

  const darkStar = planQuery("暗星霞三件套", { catalog });
  const fourDarkStar = planQuery("加入4暗星的霞三件套", { catalog });
  const sixDarkStar = planQuery("加入6暗星的霞三件套", { catalog });
  const animaSquad = planQuery("幻灵霞三件套", { catalog });
  const mountain = planQuery("秀山观星霞三件套", { catalog });
  const fourWolf = planQuery("4野猪观星霞三件套", { catalog });
  const sixWolf = planQuery("6野猪观星霞三件套", { catalog });
  const uniqueTrait = planQuery("机器人专属霞三件套", { catalog });

  assert.equal(darkStar.validation.valid, true);
  assert.equal(darkStar.query.unit, "TFT17_Xayah");
  assert.deepEqual(darkStar.query.traitFilters, ["TFT17_DarkStar_1"]);
  assert.equal(fourDarkStar.validation.valid, true);
  assert.deepEqual(fourDarkStar.query.traitFilters, ["TFT17_DarkStar_2"]);
  assert.equal(sixDarkStar.validation.valid, true);
  assert.deepEqual(sixDarkStar.query.traitFilters, ["TFT17_DarkStar_3"]);
  assert.equal(animaSquad.validation.valid, true);
  assert.deepEqual(animaSquad.query.traitFilters, ["TFT17_AnimaSquad_1"]);
  assert.equal(mountain.validation.valid, true);
  assert.deepEqual(mountain.query.traitFilters, ["TFT17_Stargazer_Mountain_1"]);
  assert.equal(fourWolf.validation.valid, true);
  assert.deepEqual(fourWolf.query.traitFilters, ["TFT17_Stargazer_Wolf_2"]);
  assert.equal(sixWolf.validation.valid, true);
  assert.deepEqual(sixWolf.query.traitFilters, ["TFT17_Stargazer_Wolf_4"]);
  assert.equal(uniqueTrait.validation.valid, true);
  assert.deepEqual(uniqueTrait.query.traitFilters, ["TFT17_BlitzcrankUniqueTrait_1"]);
});

test("all current trait overrides export their Chinese names and MetaTFT tier aliases", () => {
  for (const override of TRAIT_ALIAS_OVERRIDES) {
    assert.equal(
      override.aliases.includes(override.zhName),
      true,
      `${override.apiName} must include zhName in aliases`
    );

    const counts = TRAIT_TIER_COUNTS[override.apiName];
    if (!counts) continue;
    assert.equal(Object.keys(override.tiers).length, counts.length);
    counts.forEach((count, index) => {
      const tier = override.tiers[String(index + 1)];
      assert.equal(tier.aliases.some((alias) => alias.startsWith(String(count))), true);
    });
  }
});

test("generated domain catalog recognizes expanded Chinese unit aliases", () => {
  const cases = [
    ["阿卡丽三件套", "TFT17_Akali", "阿卡丽"],
    ["龙王带什么装备", "TFT17_AurelionSol", "龙王"],
    ["机器人三件套", "TFT17_Blitzcrank", "机器人"],
    ["女警带什么", "TFT17_Caitlyn", "女警"],
    ["大虫子带什么", "TFT17_Chogath", "大虫子"],
    ["小鱼人三件套", "TFT17_Fizz", "小鱼人"],
    ["酒桶三件套", "TFT17_Gragas", "酒桶"],
    ["男枪三件套", "TFT17_Graves", "男枪"],
    ["戏命师三件套", "TFT17_Jhin", "戏命师"],
    ["金克丝带什么", "TFT17_Jinx", "金克丝"],
    ["虚空之女三件套", "TFT17_Kaisa", "虚空之女"],
    ["扇子妈带什么", "TFT17_Karma", "扇子妈"],
    ["千珏三件套", "TFT17_Kindred", "千珏"],
    ["妖姬带什么", "TFT17_Leblanc", "妖姬"],
    ["日女三件套", "TFT17_Leona", "日女"],
    ["冰女带什么", "TFT17_Lissandra", "冰女"],
    ["剑圣三件套", "TFT17_MasterYi", "剑圣"],
    ["女枪带什么", "TFT17_MissFortune", "女枪"],
    ["铁男三件套", "TFT17_Mordekaiser", "铁男"],
    ["莫甘娜带什么", "TFT17_Morgana", "莫甘娜"],
    ["娜美三件套", "TFT17_Nami", "娜美"],
    ["狗头带什么", "TFT17_Nasus", "狗头"],
    ["努努三件套", "TFT17_Nunu", "努努"],
    ["奥恩带什么", "TFT17_Ornn", "奥恩"],
    ["波比三件套", "TFT17_Poppy", "波比"],
    ["派克带什么", "TFT17_Pyke", "派克"],
    ["龙龟三件套", "TFT17_Rammus", "龙龟"],
    ["挖掘机带什么", "TFT17_RekSai", "挖掘机"],
    ["凯隐三件套", "TFT17_Rhaast", "凯隐"],
    ["锐雯带什么", "TFT17_Riven", "锐雯"],
    ["莎弥拉三件套", "TFT17_Samira", "莎弥拉"],
    ["慎带什么", "TFT17_Shen", "慎"],
    ["琴女三件套", "TFT17_Sona", "琴女"],
    ["塔姆带什么", "TFT17_TahmKench", "塔姆"],
    ["男刀三件套", "TFT17_Talon", "男刀"],
    ["提莫带什么", "TFT17_Teemo", "提莫"],
    ["螃蟹三件套", "TFT17_Urgot", "螃蟹"],
    ["小法带什么", "TFT17_Veigar", "小法"],
    ["薇古丝三件套", "TFT17_Vex", "薇古丝"],
    ["维克托带什么", "TFT17_Viktor", "维克托"],
    ["劫三件套", "TFT17_Zed", "劫"],
    ["佐伊带什么", "TFT17_Zoe", "佐伊"]
  ];
  const catalog = createCatalog({
    units: buildUnitCatalogFromExplorerRows({
      data: cases.map(([, apiName]) => ({
        units_unique: `${apiName}-1`,
        placement_count: [10, 9, 8, 7, 6, 5, 4, 3]
      }))
    })
  });

  for (const [input, expectedUnit, expectedAlias] of cases) {
    const planned = planQuery(input, { catalog });

    assert.equal(planned.validation.valid, true, input);
    assert.equal(planned.query.unit, expectedUnit, input);
    assert.equal(planned.parsed.unitAlias, expectedAlias, input);
  }

  const ornnEquipment = planQuery("奥恩什么装备最好", { catalog });
  assert.equal(ornnEquipment.query.unit, "TFT17_Ornn");
  assert.equal(ornnEquipment.query.intent, "unit_build_rankings");
  assert.equal(ornnEquipment.query.itemPolicy, "ordinary_only");
  assert.deepEqual(ornnEquipment.query.itemCategories, []);
});

test("generated item catalog lets parser recognize manual Chinese item aliases", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const planned = planQuery("霞已经有法爆和泰坦，剩下一件怎么带？", { catalog });

  assert.equal(planned.validation.valid, true);
  assert.deepEqual(planned.query.ownedItems, [
    "TFT_Item_JeweledGauntlet",
    "TFT_Item_TitansResolve"
  ]);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "法爆"), true);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "泰坦"), true);
});

test("generated item catalog lets parser recognize derived emblem and radiant aliases", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const planned = planQuery("霞已经有暗星转和光明蓝buff，剩下一件怎么带？", { catalog });
  const shortRadiantAliases = planQuery("霞已经有光羊刀、光法爆和光蓝", { catalog });

  assert.equal(planned.validation.valid, true);
  assert.deepEqual(planned.query.ownedItems, [
    "TFT17_Item_DarkStarEmblemItem",
    "TFT5_Item_BlueBuffRadiant"
  ]);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "暗星转"), true);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "光明蓝buff"), true);
  assert.deepEqual(shortRadiantAliases.query.ownedItems, [
    "TFT5_Item_GuinsoosRagebladeRadiant",
    "TFT5_Item_JeweledGauntletRadiant",
    "TFT5_Item_BlueBuffRadiant"
  ]);
  assert.equal(shortRadiantAliases.parsed.parser.entityMatches.some((match) => match.alias === "光羊刀"), true);
  assert.equal(shortRadiantAliases.parsed.parser.entityMatches.some((match) => match.alias === "光法爆"), true);
  assert.equal(shortRadiantAliases.parsed.parser.entityMatches.some((match) => match.alias === "光蓝"), true);
});

test("generated item catalog lets parser recognize artifact and support aliases", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const planned = planQuery("霞已经有鱼骨头和光明正义，剩下一件怎么带？", { catalog });

  assert.equal(planned.validation.valid, true);
  assert.deepEqual(planned.query.ownedItems, [
    "TFT_Item_Artifact_Fishbones",
    "TFT5_Item_HandOfJusticeRadiant"
  ]);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "鱼骨头"), true);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "光明正义"), true);
});

test("generated item catalog lets parser recognize more artifact aliases", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const planned = planQuery("霞已经有地狱火斧和光明利维坦，剩下一件怎么带？", { catalog });
  const derivedArtifact = planQuery("霞已经有神器火炮和Pulsefire Emblem，剩下一件怎么带？", { catalog });
  const officialEnglishAlias = planQuery("霞已经有神器Cappa Juice，剩下两件怎么带？", { catalog });

  assert.equal(planned.validation.valid, true);
  assert.deepEqual(planned.query.ownedItems, [
    "TFT_Item_Artifact_HellfireHatchet",
    "TFT5_Item_LeviathanRadiant"
  ]);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "地狱火斧"), true);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "光明利维坦"), true);
  assert.equal(derivedArtifact.validation.valid, true);
  assert.deepEqual(derivedArtifact.query.ownedItems, [
    "TFT_Item_Artifact_RapidFirecannon",
    "TFT17_Item_PulsefireEmblemItem"
  ]);
  assert.equal(derivedArtifact.parsed.parser.entityMatches.some((match) => match.alias === "神器火炮"), true);
  assert.equal(derivedArtifact.parsed.parser.entityMatches.some((match) => match.alias === "Pulsefire Emblem"), true);
  assert.deepEqual(officialEnglishAlias.query.ownedItems, ["TFT_Item_Artifact_CappaJuice"]);
  assert.equal(
    officialEnglishAlias.parsed.parser.entityMatches.some((match) => match.alias === "Cappa Juice"),
    true
  );
});

test("generated item catalog lets parser recognize derived set-special aliases", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const planned = planQuery("霞已经有T2战斗兔弩和光明无人机改件，剩下一件怎么带？", { catalog });
  const heroArtifact = planQuery("霞已经有阿狸神器和艾克异常，剩下一件怎么带？", { catalog });
  const ambiguousTier = recommendFromRows(
    "霞已经有战斗兔弩，剩下两件怎么带？",
    fixtureRows,
    { catalog }
  );

  assert.equal(planned.validation.valid, true);
  assert.deepEqual(planned.query.ownedItems, [
    "TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow",
    "TFT17_Item_PsyOps_DroneMod_Radiant"
  ]);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "T2战斗兔弩"), true);
  assert.equal(planned.parsed.parser.entityMatches.some((match) => match.alias === "光明无人机改件"), true);
  assert.equal(heroArtifact.validation.valid, true);
  assert.deepEqual(heroArtifact.query.ownedItems, [
    "TFT17_Item_Artifact_AhriArtifact",
    "TFT17_EkkoOffering_AnomalyItem"
  ]);
  assert.equal(heroArtifact.parsed.parser.entityMatches.some((match) => match.alias === "阿狸神器"), true);
  assert.equal(heroArtifact.parsed.parser.entityMatches.some((match) => match.alias === "艾克异常"), true);
  assert.equal(ambiguousTier.validation.valid, true);
  assert.equal(ambiguousTier.clarification.reason, "ambiguous_entity");
  assert.equal(ambiguousTier.clarification.blocking, true);
  assert.equal(ambiguousTier.rankedBuilds.length, 0);
  assert.equal(
    ambiguousTier.clarification.entityCandidates.some((candidate) => (
      candidate.apiName === "TFT17_AnimaSquadItem_Tier2_BattleBunnyCrossbow"
    )),
    true
  );
  assert.equal(
    ambiguousTier.clarification.entityCandidates.some((candidate) => (
      candidate.apiName === "TFT17_AnimaSquadItem_Tier3_BattleBunnyCrossbow"
    )),
    true
  );
});

test("classifies unknown item API names conservatively", () => {
  assert.equal(classifyItemApiName("TFT_Item_BFSword"), "component");
  assert.equal(classifyItemApiName("TFT_Consumable_ItemRemover_UsesLeft3"), "consumable");
  assert.equal(classifyItemApiName("TFT5_Item_InfinityEdgeRadiant"), "radiant");
  assert.equal(classifyItemApiName("TFT_Item_Artifact_Fishbones"), "artifact");
  assert.equal(classifyItemApiName("TFT17_Item_DarkStarEmblemItem"), "emblem");
  assert.equal(classifyItemApiName("TFT17_AnimaSquadItem_Tier2_UwuBlaster"), "set_special");
  assert.equal(classifyItemApiName("TFT17_AnimaSquadItem_Tier2_RadiantField"), "set_special");
  assert.equal(classifyItemApiName("TFT_Item_RunaansHurricane"), "ordinary_completed");
  assert.equal(classifyItemApiName("TFT_Item_Deathblade"), "ordinary_completed");
});

test("current official identity is not overridden by a permanent availability rule", () => {
  const configured = findItemAvailabilityOverride("TFT_Item_RunaansHurricane", "current");
  const historical = findItemAvailabilityOverride("TFT_Item_RunaansHurricane", "historical-test");
  const injectedItem = {
    apiName: "TFT_Item_RunaansHurricane",
    shortName: "分裂弓",
    aliases: ["分裂弓"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  };
  const catalogRecord = createCatalog({ items: [injectedItem] })
    .itemByApiName.get(injectedItem.apiName);
  const mergedRecord = mergeCatalogItems([injectedItem], [], { patch: "current" })[0];
  const historicalRecord = createCatalog({
    patch: "historical-test",
    items: [{ ...injectedItem, patch: "historical-test" }]
  }).itemByApiName.get(injectedItem.apiName);

  assert.equal(ITEM_AVAILABILITY_OVERRIDES.includes(configured), false);
  assert.equal(configured, null);
  assert.equal(historical, null);
  assert.equal(catalogRecord.category, "ordinary_completed");
  assert.equal(catalogRecord.current, true);
  assert.equal(catalogRecord.obtainable, true);
  assert.equal(catalogRecord.availabilityOverride, undefined);
  assert.equal(mergedRecord.category, "ordinary_completed");
  assert.equal(mergedRecord.current, true);
  assert.equal(mergedRecord.obtainable, true);
  assert.equal(historicalRecord.category, "ordinary_completed");
  assert.equal(historicalRecord.current, true);
  assert.equal(historicalRecord.obtainable, true);
});

test("caller removed-item sets do not invent a current Runaan hard rule", () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [
      { items: "TFT_Item_Deathblade", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { items: "TFT_Item_RunaansHurricane", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  }, {
    removedItems: new Set(["TFT_Item_Deathblade"])
  });
  const byApiName = new Map(items.map((item) => [item.apiName, item]));
  const deathblade = byApiName.get("TFT_Item_Deathblade");
  const runaans = byApiName.get("TFT_Item_RunaansHurricane");

  assert.equal(deathblade.category, "removed_or_legacy");
  assert.equal(deathblade.current, false);
  assert.equal(deathblade.obtainable, false);
  assert.equal(deathblade.availabilitySource, "caller_removed_items");
  assert.equal(runaans.category, "ordinary_completed");
  assert.equal(runaans.current, true);
  assert.equal(runaans.obtainable, true);
  assert.equal(runaans.availabilitySource, null);
});

test("uses generated item catalog to filter captured Xayah builds", () => {
  const catalog = createCatalog({
    items: buildItemCatalogFromItemsResponse(readProbeJson("meta_items_expanded.json"))
  });
  const result = recommendFromRows("2星霞，3观星，携带哪三件普通装备最好？", readProbeJson("meta_builds_xayah_expanded.json"), {
    catalog,
    preferences: {
      minSamples: 100
    }
  });

  assert.ok(result.rankedBuilds.length > 0);
  for (const build of result.rankedBuilds.slice(0, 10)) {
    for (const apiName of build.items) {
      const item = catalog.itemByApiName.get(apiName);
      assert.equal(item?.category, "ordinary_completed", apiName);
      assert.equal(item?.current, true, apiName);
      assert.equal(item?.obtainable, true, apiName);
    }
  }
});

test("MetaTFT clients default to the API host, not the website host", () => {
  assert.equal(new MetaTFTClient().baseUrl, "https://api-hc.metatft.com");
  assert.equal(new CompsContextClient().baseUrl, "https://api-hc.metatft.com");
  assert.equal(new CompsContextClient().timeoutMs, 2200);
  assert.equal(new CompsContextClient().rankingsTimeoutMs, 8000);
  assert.equal(new MetaTFTClient().maxRetries, 1);
  assert.equal(new CompsContextClient().maxRetries, 1);
});

test("MetaTFT clients retry one transient server failure and preserve attempt counts", async () => {
  let calls = 0;
  const delays = [];
  const client = new MetaTFTClient({
    maxRetries: 1,
    retryDelayMs: 25,
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? fakeJsonResponse({}, { status: 503, statusText: "Unavailable" })
        : fakeJsonResponse({ data: [{ items: "TFT_Item_Deathblade" }] });
    }
  });

  const response = await client.getItems({ patch: "current" });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [25]);
  assert.equal(response.data[0].items, "TFT_Item_Deathblade");
});

test("MetaTFT request timeouts abort once and remain non-retryable", async () => {
  let calls = 0;
  const client = new MetaTFTClient({
    timeoutMs: 5,
    maxRetries: 1,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  });
  const plan = planQuery("2星霞3观星三件普通装备").plan;

  await assert.rejects(
    () => client.getUnitBuilds(plan),
    (error) => {
      assert.match(error.message, /timed out after 5ms/);
      assert.equal(error.attempts, 1);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("MetaTFT retries respect capped Retry-After delays", async () => {
  let calls = 0;
  const delays = [];
  const client = new CompsContextClient({
    maxRetries: 1,
    retryDelayMs: 5,
    maxRetryDelayMs: 20,
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? fakeJsonResponse({}, { status: 429, headers: { "retry-after": "2" } })
        : fakeJsonResponse({ results: [] });
    }
  });

  await client.getCompOptions({ patch: "current" });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [20]);
});

test("MetaTFT clients do not retry request errors or invalid JSON", async () => {
  let requestErrorCalls = 0;
  const requestErrorClient = new MetaTFTClient({
    maxRetries: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requestErrorCalls += 1;
      return fakeJsonResponse({}, { status: 400, statusText: "Bad Request" });
    }
  });
  await assert.rejects(requestErrorClient.getItems(), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.retryable, false);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(requestErrorCalls, 1);

  let invalidJsonCalls = 0;
  const invalidJsonClient = new MetaTFTClient({
    maxRetries: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      invalidJsonCalls += 1;
      return fakeJsonResponse(null, { jsonError: new SyntaxError("bad json") });
    }
  });
  await assert.rejects(invalidJsonClient.getItems(), (error) => {
    assert.match(error.message, /invalid JSON/);
    assert.equal(error.retryable, false);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(invalidJsonCalls, 1);
});
