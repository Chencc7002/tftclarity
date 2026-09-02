import fs from "node:fs/promises";
import path from "node:path";

import { createCompletionV6AdjudicationTemplate, finalizeCompletionV6IndependentReview,
  inspectCompletionV6IndependentReview } from "../src/experiments/unit-play-guidance-completion-v6/review.js";

const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const runOption = option("run");
const prepareAdjudication = process.argv.includes("--prepare-adjudication");
const finalize = process.argv.includes("--finalize");
if (!runOption) throw new Error("Provide --run=<completion v6 formal run directory>");
if (prepareAdjudication && finalize) throw new Error("Choose either --prepare-adjudication or --finalize");

const runDirectory = path.resolve(runOption);
const readJson = async (name) => JSON.parse(await fs.readFile(path.join(runDirectory, name), "utf8"));
const [packet, reviewerOne, reviewerTwo] = await Promise.all([
  readJson("review-packet.v6.json"),
  readJson("reviewer-1.v6.json"),
  readJson("reviewer-2.v6.json")
]);
const reviewerLabels = [reviewerOne, reviewerTwo];

if (prepareAdjudication) {
  const adjudication = createCompletionV6AdjudicationTemplate({ packet, reviewerLabels });
  const outputPath = path.join(runDirectory, "adjudication.v6.json");
  await fs.writeFile(outputPath, `${JSON.stringify(adjudication, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: "adjudication_prepared", outputPath,
    disagreements: adjudication.entries.length, productionAuthorization: false }));
} else if (finalize) {
  const adjudication = await readJson("adjudication.v6.json");
  const result = finalizeCompletionV6IndependentReview({ packet, reviewerLabels, adjudication });
  const outputPath = path.join(runDirectory, "independent-review-result.v6.json");
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, outputPath,
    totalFacetRatings: result.totalFacetRatings, reviewerAgreements: result.reviewerAgreements,
    adjudicatedDisagreements: result.adjudicatedDisagreements,
    ratingCounts: result.ratingCounts, productionAuthorization: false }));
} else {
  const progress = inspectCompletionV6IndependentReview({ packet, reviewerLabels });
  console.log(JSON.stringify(progress, null, 2));
}
