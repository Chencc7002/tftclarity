import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { SQLiteSemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { createEmbeddingProviderFromConfig, resolveEmbeddingProviderConfig } from "../src/llm/embedding-provider.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";
import { buildUserStrategySemanticDocuments } from "../src/knowledge/user-strategy-knowledge.js";
import { publishStaticKnowledge, inspectStaticKnowledge } from "../src/knowledge/static-knowledge-release.js";

loadLocalEnvironment();
const args = {};
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--(season|locale|db|model|dimensions|batch-size|timeout-ms|mode)=(.+)$/);
  if (!match || Object.hasOwn(args, match[1])) throw new Error(`Invalid/duplicate argument: ${arg}`);
  args[match[1]] = match[2];
}
if (!args.season || !["audit", "shadow", "publish"].includes(args.mode)) {
  throw new Error("Required: --season=set18-live --mode=audit|shadow|publish (default is never a write)");
}
const config = resolveEmbeddingProviderConfig({}, process.env);
if (args.model && config.model !== args.model) throw new Error("Configured embedding model does not match the release model");
const dimensions = Number(args.dimensions ?? config.dimensions ?? 1024);
const batchSize = Number(args["batch-size"] ?? 4);
const timeoutMs = Number(args["timeout-ms"] ?? 120000);
if (![dimensions, batchSize, timeoutMs].every((n) => Number.isInteger(n) && n > 0)) throw new Error("Invalid positive integer option");
const locale = args.locale ?? "zh-CN";
const documents = [...buildOfficialPatchSemanticDocuments({ seasonContextId: args.season, locale }),
  ...buildUserStrategySemanticDocuments({ seasonContextId: args.season, locale })];
const store = await SQLiteSemanticDocumentStore.open({ filePath: resolve(args.db ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? ".cache/semantic-index.sqlite") });
try {
  const scope = { seasonContextId: args.season, locale, model: config.model, dimensions, documents };
  if (args.mode === "audit") {
    const health = await inspectStaticKnowledge(store, scope);
    console.log(JSON.stringify(health, null, 2));
    if (!health.healthy) process.exitCode = 1;
  } else {
    if (!config.configured) throw new Error("A configured embedding provider is required");
    const provider = createEmbeddingProviderFromConfig({ ...config, batchSize, timeoutMs });
    const report = await publishStaticKnowledge({ store, provider, documents, ...scope, dimensions, batchSize,
      shadow: args.mode === "shadow", onProgress: (event) => {
        if (event.phase === "embedding") process.stderr.write(`${JSON.stringify(event)}\n`);
      } });
    console.log(JSON.stringify(report, null, 2));
  }
} finally { store.close(); }
