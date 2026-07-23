import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildOfficialItemLocalizationCatalog,
  CURRENT_ITEM_LOCALIZATION_SOURCE,
  DEFAULT_QUERY_OPTIONS,
  MetaTFTClient,
  normalizeItemRows
} from "../src/index.js";

function parseArgs(argv) {
  const options = {
    remote: false,
    cn: null,
    en: null,
    items: resolve(".probe", "meta_items_expanded.json"),
    output: resolve("src", "data", "generated", "item-localization.zh-CN.json"),
    tftPatch: CURRENT_ITEM_LOCALIZATION_SOURCE.tftPatch,
    check: false,
    strictLocalization: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--remote") options.remote = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--strict-localization") options.strictLocalization = true;
    else if (["--cn", "--en", "--items", "--output", "--tft-patch"].includes(arg) && next) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = key === "tftPatch" ? next : resolve(next);
      index += 1;
    } else if (arg.startsWith("--cn=")) options.cn = resolve(arg.slice(5));
    else if (arg.startsWith("--en=")) options.en = resolve(arg.slice(5));
    else if (arg.startsWith("--items=")) options.items = resolve(arg.slice(8));
    else if (arg.startsWith("--output=")) options.output = resolve(arg.slice(9));
    else if (arg.startsWith("--tft-patch=")) options.tftPatch = arg.slice(12);
  }

  return options;
}

async function readLocalSource(filePath) {
  const buffer = await readFile(filePath);
  return {
    buffer,
    json: JSON.parse(buffer.toString("utf8")),
    location: filePath
  };
}

async function readRemoteSource(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "TFTAgent item-localization-refresh/1" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    json: JSON.parse(buffer.toString("utf8")),
    location: url
  };
}

async function readRemoteMetaTFTItems() {
  const client = new MetaTFTClient({ timeoutMs: 30000 });
  const json = await client.getItems({
    formatnoarray: "true",
    compact: "true",
    queue: DEFAULT_QUERY_OPTIONS.queue,
    patch: DEFAULT_QUERY_OPTIONS.patch,
    days: DEFAULT_QUERY_OPTIONS.days,
    rank: DEFAULT_QUERY_OPTIONS.rankFilter.join(",")
  });
  return {
    buffer: Buffer.from(JSON.stringify(json)),
    json,
    location: `${client.baseUrl}/tft-explorer-api/items?patch=current`
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function comparableSnapshot(snapshot) {
  const comparable = structuredClone(snapshot);
  delete comparable.metadata?.generatedAt;
  return comparable;
}

async function assertSnapshotIsCurrent(outputPath, snapshot) {
  let committed;
  try {
    committed = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Localization snapshot is missing: ${outputPath}`);
    }
    throw error;
  }

  const expected = JSON.stringify(comparableSnapshot(snapshot));
  const actual = JSON.stringify(comparableSnapshot(committed));
  if (actual !== expected) {
    throw new Error(
      `Localization snapshot drift detected: ${outputPath}. Run refresh:item-localization and review the diff.`
    );
  }
}

function validatePatchIdentity(cnResponse, enResponse, options) {
  const errors = [];
  const source = CURRENT_ITEM_LOCALIZATION_SOURCE;
  if (String(cnResponse?.version) !== source.sourcePatch) {
    errors.push(`Tencent source version ${cnResponse?.version} does not match configured ${source.sourcePatch}`);
  }
  if (String(cnResponse?.season) !== source.sourceSeason) {
    errors.push(`Tencent source season ${cnResponse?.season} does not match configured ${source.sourceSeason}`);
  }
  if (String(enResponse?.version) !== source.enVersion) {
    errors.push(`Riot Data Dragon version ${enResponse?.version} does not match configured ${source.enVersion}`);
  }
  if (String(options.tftPatch) !== source.tftPatch) {
    errors.push(`Requested TFT patch ${options.tftPatch} does not match configured ${source.tftPatch}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
}

const options = parseArgs(process.argv.slice(2));
if (!options.remote && (!options.cn || !options.en)) {
  throw new Error("Offline refresh requires --cn <fixture> and --en <fixture>; use --remote for optional live fetching.");
}

const [cnSource, enSource, itemsSource] = await Promise.all([
  options.remote
    ? readRemoteSource(CURRENT_ITEM_LOCALIZATION_SOURCE.cnUrl)
    : readLocalSource(options.cn),
  options.remote
    ? readRemoteSource(CURRENT_ITEM_LOCALIZATION_SOURCE.enUrl)
    : readLocalSource(options.en),
  options.remote ? readRemoteMetaTFTItems() : readLocalSource(options.items)
]);
// Offline inputs are deliberately used by deterministic fixture tests and
// historical audits. Only a live refresh may claim to be the configured
// current official patch, so only it is subject to the current-patch gate.
if (options.remote) {
  validatePatchIdentity(cnSource.json, enSource.json, options);
}

const scopeApiNames = normalizeItemRows(itemsSource.json)
  .map((row) => row.items ?? row.itemName ?? row.item ?? row.apiName ?? row.api_name)
  .filter(Boolean);
const records = buildOfficialItemLocalizationCatalog(cnSource.json, enSource.json, {
  scopeApiNames,
  tftPatch: options.tftPatch
});
const missing = records.filter((record) => record.needsReview);
const snapshot = {
  metadata: {
    locale: CURRENT_ITEM_LOCALIZATION_SOURCE.locale,
    tftPatch: options.tftPatch,
    sourcePatch: String(cnSource.json.version),
    sourceSeason: String(cnSource.json.season),
    sourceUpdatedAt: String(cnSource.json.time),
    generatedAt: new Date().toISOString(),
    cnSource: CURRENT_ITEM_LOCALIZATION_SOURCE.cnSource,
    cnUrl: CURRENT_ITEM_LOCALIZATION_SOURCE.cnUrl,
    cnSha256: sha256(cnSource.buffer),
    enSource: CURRENT_ITEM_LOCALIZATION_SOURCE.enSource,
    enVersion: String(enSource.json.version),
    enUrl: CURRENT_ITEM_LOCALIZATION_SOURCE.enUrl,
    enSha256: sha256(enSource.buffer),
    patchEvidence: CURRENT_ITEM_LOCALIZATION_SOURCE.patchEvidence,
    scope: "metatft_items_api_intersection",
    scopeSource: itemsSource.location,
    itemCount: records.length,
    localizedCount: records.length - missing.length,
    missingLocalizationCount: missing.length
  },
  items: records
};

if (options.check) {
  await assertSnapshotIsCurrent(options.output, snapshot);
} else {
  await writeFile(options.output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

console.log(
  `item localization refresh: patch=${snapshot.metadata.tftPatch}, source=${snapshot.metadata.sourcePatch}, `
  + `items=${records.length}, localized=${records.length - missing.length}, missing=${missing.length}`
);
console.log(`cn=${cnSource.location}`);
console.log(`en=${enSource.location}`);
console.log(`items=${itemsSource.location}`);
if (options.check) console.log(`check=up-to-date output=${options.output}`);
else console.log(`wrote=${options.output}`);
for (const record of missing) console.log(`PENDING ${record.apiName}: ${record.enName}`);
if (options.strictLocalization && missing.length) process.exitCode = 1;
