import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createEmbeddingProviderFromConfig,
  resolveEmbeddingProviderConfig
} from "../src/llm/embedding-provider.js";
import { validateKnowledgeDocument } from "../src/knowledge/knowledge-document-schema.js";
import { YouTubeKnowledgeIndexManager } from "../src/knowledge/youtube-index-manager.js";
import { SQLiteSemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";

function argumentsFor(argv) {
  const values = { passthrough: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      values.passthrough.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) values[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) values[key] = argv[++index];
    else values[key] = true;
  }
  return values;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function documentsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.documents)) return payload.documents;
  if (Array.isArray(payload?.knowledgeDocuments)) return payload.knowledgeDocuments;
  if (payload?.documentType) return [payload];
  return [];
}

async function payloadFor(args) {
  if (args.input) return JSON.parse(await readFile(resolve(String(args.input)), "utf8"));
  const url = args.url ?? args.passthrough[0];
  if (!url) {
    throw new Error("Pass --url <youtube-url> or --input <knowledge-document-json>");
  }
  const python = String(args.python ?? process.env.TFT_AGENT_PYTHON ?? "python");
  const cli = resolve("services/youtube-ingestion/cli.py");
  const pythonArgs = [cli, String(url)];
  for (const [flag, key] of [
    ["--season", "season"],
    ["--patch", "patch"],
    ["--region", "region"],
    ["--locale", "locale"],
    ["--expires-at", "expires-at"],
    ["--output", "output"],
    ["--fixture", "fixture"],
    ["--source-envelope", "source-envelope"],
    ["--timedtext-json3", "timedtext-json3"],
    ["--source-metadata", "source-metadata"],
    ["--env", "env"],
    ["--artifact-dir", "artifact-dir"],
    ["--chunk-seconds", "chunk-seconds"],
    ["--chunk-characters", "chunk-characters"]
  ]) {
    if (args[key]) pythonArgs.push(flag, String(args[key]));
  }
  if (args.force === true) pythonArgs.push("--force");
  if (args.reextract === true) pythonArgs.push("--reextract");
  const result = await run(python, pythonArgs);
  return JSON.parse(result.stdout);
}

loadLocalEnvironment();
const args = argumentsFor(process.argv.slice(2));
const payload = await payloadFor(args);
const documents = documentsFrom(payload);
if (!documents.length) {
  throw new Error("Ingestion output contains no KnowledgeDocument records");
}
const invalid = documents
  .map((document, index) => ({ index, validation: validateKnowledgeDocument(document) }))
  .filter((entry) => !entry.validation.valid);
if (invalid.length) {
  throw new Error(`KnowledgeDocument validation failed: ${invalid.map((entry) => (
    `[${entry.index}] ${entry.validation.errors.join("; ")}`
  )).join(" | ")}`);
}

const filePath = resolve(String(
  args.db
  ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH
  ?? ".cache/semantic-index.sqlite"
));
const embeddingConfig = resolveEmbeddingProviderConfig({}, process.env);
const embeddingProvider = args["no-embeddings"] === true
  ? null
  : createEmbeddingProviderFromConfig(embeddingConfig);
const store = await SQLiteSemanticDocumentStore.open({ filePath });
try {
  if (payload.schemaVersion !== "youtube_ingestion.v2") {
    throw new Error(
      "YouTube ingestion must be regenerated with youtube_ingestion.v2 before indexing"
    );
  }
  const indexer = new YouTubeKnowledgeIndexManager({
    store,
    embeddingProvider,
    seasonContextId: args.season ?? process.env.TFT_AGENT_SEASON_CONTEXT_ID ?? "set17-live"
  });
  const report = await indexer.indexEnvelope(payload);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    source: payload.source ?? null,
    database: filePath,
    ...report
  }, null, 2)}\n`);
} finally {
  store.close();
}
