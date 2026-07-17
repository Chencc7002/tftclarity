import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MemoryCacheStore,
  inspectOfficialCompTrendGate
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const endpoint = "https://api-hc.metatft.com/tft-comps-api/comps_data?queue=1100";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function check(condition, message) {
  if (!condition) throw new Error(`Live trend page smoke failed: ${message}`);
}

async function loadPlaywright() {
  const configured = argument("--playwright-module") ?? process.env.PLAYWRIGHT_MODULE;
  const configuredPath = configured ? resolve(configured) : null;
  const configuredEntry = configuredPath && existsSync(resolve(configuredPath, "index.js"))
    ? resolve(configuredPath, "index.js")
    : configuredPath;
  const specifier = configuredEntry ? pathToFileURL(configuredEntry).href : "playwright";
  try {
    const loaded = await import(specifier);
    return loaded.default ?? loaded;
  } catch (error) {
    throw new Error(`Live page verification requires Playwright after the official gate opens. ${error.message}`);
  }
}

function closeServer(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}

const gateResponse = await fetch(endpoint);
if (!gateResponse.ok) throw new Error(`MetaTFT trend gate request failed: ${gateResponse.status}`);
const gate = inspectOfficialCompTrendGate(await gateResponse.json());
if (!gate.ready) {
  throw new Error(`official trend gate is closed: status=${gate.status} eligible=${gate.eligibleCount}/${gate.minimum}`);
}

const playwright = await loadPlaywright();
const browserPath = argument("--browser")
  ?? process.env.PLAYWRIGHT_BROWSER_PATH
  ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
check(existsSync(browserPath), `browser executable not found: ${browserPath}`);
const outputDir = resolve(argument("--output") ?? ".cache/comp-trend-live");
await mkdir(outputDir, { recursive: true });

const runtime = createSmallWindowRuntime({
  cacheStore: new MemoryCacheStore(),
  fetchItems: false
});
const started = await startSmallWindowServer({
  host: "127.0.0.1",
  port: 0,
  runtime,
  prewarmCatalog: false
});
let browser;

try {
  browser = await playwright.chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  await page.goto(started.url, { waitUntil: "networkidle" });

  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/recommend")
    && response.request().method() === "POST");
  await page.fill("#query-input", "当前版本阵容趋势");
  await page.click("#query-form button.primary");
  const apiResponse = await responsePromise;
  check(apiResponse.ok(), `local query returned HTTP ${apiResponse.status()}`);
  const payload = await apiResponse.json();

  check(payload.type === "comp_rankings", `unexpected response type ${payload.type}`);
  check(payload.trend?.officialGate?.ready === true, "local API lost the open official trend source");
  check(payload.trend.officialGate.leaders?.length === 3, "local API did not preserve three raw leaders");
  check(payload.improving?.length === 3, `local API returned ${payload.improving?.length ?? 0} trend cards`);
  check(payload.improving.every((comp) => Number(comp.trend?.avgPlacementChange) < -0.1),
    "a rendered trend card does not satisfy the strict threshold");

  await page.waitForSelector('.improving-section .comp-card[data-variant="trend"]');
  const cards = page.locator('.improving-section .comp-card[data-variant="trend"]');
  check(await cards.count() === 3, `page rendered ${await cards.count()} trend cards`);
  const renderedNames = await cards.locator("summary strong").allTextContents();
  const expectedNames = payload.improving.map((comp) => comp.name);
  check(JSON.stringify(renderedNames) === JSON.stringify(expectedNames),
    `page order differs from local API: rendered=${renderedNames.join(",")} expected=${expectedNames.join(",")}`);

  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    trendNoticeCount: document.querySelectorAll(".comp-trend-notice").length,
    officialSourceCount: [...document.querySelectorAll(".trend-source, .trend-model-line span")]
      .filter((element) => element.textContent.includes("MetaTFT")).length
  }));
  check(layout.scrollWidth <= layout.viewportWidth + 1, "trend page has horizontal overflow");
  check(layout.trendNoticeCount === 0, "closed-gate notice remained after the gate opened");
  check(layout.officialSourceCount >= 3, "official source labels are missing from trend cards");

  await page.screenshot({ path: resolve(outputDir, "trend-page-1200x760.png"), fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    endpoint,
    localUrl: started.url,
    gate: payload.trend.officialGate,
    improving: payload.improving.map((comp) => ({
      clusterId: comp.source?.clusterId,
      name: comp.name,
      avgPlacementChange: comp.trend?.avgPlacementChange,
      emergenceScore: comp.trend?.emergenceScore
    })),
    renderedNames,
    screenshot: resolve(outputDir, "trend-page-1200x760.png")
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await closeServer(started.server);
}
