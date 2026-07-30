import { resolve } from "node:path";

import "dotenv/config";

import { startSmallWindowServer } from "../src/app/small-window-server.js";

const service = await startSmallWindowServer({
  host: process.env.CURRENT_STATS_E2E_HOST ?? "127.0.0.1",
  port: Number(process.env.CURRENT_STATS_E2E_PORT ?? 17331),
  prewarmCatalog: false,
  knowledgeMode: "on",
  embeddingMode: "on",
  coachMode: "off",
  semanticIndexPath: resolve(".cache/semantic-index.sqlite"),
  cacheStoreType: "json",
  cachePath: resolve(".cache/current-stats/http-e2e-cache.json"),
  agentRunBudget: {
    deadlineMs: 120_000,
    maxSteps: 100,
    maxToolCalls: 100,
    maxRetriesPerTool: 3,
    maxEvents: 1000
  },
  explorerTimeoutMs: 30_000,
  catalogTimeoutMs: 30_000,
  compsTimeoutMs: 30_000,
  compRankingsTimeoutMs: 30_000
});

process.stdout.write(`Current stats E2E server listening at ${service.url}\n`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    service.server.close(() => process.exit(0));
  });
}
