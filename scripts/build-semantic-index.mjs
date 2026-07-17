import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createCatalog } from "../src/data/static-data.js";
import {
  SQLiteSemanticDocumentStore,
  buildSemanticCorpus,
  buildSemanticIndex,
  createEmbeddingProviderFromConfig,
  resolveEmbeddingProviderConfig
} from "../src/index.js";

function argumentsFor(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[key] = argv[++index];
    else result[key] = true;
  }
  return result;
}

async function loadCorpusInput(filePath) {
  if (!filePath) return createCatalog();
  const parsed = JSON.parse(await readFile(resolve(filePath), "utf8"));
  return Array.isArray(parsed) ? { documents: parsed } : parsed;
}

loadLocalEnvironment();
const args = argumentsFor(process.argv.slice(2));
const filePath = resolve(String(args.db ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? ".cache/semantic-index.sqlite"));
const catalog = await loadCorpusInput(args.input);
const patch = String(args.patch ?? catalog.patch ?? process.env.TFT_AGENT_PATCH ?? "current");
const locale = String(args.locale ?? catalog.locale ?? process.env.TFT_AGENT_SEMANTIC_LOCALE ?? "zh-CN");
const config = resolveEmbeddingProviderConfig({}, process.env);
const provider = createEmbeddingProviderFromConfig(config);
const requireEmbeddings = args["allow-missing-embeddings"] !== true;
if (requireEmbeddings && !config.configured) {
  throw new Error("Configure TFT_AGENT_EMBEDDING_MODE=on, endpoint, model and API key before building the vector index");
}
const documents = buildSemanticCorpus(catalog, {
  patch,
  locale,
  includeHistorical: args["include-historical"] === true
});
const store = await SQLiteSemanticDocumentStore.open({ filePath });
try {
  const report = await buildSemanticIndex({
    store,
    provider,
    documents,
    batchSize: config.batchSize,
    prune: args["no-prune"] !== true,
    requireEmbeddings,
    onProgress: args.verbose ? (event) => process.stderr.write(`${JSON.stringify(event)}\n`) : null
  });
  process.stdout.write(`${JSON.stringify({ ...report, filePath, patch, locale }, null, 2)}\n`);
} finally {
  store.close();
}
