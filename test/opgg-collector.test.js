import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  initSchema,
  collectPlayer,
  decryptStoredPuuid,
  encryptPuuid,
  getPlayerPlayStyle,
  isEncryptedPuuid,
  createPool,
  registerPlayer,
  removePlayerFromPool,
  seedDefaultPool,
  getPoolPlayers,
  getPoolStats,
  listPlayerMatches,
  listPools,
  pruneUnlistedPlayers
} from "../services/opgg/collector.mjs";

const PUUID_A = "a".repeat(78);
const PUUID_B = "b".repeat(78);
const OTHER_PUUID = "z".repeat(78);

function makeMatch({
  matchId,
  datetime = 1_752_000_000_000,
  placement = 4,
  level = 8,
  traits = [{ name: "TFT17_Astronaut", numUnits: 4, style: 3 }],
  units = [
    {
      characterId: "TFT17_Karma",
      name: "Karma",
      rarity: 4,
      tier: 2,
      itemNames: ["B.F. Sword", "Tear of the Goddess"]
    }
  ]
}) {
  return {
    metadata: {
      matchId,
      participants: [
        {
          puuid: OTHER_PUUID,
          gameName: "OtherPlayer",
          tagLine: "NA1",
          summonerLevel: 300
        }
      ]
    },
    info: {
      matchId,
      gameId: Number(matchId.replace(/\D/g, "") || 1),
      gameDatetime: datetime,
      queueId: 1100,
      tftSetNumber: 17,
      gameVersion: "15.16.1"
    },
    summary: {
      placement,
      level,
      goldLeft: 1,
      lastRound: 30,
      playersEliminated: 2,
      augments: null,
      companion: { contentId: "c1" },
      traits,
      units
    }
  };
}

function makeFakeClient(puuidByGameName, matchesByPuuid) {
  return {
    async callTool(name, args) {
      if (name === "lol_get_summoner_profile") {
        const puuid = puuidByGameName[args.game_name] ?? PUUID_A;
        return {
          result: {
            content: [
              {
                type: "text",
                text:
                  `LolGetSummonerProfile(Data(Summoner("${puuid}",` +
                  `"${args.game_name}","${args.tag_line}")))`
              }
            ]
          }
        };
      }

      if (name === "tft_get_play_style") {
        const matches = matchesByPuuid[args.puuid] ?? [];
        const comments = args.__comments ?? [];
        return {
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  items: { data: matches },
                  play_style_comments: comments,
                  action: []
                })
              }
            ]
          }
        };
      }

      throw new Error(`Unexpected tool: ${name}`);
    }
  };
}

function fakeWithComments(puuidByGameName, matchesByPuuid, commentsByPuuid) {
  const client = makeFakeClient(puuidByGameName, matchesByPuuid);
  const originalCall = client.callTool.bind(client);
  client.callTool = async (name, args) => {
    if (name === "tft_get_play_style") {
      return originalCall(name, { ...args, __comments: commentsByPuuid[args.puuid] ?? [] });
    }
    return originalCall(name, args);
  };
  return client;
}

function countRows(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function entry(id, gameName = id) {
  return {
    id,
    displayName: gameName,
    gameName,
    tagLine: "NA1",
    region: "na",
    active: true
  };
}

test("dedupes by (player_id, match_id) across consecutive polls", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const matches = [
    makeMatch({ matchId: "NA1_1" }),
    makeMatch({ matchId: "NA1_2" }),
    makeMatch({ matchId: "NA1_3" })
  ];
  const client = makeFakeClient({ p1: PUUID_A }, { [PUUID_A]: matches });

  const first = await collectPlayer(client, database, entry("p1"));
  assert.equal(first.status, "ok");
  assert.equal(first.returnedCount, 3);
  assert.equal(first.newMatchCount, 3);
  assert.equal(countRows(database, "player_match_fact"), 3);
  assert.equal(countRows(database, "match_record"), 3);
  assert.equal(countRows(database, "collection_run"), 1);

  const second = await collectPlayer(client, database, entry("p1"));
  assert.equal(second.returnedCount, 3);
  assert.equal(second.newMatchCount, 0);
  assert.equal(second.possibleGap, 0);
  assert.equal(countRows(database, "player_match_fact"), 3);
  assert.equal(countRows(database, "match_record"), 3);
  assert.equal(countRows(database, "collection_run"), 2);

  database.close();
});

test("same match for two tracked players yields two facts and one match_record", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const sharedMatch = makeMatch({ matchId: "NA1_SHARED" });
  const client = makeFakeClient(
    { p1: PUUID_A, p2: PUUID_B },
    { [PUUID_A]: [sharedMatch], [PUUID_B]: [sharedMatch] }
  );

  const first = await collectPlayer(client, database, entry("p1"));
  const second = await collectPlayer(client, database, entry("p2"));
  assert.equal(first.newMatchCount, 1);
  assert.equal(second.newMatchCount, 1);
  assert.equal(countRows(database, "player_match_fact"), 2);
  assert.equal(countRows(database, "match_record"), 1);

  const stats = getPoolStats(database, { region: "na" });
  assert.equal(stats.playerMatchCount, 2);
  assert.equal(stats.uniqueMatchCount, 1);
  assert.equal(stats.playersWithData, 2);

  database.close();
});

test("persists no other-player identities and no puuid values", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const client = makeFakeClient(
    { p1: PUUID_A },
    { [PUUID_A]: [makeMatch({ matchId: "NA1_PRIV" })] }
  );

  await collectPlayer(client, database, entry("p1"));

  const facts = database
    .prepare(
      `SELECT traits_json, units_json, augments_json FROM player_match_fact`
    )
    .all();
  const factBlob = facts
    .map((row) => `${row.traits_json}${row.units_json}${row.augments_json ?? ""}`)
    .join("");

  assert.ok(!factBlob.includes(PUUID_A));
  assert.ok(!factBlob.includes(OTHER_PUUID));
  assert.ok(!factBlob.includes("OtherPlayer"));

  const records = database
    .prepare(`SELECT * FROM match_record`)
    .all();
  assert.ok(!JSON.stringify(records).includes("puuid"));

  const tracked = database
    .prepare(`SELECT puuid_encrypted FROM tracked_player WHERE id = 'p1'`)
    .get();
  assert.equal(tracked.puuid_encrypted, null);

  const listed = listPlayerMatches(database, "p1", { limit: 10 });
  assert.ok(!JSON.stringify(listed).includes(PUUID_A));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].traits[0].name, "TFT17_Astronaut");
  assert.equal(listed[0].units[0].itemNames.length, 2);

  database.close();
});

test("marks possible_gap when all returned matches are new after a long gap", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const oldMatches = [makeMatch({ matchId: "NA1_OLD" })];
  const newMatches = [makeMatch({ matchId: "NA1_NEW1" }), makeMatch({ matchId: "NA1_NEW2" })];
  const client = makeFakeClient({ p1: PUUID_A }, { [PUUID_A]: oldMatches });

  await collectPlayer(client, database, entry("p1"));

  // Simulate a long gap since the last successful poll (3 hours ago).
  database
    .prepare(
      `UPDATE tracked_player
       SET last_successful_poll_at = ?
       WHERE id = ?`
    )
    .run(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), "p1");

  const upstreamCallTool = client.callTool.bind(client);
  client.callTool = async (name, args) => {
    if (name === "tft_get_play_style") {
      return {
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: { data: newMatches },
                play_style_comments: [],
                action: []
              })
            }
          ]
        }
      };
    }
    return upstreamCallTool(name, args);
  };

  const result = await collectPlayer(client, database, entry("p1"));
  assert.equal(result.status, "ok");
  assert.equal(result.newMatchCount, 2);
  assert.equal(result.possibleGap, 1);

  database.close();
});

test("player failure is isolated and recorded in collection_run", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const client = makeFakeClient({ p1: PUUID_A }, { [PUUID_A]: [makeMatch({ matchId: "NA1_OK" })] });

  const broken = {
    ...client,
    callTool: async (name, args) => {
      if (name === "tft_get_play_style") {
        const error = new Error("upstream 400");
        error.mcpCode = -32600;
        throw error;
      }
      return client.callTool(name, args);
    }
  };

  const ok = await collectPlayer(client, database, entry("p1"));
  const failed = await collectPlayer(broken, database, entry("p2"));
  assert.equal(ok.status, "ok");
  assert.equal(failed.status, "error");
  assert.equal(failed.errorCode, "-32600");
  assert.equal(countRows(database, "player_match_fact"), 1);

  const run = database
    .prepare(`SELECT * FROM collection_run WHERE player_id = ? ORDER BY id DESC`)
    .get("p2");
  assert.equal(run.status, "error");
  assert.equal(run.error_code, "-32600");

  database.close();
});

test("empty response does not overwrite history", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const client = makeFakeClient(
    { p1: PUUID_A },
    { [PUUID_A]: [makeMatch({ matchId: "NA1_KEEP" })] }
  );

  await collectPlayer(client, database, entry("p1"));

  const upstreamCallTool = client.callTool.bind(client);
  client.callTool = async (name, args) => {
    if (name === "tft_get_play_style") {
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify({ items: { data: [] } }) }]
        }
      };
    }
    return upstreamCallTool(name, args);
  };

  const result = await collectPlayer(client, database, entry("p1"));
  assert.equal(result.status, "ok");
  assert.equal(result.returnedCount, 0);
  assert.equal(countRows(database, "player_match_fact"), 1);

  database.close();
});

test("play_style_comments templates are ignored as player evidence", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const comments = [
    { name: "Aggressive", description: "Prefers early pressure and tempo." },
    { name: "Flexible", description: "Switches comps based on lobby." }
  ];
  const client = fakeWithComments(
    { p1: PUUID_A },
    { [PUUID_A]: [makeMatch({ matchId: "NA1_STYLE" })] },
    { [PUUID_A]: comments }
  );

  await collectPlayer(client, database, entry("p1"));
  const stored = getPlayerPlayStyle(database, "p1");
  assert.equal(stored, null);

  database.close();
});

test("PUUID encryption round-trips without storing plaintext", () => {
  const env = { OPGG_PUUID_ENCRYPTION_KEY: "test-only-secret-with-enough-entropy" };
  const encrypted = encryptPuuid(PUUID_A, env);
  assert.equal(isEncryptedPuuid(encrypted), true);
  assert.ok(!encrypted.includes(PUUID_A));
  assert.equal(decryptStoredPuuid(encrypted, env), PUUID_A);
  assert.equal(decryptStoredPuuid(PUUID_A, env), null);
  assert.equal(encryptPuuid(PUUID_A, {}), null);
});

test("pruneUnlistedPlayers removes players not in any pool and orphan records", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "pool-a", name: "Pool A", region: "na" });
  const sharedMatch = makeMatch({ matchId: "NA1_SHARED2" });
  const client = makeFakeClient(
    { keep: PUUID_A, drop: PUUID_B },
    { [PUUID_A]: [sharedMatch], [PUUID_B]: [sharedMatch, makeMatch({ matchId: "NA1_ONLY_DROP" })] }
  );

  registerPlayer(database, entry("keep"), "pool-a");
  await collectPlayer(client, database, entry("keep"));
  await collectPlayer(client, database, entry("drop"));

  const removed = pruneUnlistedPlayers(database);
  assert.deepEqual(removed, ["drop"]);
  assert.equal(countRows(database, "tracked_player"), 1);
  assert.equal(countRows(database, "player_match_fact"), 1);
  assert.equal(countRows(database, "match_record"), 1);
  assert.equal(countRows(database, "collection_run"), 1);

  database.close();
});

test("pools scope stats and players can be added/removed per pool", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "pool-a", name: "Pool A", region: "na" });
  createPool(database, { id: "pool-b", name: "Pool B", region: "na" });
  const client = makeFakeClient(
    { p1: PUUID_A, p2: PUUID_B },
    {
      [PUUID_A]: [makeMatch({ matchId: "NA1_A" })],
      [PUUID_B]: [makeMatch({ matchId: "NA1_B" })]
    }
  );

  registerPlayer(database, entry("p1"), "pool-a");
  registerPlayer(database, entry("p2"), "pool-b");
  await collectPlayer(client, database, entry("p1"));
  await collectPlayer(client, database, entry("p2"));

  const statsA = getPoolStats(database, { poolId: "pool-a", region: "na" });
  assert.equal(statsA.exists, true);
  assert.equal(statsA.trackedPlayers, 1);
  assert.equal(statsA.playerMatchCount, 1);
  assert.equal(statsA.uniqueMatchCount, 1);
  assert.equal(statsA.playersWithData, 1);

  const poolPlayers = getPoolPlayers(database, "pool-a", { activeOnly: true });
  assert.equal(poolPlayers.length, 1);
  assert.equal(poolPlayers[0].gameName, "p1");
  assert.equal(poolPlayers[0].tagLine, "NA1");
  assert.equal(poolPlayers[0].displayName, "p1");

  const pools = listPools(database);
  assert.equal(pools.length, 2);
  assert.equal(pools.find((pool) => pool.id === "pool-a").memberCount, 1);

  removePlayerFromPool(database, "pool-a", "p1", new Date().toISOString());
  const p1row = database
    .prepare(`SELECT active FROM tracked_player WHERE id = ?`)
    .get("p1");
  assert.equal(p1row.active, 0);

  database.close();
});

test("seedDefaultPool seeds once from roster JSON then leaves DB as source of truth", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opgg-roster-test-"));
  const rosterPath = join(directory, "roster.json");
  writeFileSync(
    rosterPath,
    JSON.stringify({
      region: "na",
      players: [
        {
          id: "p1",
          displayName: "P1",
          gameName: "p1",
          tagLine: "NA1",
          region: "na",
          active: true
        },
        {
          id: "p2",
          displayName: "P2",
          gameName: "p2",
          tagLine: "NA2",
          region: "na",
          active: true
        }
      ]
    }),
    "utf8"
  );

  const database = await openDatabase(":memory:");
  initSchema(database);

  const first = seedDefaultPool(database, {
    rosterPath,
    poolId: "default-na-pro",
    poolName: "Default"
  });
  assert.equal(first.seeded, true);
  assert.equal(first.playersImported, 2);
  assert.equal(getPoolPlayers(database, "default-na-pro").length, 2);

  const second = seedDefaultPool(database, { rosterPath });
  assert.equal(second.seeded, false);

  rmSync(directory, { recursive: true, force: true });
  database.close();
});
