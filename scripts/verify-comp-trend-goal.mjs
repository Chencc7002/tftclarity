import { spawn } from "node:child_process";
import { inspectOfficialCompTrendGate } from "../src/index.js";

const endpoint = "https://api-hc.metatft.com/tft-comps-api/comps_data?queue=1100";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed: code=${code} signal=${signal ?? "none"}`));
    });
  });
}

const response = await fetch(endpoint);
if (!response.ok) throw new Error(`MetaTFT trend gate request failed: ${response.status} ${response.statusText}`);
const gate = inspectOfficialCompTrendGate(await response.json());

if (!gate.ready) {
  console.log(JSON.stringify({
    ok: false,
    outcome: "waiting_for_official_trend_evidence",
    endpoint,
    gate,
    skipped: [
      "live_comp_query",
      "live_page_verification",
      "full_regression"
    ]
  }, null, 2));
} else {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const checks = [
    [process.execPath, ["scripts/smoke-comp-rankings-live.mjs"]],
    [process.execPath, ["scripts/smoke-comp-trend-page-live.mjs"]],
    [npm, ["test"]],
    [npm, ["run", "smoke:comps"]],
    [npm, ["run", "smoke:small-window"]]
  ];
  for (const [command, args] of checks) await run(command, args);
  console.log(JSON.stringify({
    ok: true,
    outcome: "goal_verification_passed",
    endpoint,
    gate,
    completed: [
      "live_comp_query",
      "live_page_verification",
      "full_regression",
      "offline_comp_smoke",
      "small_window_smoke"
    ]
  }, null, 2));
}
