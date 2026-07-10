import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const fixtureRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_Deathblade",
    placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
  }
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertSmoke(condition, message) {
  if (!condition) throw new Error(`Visual smoke failed: ${message}`);
}

async function loadPlaywright() {
  const configured = argument("--playwright-module") ?? process.env.PLAYWRIGHT_MODULE;
  const specifier = configured
    ? pathToFileURL(resolve(configured)).href
    : "playwright";
  try {
    return await import(specifier);
  } catch (error) {
    console.log("Visual smoke skipped: Playwright is not available.");
    console.log(error.message);
    return null;
  }
}

function closeServer(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

async function inspectLayout(page, label) {
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflowing = [...document.querySelectorAll(".shell, .query-panel, .controls, .segmented, .result-card, .empty-state, .details, .stats")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
      })
      .map((element) => ({
        selector: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewportWidth
      }));
    const clipped = [...document.querySelectorAll("button, .item, .stat")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        text: element.textContent.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
    return {
      bodyScrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
      overflowing,
      clipped
    };
  });

  assertSmoke(result.bodyScrollWidth <= result.viewportWidth + 1, `${label} has horizontal page overflow`);
  assertSmoke(result.overflowing.length === 0, `${label} has overflowing panels: ${JSON.stringify(result.overflowing)}`);
  assertSmoke(result.clipped.length === 0, `${label} has clipped compact text: ${JSON.stringify(result.clipped)}`);
  return result;
}

const playwright = await loadPlaywright();
if (playwright) {
  const outputDir = resolve(argument("--output") ?? ".cache/visual-smoke");
  const browserPath = argument("--browser")
    ?? process.env.PLAYWRIGHT_BROWSER_PATH
    ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assertSmoke(existsSync(browserPath), `browser executable not found: ${browserPath}`);
  await mkdir(outputDir, { recursive: true });

  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {
      async getUnitBuilds() {
        return { data: fixtureRows };
      }
    },
    compsClient: {}
  });
  const started = await startSmallWindowServer({
    host: "127.0.0.1",
    port: 0,
    runtime
  });
  let browser = null;

  try {
    browser = await playwright.chromium.launch({
      executablePath: browserPath,
      headless: true
    });
    const page = await browser.newPage({
      viewport: { width: 460, height: 760 },
      deviceScaleFactor: 1
    });
    await page.goto(started.url, { waitUntil: "networkidle" });
    await page.click("#query-form button.primary");
    await page.waitForSelector(".result-card");
    const desktop = await inspectLayout(page, "desktop result");
    await page.screenshot({
      path: resolve(outputDir, "desktop-result.png"),
      fullPage: true
    });

    await page.setViewportSize({ width: 360, height: 720 });
    await page.click('#sample-control button[data-value="10"]');
    await page.click("#query-form button.primary");
    await page.waitForSelector(".risk");
    const narrow = await inspectLayout(page, "360px low-sample result");
    await page.screenshot({
      path: resolve(outputDir, "narrow-low-sample.png"),
      fullPage: true
    });

    await page.click('#sample-control button[data-value="1000"]');
    await page.click("#query-form button.primary");
    await page.waitForSelector(".empty-state .summary");
    const empty = await inspectLayout(page, "360px empty result");
    await page.screenshot({
      path: resolve(outputDir, "narrow-empty-result.png"),
      fullPage: true
    });

    console.log(JSON.stringify({
      ok: true,
      url: started.url,
      outputDir,
      checks: {
        desktop,
        narrow,
        empty
      }
    }, null, 2));
    console.log("Small-window visual smoke checks passed.");
  } finally {
    await browser?.close();
    await closeServer(started.server);
  }
}
