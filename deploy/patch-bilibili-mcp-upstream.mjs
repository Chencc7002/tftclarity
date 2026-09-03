import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ENDPOINT_REPLACEMENTS = Object.freeze([
  Object.freeze({
    from: "videoUrl = `${API_WEB}/view?bvid=${videoId}`;",
    to: "videoUrl = `${API_WEB}/wbi/view?bvid=${videoId}`;"
  }),
  Object.freeze({
    from: "videoUrl = `${API_WEB}/view?aid=${aid}`;",
    to: "videoUrl = `${API_WEB}/wbi/view?aid=${aid}`;"
  })
]);

function replaceExactlyOnce(source, from, to) {
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one upstream occurrence of ${JSON.stringify(from)}, found ${occurrences}`);
  }
  return source.replace(from, to);
}

export function patchBilibiliMcpSource(source) {
  return ENDPOINT_REPLACEMENTS.reduce(
    (current, replacement) => replaceExactlyOnce(current, replacement.from, replacement.to),
    source
  );
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error("Usage: node patch-bilibili-mcp-upstream.mjs <upstream-src/index.ts>");
  const source = await readFile(sourcePath, "utf8");
  await writeFile(sourcePath, patchBilibiliMcpSource(source), "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
