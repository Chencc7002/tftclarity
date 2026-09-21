import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCompletionV3Preflight } from "../src/experiments/unit-play-guidance-completion-v3/preflight.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const [config, corpus, observations, sourcePreflight] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-completion-v3/config.v3.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/preflight-result.v2.json")
]);
const result = runCompletionV3Preflight({ config, corpus, observations, sourcePreflight });
const output = path.join(root, "eval/skills/unit-play-guidance-completion-v3/preflight-result.v3.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: result.status, gates: result.gates,
  plannedAgentRuns: result.plan.plannedAgentRuns, actualProviderModelCalls: 0, output }, null, 2));
if (result.status !== "passed") process.exitCode = 1;
