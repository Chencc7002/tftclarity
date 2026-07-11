import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const patch = option("--source-patch", "16.13.1");
const championPath = option("--champions", `.cache/tft-champion-${patch}.json`);
const traitPath = option("--traits", `.cache/tft-trait-${patch}.json`);
const itemPath = option("--items", `.cache/tft-item-${patch}.json`);
const outputPath = option("--output", "src/data/generated/asset-manifest.json");
const checkOnly = args.includes("--check");
const refreshSource = args.includes("--refresh-source");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadSource(path, fileName) {
  const absolutePath = resolve(path);
  if (!refreshSource && await exists(absolutePath)) {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  }
  const url = `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset source request failed: ${response.status} ${url}`);
  const value = await response.json();
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

const [champions, traits, items] = await Promise.all([
  loadSource(championPath, "tft-champion.json"),
  loadSource(traitPath, "tft-trait.json"),
  loadSource(itemPath, "tft-item.json")
]);

for (const [label, value] of [["champion", champions], ["trait", traits], ["item", items]]) {
  if (value?.version && value.version !== patch) {
    throw new Error(`${label} source patch mismatch: expected ${patch}, got ${value.version}`);
  }
}

function records(data, entityType, predicate) {
  return Object.values(data?.data ?? {}).filter(predicate).map((entry) => ({
    entityType,
    apiName: entry.id,
    ...(entityType === "trait" ? { filterId: entry.id } : {}),
    iconUrl: `https://ddragon.leagueoflegends.com/cdn/${patch}/img/${entry.image.group}/${encodeURIComponent(entry.image.full)}`,
    source: "Riot Data Dragon",
    sourcePatch: patch,
    fallback: false
  }));
}

const assets = [
  ...records(champions, "unit", (entry) => /^TFT17_/.test(entry.id)),
  ...records(traits, "trait", (entry) => /^TFT17_/.test(entry.id)),
  ...records(items, "item", (entry) => /^(?:TFT17_|TFT_Item_|TFT5_Item_)/.test(entry.id))
].sort((a, b) => a.entityType.localeCompare(b.entityType) || a.apiName.localeCompare(b.apiName));

const manifest = {
  version: 1,
  source: "Riot Data Dragon",
  sourcePatch: patch,
  generatedAt: new Date().toISOString(),
  assets
};
if (assets.length < 500) throw new Error(`asset manifest is unexpectedly small: ${assets.length}`);

const absoluteOutputPath = resolve(outputPath);
if (checkOnly) {
  const current = JSON.parse(await readFile(absoluteOutputPath, "utf8"));
  const comparable = (value) => JSON.stringify({
    version: value.version,
    source: value.source,
    sourcePatch: value.sourcePatch,
    assets: value.assets
  });
  if (comparable(current) !== comparable(manifest)) {
    throw new Error(`asset manifest drift detected: ${outputPath}`);
  }
  console.log(`asset manifest check passed: patch=${patch}, assets=${assets.length}, output=${outputPath}`);
} else {
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`asset manifest: patch=${patch}, assets=${assets.length}, output=${outputPath}`);
}
