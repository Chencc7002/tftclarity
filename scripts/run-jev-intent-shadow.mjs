import { createJevIntentShadow, buildJevIntentRequest } from "../src/understanding/jev-intent-shadow.js";

// Synthetic inputs only. Default is zero-call dry-run; --live sends at most 6 calls.
const cases = [
  { id: "equipment", input: "推荐一下这个英雄的三件套", expected: "recommend" },
  { id: "comparison", input: "无尽和巨杀哪个更适合这个英雄？", expected: "compare" },
  { id: "composition", input: "当前版本有哪些强势阵容，按排名列一下", expected: "rank" },
  { id: "explanation", input: "解释一下这个羁绊的效果", expected: "explain" },
  { id: "video", input: "帮我找云顶之弈的教学视频", expected: "find_video" },
  { id: "outside", input: "明天天气怎样？", expected: "unknown" }
];
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--live")) throw new Error("Usage: node scripts/run-jev-intent-shadow.mjs [--live]");
if (!args.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry-run", calls: 0, cases: cases.map(c => ({ id: c.id, expected: c.expected, request: buildJevIntentRequest(c) })) }, null, 2));
} else {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("Missing TYPESAFE_API_KEY");
  const classify = createJevIntentShadow({ mode: "shadow", apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 15000 });
  const results = [];
  for (const c of cases) {
    const result = await classify(c, { baselineAction: c.expected });
    results.push({ id: c.id, expected: c.expected, ...result });
    if (result.status !== "observed") break; // Avoid spending retries when account or service fails.
  }
  console.log(JSON.stringify({ mode: "shadow", dataset: "synthetic-smoke-not-acceptance", results }, null, 2));
  if (results.length !== cases.length || results.some(r => r.status !== "observed" || !r.actionAgreement)) process.exitCode = 1;
}
