// Isolated visual/interaction QA: real routers + real panel, in-memory DB,
// deterministic fake upstream. Never reads or writes the user's player DB.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { openDatabase, initSchema, createPool, ingestExternalPlayerMatches } from "../services/opgg/collector.mjs";
import { createOpggApiRouter } from "../services/opgg/api-router.mjs";
import { createPlayerPoolApiRouter } from "../services/player-pools/api-router.mjs";

const database = await openDatabase(":memory:");
initSchema(database);
// Optional sanitized capture: { set, units: [{id, rarity}], activeTraits, inactiveTraits }.
// The summary intentionally omits cost/counts; opening its match exercises enrichment.
const capturePath = process.argv.find((arg) => arg.startsWith("--match-fixture="))?.slice("--match-fixture=".length);
const capture = capturePath ? JSON.parse(await readFile(resolve(capturePath), "utf8")) : null;
const player = { id: "fixture-na", displayName: "QA Player", gameName: "QA Player", tagLine: "NA1", region: "na", active: true };
const units = (capture?.units.map((unit) => unit.id) ?? ["TFT17_Karma", "TFT17_Ahri", "TFT17_Poppy", "TFT17_Jinx", "TFT17_Lulu", "TFT17_Ezreal", "TFT17_Shen", "TFT17_Leona"])
  .map((characterId, i) => ({ characterId, starLevel: i < 6 ? 2 : 1,
    items: i === 0 ? ["TFT_Item_SpearOfShojin", "TFT_Item_RabadonsDeathcap", "TFT_Item_JeweledGauntlet"] : [] }));
const sample = (id, date, patch) => ({ matchId: id, playedAt: date, patch: capture ? "18.1" : patch, set: capture?.set ?? "TFTSet17", placement: 2, level: 8,
  lastRound: 35, queue: { id: 1100 }, units,
  traits: capture ? capture.activeTraits.map((trait) => ({ id: trait.id })) : [{ id: "TFT17_Stargazer", units: 4, style: 2, tierCurrent: 2 }] });
for (const pool of [
  { id: "default-na-pro", name: "NA 职业选手默认池", region: "na" },
  { id: "qa-owned", name: "我的测试 Pool", region: "na", environment: "live", season: "set17-live", ownerType: "user", ownerId: "qa" }
]) {
  createPool(database, pool);
  ingestExternalPlayerMatches(database, player, [sample("NA1_FIXTURE_OLD", "2026-07-28T12:00:00.000Z", "16.14")], { poolId: pool.id });
}
const router = createOpggApiRouter({ database, playerMatchClient: {
  async callTool(name, input) {
    if (capture && name === "get_match" && process.argv.includes("--detail-unavailable")) throw new Error("QA detail unavailable");
    if (capture && name === "get_match") return { match: {
      ...sample(input.matchId, "2026-08-30T04:00:00.000Z", "18.1"),
      units: units.map((unit, index) => ({ ...unit, rarity: capture.units[index].rarity })),
      traits: [...capture.activeTraits, ...capture.inactiveTraits].map((trait) => ({ ...trait, units: trait.numUnits }))
    } };
    if (name !== "list_matches" || input.forceRefresh !== true) throw new Error("Expected explicit refresh");
    return { matches: [sample("NA1_FIXTURE_NEW", "2026-08-30T04:00:00.000Z", "17.10")],
      provenance: { cacheStatus: "miss", refreshStatus: "completed", sourceFetchedAt: new Date().toISOString() } };
  }
} });
const poolRouter = createPlayerPoolApiRouter({ database, matchClient: {} });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pool 修复验收 · 隔离样本</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/opgg-panel.css">
<style>body{background:#f8f7f2}.qa-shell{height:100dvh;max-width:1120px;margin:auto;display:flex;flex-direction:column}.result-pane{flex:1;min-height:0}.qa-nav{padding:8px;display:flex;gap:12px;align-items:center}.result-header{display:flex;justify-content:space-between;align-items:center;padding:12px}</style>
<main class="qa-shell"><nav class="qa-nav"><b>隔离测试样本 · 不访问真实账号</b><button id="qa-trends">阵容趋势</button><button id="qa-personal">Pool 管理</button></nav>
<section class="result-pane"><header class="result-header"><h1 id="result-title">Pool</h1><button id="result-refresh-button"><span>⟳</span><span data-i18n="refresh">刷新</span></button></header>
<div class="result-scroll" id="result-content"></div><pre id="raw-output" hidden></pre></section></main>
<script type="module">import {renderOpggTrends,renderOpggPersonal} from '/opgg-panel.js';document.querySelector('#qa-trends').onclick=renderOpggTrends;document.querySelector('#qa-personal').onclick=renderOpggPersonal;renderOpggTrends();</script></html>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/opgg/")) return await router(req, res, url, { scope: "qa" });
    if (url.pathname.startsWith("/api/player-pools")) return await poolRouter(req, res, url, { scope: "qa" });
    if (url.pathname === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(html); }
    const allowed = ["/styles.css", "/opgg-panel.css", "/opgg-panel.js"];
    if (!allowed.includes(url.pathname)) { res.writeHead(404); return res.end(); }
    res.setHeader("content-type", extname(url.pathname) === ".css" ? "text/css" : "text/javascript");
    res.end(await readFile(resolve("src/app/small-window-ui", url.pathname.slice(1))));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
});
const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 17339);
server.listen(port, "127.0.0.1", () => console.log(`Pool QA http://127.0.0.1:${port}`));
process.on("SIGINT", () => server.close(() => { database.close(); process.exit(0); }));
