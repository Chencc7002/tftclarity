import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSmallWindowRuntime, startSmallWindowServer } from "../src/app/small-window-server.js";
import { createCatalog } from "../src/data/static-data.js";
import { MemoryCacheStore } from "../src/data/cache-store.js";
import { SQLiteConversationBridgeStore } from "../src/conversation/sqlite-conversation-bridge-store.js";

// Local browser acceptance only. Model responses and catalog facts are fixtures;
// UI, HTTP transport, registered tools, confirmation and evidence checks are real.
const port = Number(process.argv.find(arg => arg.startsWith("--port="))?.slice(7) ?? 17461);
const out = resolve(".cache/entity-choice-browser");
mkdirSync(out, { recursive: true });
const log = (type, value) => appendFileSync(resolve(out, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), type, ...value }) + "\n");
const { catalog } = JSON.parse(readFileSync(new URL("../eval/entity-names/typos.json", import.meta.url), "utf8"));
const bridge = await SQLiteConversationBridgeStore.open({ filePath: ":memory:" });
const runtime = createSmallWindowRuntime({ env: {}, catalog: createCatalog(catalog), cacheStore: new MemoryCacheStore(),
  fetchItems: false, metaTFTClient: {}, compsClient: {}, reactChatMode: "on", entitySlangMode: "suggest",
  conversationBridgeStore: bridge,
  officialEntityDetails: { meta: { updatedAt: new Date().toISOString() },
    units: new Map(catalog.units.map(unit => [unit.apiName, { name: unit.zhName, cost: unit.cost ?? 1,
      ability: { name: "测试技能", description: "仅用于候选点击交互验收的技能说明。" } }])), traits: new Map() },
  onEntitySlangObservation: event => log("slang", event),
  entitySlangProvider: async request => ({ schemaVersion: "entity-slang-proposal.v1",
    resolutions: request.mentions.map(mention => ({ mention,
      candidateIds: mention === "法师姐姐" ? ["Test_Nami", "Test_Karma"] : ["Test_Karma"], reason: "ambiguous" })) }),
  reactDecisionProvider: async ({ state }) => {
    await new Promise(resolve => setTimeout(resolve, 250));
    log("decision", { question: state.question, evidenceCount: state.evidence.length });
    if (!state.evidence.length) {
      const name = ["法师姐姐", "扇子姐姐", "卡尔玛", "娜美"].find(name => state.question.includes(name)) ?? "扇子姐姐";
      return { schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query",
        arguments: { entityType: "unit", filters: { names: [name] } }, purposeCode: "retrieve_entity_details" };
    }
    const resolved = state.evidence.find(entry => entry.toolName === "entity_catalog_query")?.value?.resolution?.requests?.[0];
    if (!state.evidence.some(entry => entry.toolName === "unit_details")) return {
      schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_details",
      arguments: { apiName: resolved?.candidates?.[0]?.apiName ?? "Test_Karma" }, purposeCode: "retrieve_entity_details"
    };
    return { schemaVersion: "react-action.v1", type: "finish", answer: `${resolved?.candidates?.[0]?.name}的技能是测试技能，仅用于候选点击交互验收。`,
      evidenceIds: state.evidence.map(entry => entry.evidenceId), reasonCode: "sufficient_evidence" };
  }
});
const started = await startSmallWindowServer({ runtime, env: {}, host: "127.0.0.1", port, prewarmCatalog: false });
started.server.prependListener("request", (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/api/react-chat")) return;
  const parts = [], write = res.write, end = res.end;
  res.write = function(chunk, ...args) { if (chunk) parts.push(String(chunk)); return write.call(this, chunk, ...args); };
  res.end = function(chunk, ...args) { if (chunk && typeof chunk !== "function") parts.push(String(chunk)); return end.call(this, chunk, ...args); };
  res.on("finish", () => log("http", { statusCode: res.statusCode, response: parts.join("") }));
});
console.log(`Entity choice browser fixture: ${started.url}`);
process.on("SIGINT", () => started.server.close(() => { bridge.close(); process.exit(0); }));
