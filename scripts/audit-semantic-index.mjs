import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  SQLiteSemanticDocumentStore,
  auditSemanticIndex,
  resolveEmbeddingProviderConfig
} from "../src/index.js";

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

loadLocalEnvironment();
const config = resolveEmbeddingProviderConfig({}, process.env);
const filePath = resolve(String(argument("db") ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? ".cache/semantic-index.sqlite"));
const expectedModel = argument("model") ?? (config.enabled ? config.model : null);
const store = await SQLiteSemanticDocumentStore.open({ filePath });
try {
  const report = await auditSemanticIndex(store, { embeddingModel: expectedModel });
  process.stdout.write(`${JSON.stringify({ ...report, filePath }, null, 2)}\n`);
  if (!report.healthy) process.exitCode = 1;
} finally {
  store.close();
}
