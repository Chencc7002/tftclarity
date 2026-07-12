import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryCacheStore, createCatalog, recommendForInput } from "../src/index.js";
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
const compFixture = JSON.parse(await readFile(new URL("../test/fixtures/comp-rankings/exact-units-traits2-minimal.json", import.meta.url), "utf8"));
const compVisualResponse = {
  ...compFixture,
  data: [
    ...compFixture.data,
    {
      units_traits: "TFT17_MissingA&TFT17_MissingB&TFT17_MissingC&TFT17_MissingD&TFT17_MissingE&TFT17_MissingF|TFT17_MissingTrait_1",
      placement_count: [1000, 900, 800, 700, 100, 80, 60, 40]
    }
  ]
};
const itemCompVisualResponse = {
  data: [{
    units_traits: "TFT17_Aatrox&TFT17_Xayah|TFT17_Stargazer_1&TFT17_Stargazer_Serpent_1",
    comp_name: "观星霞",
    placement_count: [160, 150, 140, 130, 110, 80, 60, 50]
  }],
  filter_adjustment: { sample_size: 123456 }
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertSmoke(condition, message) {
  if (!condition) throw new Error(`Visual smoke failed: ${message}`);
}

function visualFixtureIcon(url) {
  const decoded = decodeURIComponent(new URL(url).pathname);
  const fileName = decoded.split("/").pop() ?? "?";
  const label = fileName.replace(/[^a-z0-9]/gi, "").slice(0, 1).toUpperCase() || "?";
  const color = decoded.includes("tft-item") ? "#b87918" : decoded.includes("tft-trait") ? "#4d6f58" : "#315f74";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="${color}"/><text x="20" y="26" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="#fff">${label}</text></svg>`;
}

async function loadPlaywright() {
  const configured = argument("--playwright-module") ?? process.env.PLAYWRIGHT_MODULE;
  const allowSkip = process.argv.includes("--allow-skip") || process.env.VISUAL_SMOKE_ALLOW_SKIP === "1";
  const configuredPath = configured ? resolve(configured) : null;
  const configuredEntry = configuredPath && existsSync(resolve(configuredPath, "index.js"))
    ? resolve(configuredPath, "index.js")
    : configuredPath;
  const specifier = configuredEntry ? pathToFileURL(configuredEntry).href : "playwright";
  try {
    const loaded = await import(specifier);
    return loaded.default ?? loaded;
  } catch (error) {
    if (allowSkip) {
      console.log("Visual smoke skipped: Playwright is not available.");
      console.log(error.message);
      return null;
    }
    throw new Error(`Visual smoke requires Playwright. Install it or pass --allow-skip explicitly. ${error.message}`);
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
    const overflowing = [...document.querySelectorAll(".shell, .topbar, .conversation-pane, .result-pane, .settings-panel, .query-panel, .controls, .segmented, .result-card, .comp-card, .ranking-section, .empty-state, .details, .stats")]
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
    const clipped = [...document.querySelectorAll("button, .item, .stat, .comp-summary-metric, .comp-stat-line span")]
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

async function inspectResponsiveMode(page, label, expected) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    return {
      conversation: rect(".conversation-pane"),
      result: rect(".result-pane"),
      settings: rect(".settings-panel"),
      settingsDisplay: getComputedStyle(document.querySelector(".settings-panel")).display,
      resizerDisplay: getComputedStyle(document.querySelector(".column-resizer")).display
    };
  });
  if (expected === "three") {
    assertSmoke(layout.conversation.right <= layout.result.left + 2, `${label} conversation/result are not columns`);
    assertSmoke(layout.settingsDisplay !== "none" && layout.result.right <= layout.settings.left + 2, `${label} settings is not the third column`);
  } else if (expected === "two") {
    assertSmoke(layout.conversation.right <= layout.result.left + 2, `${label} is not two-column`);
    assertSmoke(layout.settingsDisplay === "none" && layout.resizerDisplay !== "none", `${label} did not hide settings or show the resizer`);
  } else {
    assertSmoke(layout.result.top >= layout.conversation.bottom - 2, `${label} result does not follow conversation vertically`);
    assertSmoke(layout.resizerDisplay === "none", `${label} resizer remains visible in single-column mode`);
  }
  return layout;
}

async function inspectAssetDimensions(page, label) {
  const result = await page.evaluate(() => {
    const expected = {
      "equipment-unit-icon": 38,
      "unit-icon": 32,
      "trait-icon": 22,
      "tiny-item-icon": 20,
      "item-icon": 30
    };
    return [...document.querySelectorAll(".equipment-unit-icon, .unit-icon, .trait-icon, .tiny-item-icon, .item-icon")]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => {
        const className = Object.keys(expected).find((name) => element.classList.contains(name));
        const rect = element.getBoundingClientRect();
        return { className, width: rect.width, height: rect.height, expected: expected[className] };
      });
  });
  const mismatched = result.filter((entry) => Math.abs(entry.width - entry.expected) > 0.5 || Math.abs(entry.height - entry.expected) > 0.5);
  assertSmoke(result.length > 0, `${label} rendered no asset thumbnails`);
  assertSmoke(mismatched.length === 0, `${label} has unstable asset dimensions: ${JSON.stringify(mismatched)}`);
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

  let nowMs = Date.now();
  let failCompRequest = false;
  let emptyCompRequest = false;
  const cacheStore = new MemoryCacheStore({ now: () => nowMs });

  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {
      async getUnitBuilds() {
        return { data: fixtureRows };
      },
      async getCompCandidates(plan) {
        if (Number(plan?.params?.days) === 14) {
          return {
            data: [{
              ...itemCompVisualResponse.data[0],
              placement_count: [10, 10, 10, 10, 10, 10, 10, 10]
            }],
            filter_adjustment: { sample_size: 100 }
          };
        }
        return itemCompVisualResponse;
      },
      async getExactUnitsTraits2() {
        if (failCompRequest) throw new Error("visual stale-cache probe");
        if (emptyCompRequest) return { data: [] };
        return compVisualResponse;
      }
    },
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      compsData: {
        clusterInfo: compFixture.clusters,
        compBuilds: [{
          clusterId: "409002",
          unitApiName: "TFT17_Nunu",
          items: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_DragonsClaw"],
          games: 900
        }]
      }
    })
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
      viewport: { width: 1200, height: 760 },
      deviceScaleFactor: 1
    });
    await page.route("https://ddragon.leagueoflegends.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: visualFixtureIcon(route.request().url())
      });
    });
    await page.goto(started.url, { waitUntil: "networkidle" });
    await page.fill("#query-input", "大师以上霞什么三件装备最强？");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".result-card");
    await page.waitForSelector("button.condition-chip");
    const autoCompChips = await page.locator("button.condition-chip").allTextContents();
    assertSmoke(
      autoCompChips.includes("观星霞 · 样本 880 · 系统补全"),
      `automatic Comp chip is missing: ${JSON.stringify(autoCompChips)}`
    );
    const desktop = await inspectLayout(page, "1200x760 three-column result");
    const desktopMode = await inspectResponsiveMode(page, "1200x760", "three");
    const desktopAssets = await inspectAssetDimensions(page, "1200x760 three-column result");
    await page.locator("#result").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({
      path: resolve(outputDir, "result-1200x760.png"),
      fullPage: true
    });
    await page.locator(".assistant-message").last().screenshot({
      path: resolve(outputDir, "assistant-1200x760.png")
    });

    await page.setViewportSize({ width: 760, height: 700 });
    const twoColumn = await inspectLayout(page, "760x700 two-column result");
    const twoColumnMode = await inspectResponsiveMode(page, "760x700", "two");
    await page.screenshot({ path: resolve(outputDir, "result-760x700.png"), fullPage: true });

    await page.setViewportSize({ width: 520, height: 700 });
    const singleColumn = await inspectLayout(page, "520x700 single-column result");
    const singleColumnMode = await inspectResponsiveMode(page, "520x700", "single");
    await page.screenshot({ path: resolve(outputDir, "result-520x700.png"), fullPage: true });

    const assistantCountBeforeFollowup = await page.locator(".assistant-message").count();
    await page.fill("#query-input", "近一天呢？");
    await page.click("#query-form button.primary");
    await page.waitForFunction(
      (count) => document.querySelectorAll(".assistant-message").length > count,
      assistantCountBeforeFollowup
    );
    const followupText = await page.locator(".assistant-message").last().textContent();
    assertSmoke(followupText.includes("观星霞（系统补全，样本 880）"), "days follow-up did not render the refreshed automatic Comp");
    const longConversation = await inspectLayout(page, "520px automatic Comp days follow-up");
    await page.locator(".assistant-message").last().screenshot({
      path: resolve(outputDir, "comp-auto-followup-520.png")
    });

    await page.fill("#query-input", "霞在观星霞阵容里什么三件装备最强？");
    await page.click("#query-form button.primary");
    await page.waitForSelector('button.condition-chip:text-is("观星霞 · 用户指定")');
    const explicitComp = await inspectLayout(page, "520px explicit Comp result");
    await page.locator("#result").evaluate((element) => {
      const messages = element.querySelectorAll(".message");
      messages[messages.length - 1]?.scrollIntoView({ block: "start" });
    });
    await page.locator(".assistant-message").last().screenshot({
      path: resolve(outputDir, "comp-explicit-520.png")
    });

    await page.setViewportSize({ width: 360, height: 560 });
    await page.fill("#query-input", "近14天霞什么三件装备最强？");
    await page.click("#query-form button.primary");
    await page.waitForSelector('button.condition-chip:text-is("未限制 Comp · 当前条件下没有稳定 Comp")');
    assertSmoke(
      (await page.locator("#result").textContent()).includes("当前条件下未找到稳定 Comp，以下结果未限制 Comp"),
      "no-stable Comp result did not state that the final query is unrestricted"
    );
    const noStableComp = await inspectLayout(page, "360px no-stable Comp result");
    await page.locator("#result").evaluate((element) => {
      const messages = element.querySelectorAll(".message");
      messages[messages.length - 1]?.scrollIntoView({ block: "start" });
    });
    await page.locator(".assistant-message").last().screenshot({
      path: resolve(outputDir, "comp-none-360.png")
    });

    await page.fill("#query-input", "霞什么三件装备最强？");
    await page.click("#settings-button");
    await page.waitForSelector("#settings-panel[aria-hidden=\"false\"]");
    const settingsDrawer = await inspectLayout(page, "360x560 settings drawer");
    await page.screenshot({ path: resolve(outputDir, "settings-drawer-360x560.png"), fullPage: true });
    await page.locator("details.advanced-query-settings").evaluate((element) => { element.open = true; });
    await page.click('#sample-control button[data-value="10"]');
    await page.click("#settings-done");
    await page.fill("#query-input", "霞什么三件装备最强，样本>=10");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".risk");
    const narrow = await inspectLayout(page, "360px low-sample result");
    await page.screenshot({
      path: resolve(outputDir, "narrow-low-sample.png"),
      fullPage: true
    });

    await page.click("#settings-button");
    await page.locator("details.advanced-query-settings").evaluate((element) => { element.open = true; });
    await page.click('#sample-control button[data-value="1000"]');
    await page.click("#settings-done");
    await page.fill("#query-input", "霞什么三件装备最强，样本>=1000");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".empty-state");
    const empty = await inspectLayout(page, "360px empty result");
    await page.screenshot({
      path: resolve(outputDir, "narrow-empty-result.png"),
      fullPage: true
    });

    await page.fill("#query-input", "霞吃鸡优先，但也要稳健高样本");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".clarification-state");
    const clarification = await inspectLayout(page, "360x560 clarification");
    await page.screenshot({ path: resolve(outputDir, "clarification-360x560.png"), fullPage: true });

    await page.setViewportSize({ width: 520, height: 700 });
    await page.fill("#query-input", "当前版本最强阵容有哪些？");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".comp-card");
    const compDesktop = await inspectLayout(page, "520px comp ranking");
    const compDesktopAssets = await inspectAssetDimensions(page, "520px comp ranking");
    const missingPlaceholders = await page.locator(".comp-card .asset-thumb:not(:has(img))").count();
    assertSmoke(missingPlaceholders >= 6, "missing-icon comp did not retain fixed placeholders");
    await page.screenshot({
      path: resolve(outputDir, "comp-desktop.png"),
      fullPage: true
    });

    await page.setViewportSize({ width: 360, height: 560 });
    const compNarrow = await inspectLayout(page, "360px comp ranking");
    const compNarrowAssets = await inspectAssetDimensions(page, "360px comp ranking");
    await page.screenshot({
      path: resolve(outputDir, "comp-narrow.png"),
      fullPage: true
    });

    nowMs += 6 * 60 * 1000;
    failCompRequest = true;
    await page.click("#refresh-button");
    await page.waitForSelector(".comp-warning");
    const compStale = await inspectLayout(page, "360px stale comp ranking");
    assertSmoke((await page.locator(".comp-overview").last().textContent()).includes("过期缓存"), "stale comp cache was not labelled");
    await page.screenshot({
      path: resolve(outputDir, "comp-stale.png"),
      fullPage: true
    });

    failCompRequest = false;
    await page.fill("#query-input", "最热门的阵容，样本>=999999");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".low-sample-section");
    const compLowSample = await inspectLayout(page, "360px low-sample comp reference");
    await page.screenshot({
      path: resolve(outputDir, "comp-low-sample.png"),
      fullPage: true
    });

    emptyCompRequest = true;
    await page.fill("#query-input", "最热门的阵容，样本>=999998");
    await page.click("#query-form button.primary");
    await page.waitForSelector(".empty-state");
    const compEmpty = await inspectLayout(page, "360px empty comp ranking");
    await page.screenshot({
      path: resolve(outputDir, "comp-empty.png"),
      fullPage: true
    });

    const lifecyclePage = await browser.newPage({
      viewport: { width: 760, height: 700 },
      deviceScaleFactor: 1
    });
    let delayNextRecommendation = false;
    let recommendationRequests = 0;
    await lifecyclePage.route("https://ddragon.leagueoflegends.com/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: visualFixtureIcon(route.request().url()) });
    });
    await lifecyclePage.route("**/api/recommend", async (route) => {
      recommendationRequests += 1;
      if (delayNextRecommendation) {
        delayNextRecommendation = false;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 450));
      }
      await route.continue().catch(() => undefined);
    });
    await lifecyclePage.goto(started.url, { waitUntil: "networkidle" });
    const lifecycleQuery = "大师以上霞什么三件装备最强，样本>=10";
    await lifecyclePage.fill("#query-input", lifecycleQuery);
    await lifecyclePage.click("#query-form button.primary");
    await lifecyclePage.waitForSelector(".result-card");

    await lifecyclePage.fill("#query-input", "未发送草稿");
    const usersBeforeRefresh = await lifecyclePage.locator(".user-message").count();
    await lifecyclePage.click("#result-refresh-button");
    await lifecyclePage.waitForFunction((count) => document.querySelectorAll(".user-message").length > count, usersBeforeRefresh);
    await lifecyclePage.waitForSelector(".result-card");
    assertSmoke((await lifecyclePage.locator(".user-message").last().textContent()).includes(lifecycleQuery), "refresh submitted the unsent draft instead of the last query");
    assertSmoke(await lifecyclePage.inputValue("#query-input") === "未发送草稿", "refresh cleared the unsent draft");

    delayNextRecommendation = true;
    await lifecyclePage.fill("#query-input", "近7天霞什么三件装备最强，样本>=10");
    await lifecyclePage.click("#query-form button.primary");
    await lifecyclePage.waitForSelector('.result-state[data-state="loading"]');
    await lifecyclePage.click('[data-locale="en-US"]');
    assertSmoke((await lifecyclePage.locator("#result-content").textContent()).includes("Preparing results"), "language switch replaced or failed to localize the loading result");
    await lifecyclePage.waitForSelector(".result-card");
    await lifecyclePage.click('[data-locale="zh-CN"]');

    delayNextRecommendation = true;
    await lifecyclePage.fill("#query-input", "近14天霞什么三件装备最强，样本>=10");
    await lifecyclePage.click("#query-form button.primary");
    await lifecyclePage.waitForSelector('.result-state[data-state="loading"]');
    await lifecyclePage.click("#clear-button");
    await lifecyclePage.waitForTimeout(650);
    assertSmoke(await lifecyclePage.locator("#result-content .result-empty").count() === 1, "clear was overwritten by the aborted request state");
    assertSmoke(!(await lifecyclePage.locator("#result-content").textContent()).includes("已停止"), "clear ended in the stopped state");
    const lifecycle = await inspectLayout(lifecyclePage, "request lifecycle regression page");
    assertSmoke(recommendationRequests >= 4, "request lifecycle probes did not exercise all recommendation calls");
    await lifecyclePage.close();

    console.log(JSON.stringify({
      ok: true,
      url: started.url,
      outputDir,
      checks: {
        desktop,
        desktopAssets,
        desktopMode,
        twoColumn,
        twoColumnMode,
        singleColumn,
        singleColumnMode,
        longConversation,
        explicitComp,
        noStableComp,
        narrow,
        empty,
        settingsDrawer,
        clarification,
        compDesktop,
        compDesktopAssets,
        compNarrow,
        compNarrowAssets,
        compStale,
        compLowSample,
        compEmpty,
        lifecycle,
        missingPlaceholders
      }
    }, null, 2));
    console.log("Small-window visual smoke checks passed.");
  } finally {
    await browser?.close();
    await closeServer(started.server);
  }
}
