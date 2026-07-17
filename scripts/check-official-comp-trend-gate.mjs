import { inspectOfficialCompTrendGate } from "../src/core/official-comp-trend-gate.js";

const url = "https://api-hc.metatft.com/tft-comps-api/comps_data?queue=1100";
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`MetaTFT trend gate request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const gate = inspectOfficialCompTrendGate(payload);
  console.log(JSON.stringify({ url, ...gate }, null, 2));
} catch (error) {
  if (error?.name === "AbortError") throw new Error("MetaTFT trend gate request timed out after 30000ms");
  throw error;
} finally {
  clearTimeout(timeout);
}
