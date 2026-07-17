import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createCatalog } from "../src/data/static-data.js";
import {
  SQLiteSemanticDocumentStore,
  buildSemanticCorpus,
  buildSemanticIndex,
  createEmbeddingProviderFromConfig,
  loadCompleteSemanticCatalog,
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

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadCorpusInput(filePath, options = {}) {
  if (!filePath) {
    const catalogCachePath = resolve(String(
      options.catalogCachePath
      ?? process.env.TFT_AGENT_CATALOG_CACHE_PATH
      ?? process.env.TFT_AGENT_CACHE_PATH
      ?? ".cache/small-window-cache.json"
    ));
    if (await exists(catalogCachePath)) {
      const defaultCompsPath = resolve(String(
        options.compsInputPath
        ?? process.env.TFT_AGENT_SEMANTIC_COMPS_INPUT
        ?? ".cache/comps-data-current-inspect.json"
      ));
      return loadCompleteSemanticCatalog({
        catalogCachePath,
        compsInputPath: await exists(defaultCompsPath) ? defaultCompsPath : null,
        patch: options.patch,
        locale: options.locale
      });
    }
    if (options.allowSeedCatalog) return createCatalog({ patch: options.patch });
    throw new Error(
      `Complete runtime catalog cache not found at ${catalogCachePath}; `
      + "start the app to refresh its catalog, pass --catalog-cache/--input, "
      + "or explicitly use --allow-seed-catalog for tests"
    );
  }
  const parsed = JSON.parse(await readFile(resolve(filePath), "utf8"));
  return Array.isArray(parsed) ? { documents: parsed } : parsed;
}

loadLocalEnvironment();
const args = argumentsFor(process.argv.slice(2));
const filePath = resolve(String(args.db ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? ".cache/semantic-index.sqlite"));
const requestedPatch = String(args.patch ?? process.env.TFT_AGENT_PATCH ?? "current");
const requestedLocale = String(args.locale ?? process.env.TFT_AGENT_SEMANTIC_LOCALE ?? "zh-CN");
const catalog = await loadCorpusInput(args.input, {
  catalogCachePath: args["catalog-cache"],
  compsInputPath: args["comps-input"],
  patch: requestedPatch,
  locale: requestedLocale,
  allowSeedCatalog: args["allow-seed-catalog"] === true
});
const patch = String(args.patch ?? catalog.patch ?? requestedPatch);
const locale = String(args.locale ?? catalog.locale ?? requestedLocale);
const config = resolveEmbeddingProviderConfig({}, process.env);
const skipEmbeddings = args["no-embeddings"] === true;
const provider = skipEmbeddings ? null : createEmbeddingProviderFromConfig(config);
const requireEmbeddings = !skipEmbeddings && args["allow-missing-embeddings"] !== true;
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
  const countsByType = Object.fromEntries(documents.reduce((counts, document) => {
    counts.set(document.documentType, (counts.get(document.documentType) ?? 0) + 1);
    return counts;
  }, new Map()));
  process.stdout.write(`${JSON.stringify({
    ...report,
    filePath,
    patch,
    locale,
    catalogSource: catalog.semanticCatalogSource ?? (args.input ? "explicit_input" : "seed_catalog"),
    countsByType
  }, null, 2)}\n`);
} finally {
  store.close();
}
