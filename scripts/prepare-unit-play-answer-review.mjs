import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createUnitPlayAnswerReviewPacket } from "../src/experiments/unit-play-guidance-browser/answer-review.js";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const runDirectory = option("run");
const outputDirectory = option("output");
if (!runDirectory || !outputDirectory) throw new Error("Provide --run=<saved diagnostic directory> --output=<new review directory>");
const run = path.resolve(runDirectory), output = path.resolve(outputDirectory);
// Refuse overwriting raw records or an earlier review. No provider calls occur.
if (output === run || output.startsWith(`${run}${path.sep}`)) throw new Error("Review output must be outside the source run");
const rubricPath = path.resolve("eval/skills/unit-play-guidance-answer-review/rubric.v1.json");
const [names, manifestText, rubricText, observationsText] = await Promise.all([
  fs.readdir(run), fs.readFile(path.join(run, "manifest.json"), "utf8"), fs.readFile(rubricPath, "utf8"),
  fs.readFile(path.join(run, "observations.jsonl"), "utf8")
]);
const observations = observationsText.split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const files = names.filter((name) => /^response-\d+\.ndjson$/u.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!files.length) throw new Error("No saved diagnostic responses");
const packets = await Promise.all(files.map(async (name) => {
  const id = Number(name.match(/\d+/u)[0]);
  const receipts = observations.filter((event) => event.kind === "response" && event.id === id);
  if (receipts.length !== 1) throw new Error(`Expected one original response receipt for ${name}`);
  const responseText = await fs.readFile(path.join(run, name), "utf8");
  return { name: name.replace(".ndjson", ".review.json"), packet: createUnitPlayAnswerReviewPacket({
    responseText, manifestText, rubricText, recordedAt: receipts[0].at
  }) };
}));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // EEXIST deliberately stops rather than overwriting labels.
for (const { name, packet } of packets) await fs.writeFile(path.join(output, name), JSON.stringify(packet, null, 2) + "\n", { flag: "wx" });
const index = { schemaVersion: "unit-play-answer-review-index.v1", mode: "diagnostic_review_only",
  sourceDirectory: run, rubricPath, observationsSha256: createHash("sha256").update(observationsText).digest("hex"),
  formalPairedAcceptance: "not_evaluated", providerCalls: 0,
  packets: packets.map(({ name, packet }) => ({ file: name, sourceHashes: packet.sourceHashes,
    status: packet.delivered.status, review: packet.answerReview.status, structuralIssues: packet.runtimeObservations.structuralIssues })) };
await fs.writeFile(path.join(output, "index.json"), JSON.stringify(index, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, providerCalls: 0, packets: index.packets.length, formalPairedAcceptance: "not_evaluated" }));
