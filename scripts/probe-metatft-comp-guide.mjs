import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { captureMetaTftCompGuideProbe } from "../src/probes/metatft-comp-guide/capture.js";
import {
  normalizeCompGuideProbePair,
  probePairSummary
} from "../src/probes/metatft-comp-guide/normalizer.js";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeImmutable(path, value, overwrite) {
  if (!overwrite && await exists(path)) {
    const failure = new Error(`Refusing to overwrite immutable probe fixture: ${path}`);
    failure.code = "PROBE_FIXTURE_EXISTS";
    throw failure;
  }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const outputDirectory = resolve(argument("output-dir", "test/fixtures/metatft-comp-guide"));
const sourceCompId = argument("comp-id", "409000");
const previousPatch = argument("previous-patch", null);
const overwrite = process.argv.includes("--overwrite");
const timeoutMs = Number(argument("timeout-ms", "30000"));
const assetManifestPath = resolve("src/data/generated/asset-manifest.json");
const assetManifest = JSON.parse(await readFile(assetManifestPath, "utf8"));
const capture = await captureMetaTftCompGuideProbe({
  sourceCompId,
  previousPatch,
  timeoutMs
});
const normalized = normalizeCompGuideProbePair(capture.fixtures, assetManifest);

await mkdir(resolve(outputDirectory, "raw"), { recursive: true });
await mkdir(resolve(outputDirectory, "normalized"), { recursive: true });
for (const fixture of capture.fixtures) {
  const filename = `metatft-${fixture.identity.sourceCompId}-${fixture.patch.label}.raw.json`;
  await writeImmutable(resolve(outputDirectory, "raw", filename), fixture, overwrite);
}
for (const fixture of normalized) {
  const filename = `metatft-${fixture.identity.sourceAliases.sourceCompId}-${fixture.statistics.patch}.normalized.json`;
  await writeImmutable(resolve(outputDirectory, "normalized", filename), fixture, overwrite);
}

process.stdout.write(`${JSON.stringify({
  status: "captured",
  outputDirectory,
  diagnostics: capture.diagnostics,
  normalized: probePairSummary(normalized)
}, null, 2)}\n`);
