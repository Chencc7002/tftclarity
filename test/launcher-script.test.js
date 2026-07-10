import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../scripts/start-small-window.ps1", import.meta.url), "utf8");
const hotkeyHelper = readFileSync(new URL("../scripts/small-window-hotkey.ps1", import.meta.url), "utf8");
const hotkeySmoke = readFileSync(new URL("../scripts/smoke-small-window-hotkey.ps1", import.meta.url), "utf8");
const sqliteSmoke = readFileSync(new URL("../scripts/smoke-sqlite-cache.mjs", import.meta.url), "utf8");
const smallWindowSmoke = readFileSync(new URL("../scripts/smoke-small-window.mjs", import.meta.url), "utf8");
const visualSmoke = readFileSync(new URL("../scripts/smoke-small-window-visual.mjs", import.meta.url), "utf8");
const smallWindowStyles = readFileSync(new URL("../src/app/small-window-ui/styles.css", import.meta.url), "utf8");
const aliasAudit = readFileSync(new URL("../scripts/audit-alias-coverage.mjs", import.meta.url), "utf8");
const itemAvailabilityAudit = readFileSync(new URL("../scripts/audit-item-availability.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("window launcher supports service-only verification mode", () => {
  assert.match(launcher, /\[switch\]\$NoBrowser/);
  assert.match(launcher, /Test-Health/);
  assert.match(launcher, /\/api\/health/);
  assert.match(launcher, /serverStarted/);
  assert.match(launcher, /--host \$HostName --port \$Port/);
  assert.match(launcher, /\[string\]\$CacheStore/);
  assert.match(launcher, /\[string\]\$CachePath/);
  assert.match(launcher, /--cache-store \$CacheStore/);
  assert.match(launcher, /--cache-path/);
});

test("window launcher opens a fixed-size browser app window", () => {
  assert.match(launcher, /--app=\$Url/);
  assert.match(launcher, /--window-size=\$Width,\$Height/);
  assert.match(launcher, /\[int\]\$WindowLeft = 40/);
  assert.match(launcher, /\[int\]\$WindowTop = 40/);
  assert.match(launcher, /--window-position=\$WindowLeft,\$WindowTop/);
  assert.match(launcher, /small-window-browser-profile/);
});

test("window launcher can request a topmost app window", () => {
  assert.match(launcher, /\[switch\]\$TopMost/);
  assert.match(launcher, /Set-TopMostWindow/);
  assert.match(launcher, /SetWindowPos/);
  assert.match(launcher, /TFTAgentWin32WindowTools/);
  assert.match(launcher, /topMostRequested/);
  assert.match(launcher, /topMostApplied/);
  assert.match(launcher, /topMostWindowPid/);
  assert.match(launcher, /windowLeft = \$WindowLeft/);
  assert.match(launcher, /windowTop = \$WindowTop/);
});

test("window launcher starts an optional global hotkey helper for the app window", () => {
  assert.match(launcher, /\[switch\]\$NoHotkey/);
  assert.match(launcher, /\[string\]\$Hotkey = "Ctrl\+Shift\+Space"/);
  assert.match(launcher, /small-window-hotkey\.ps1/);
  assert.match(launcher, /hotkeyStarted/);
  assert.match(launcher, /hotkeyRequested/);
  assert.match(hotkeyHelper, /RegisterHotKey/);
  assert.match(hotkeyHelper, /UnregisterHotKey/);
  assert.match(hotkeyHelper, /SetForegroundWindow/);
  assert.match(hotkeyHelper, /ShowWindow/);
  assert.match(hotkeyHelper, /TFTAgentSmallWindowHotkey/);
  assert.match(hotkeyHelper, /Ctrl\+Shift\+Space/);
  assert.match(hotkeyHelper, /ExitAfterSeconds/);
  assert.match(hotkeyHelper, /-ReferencedAssemblies System\.Windows\.Forms/);
  assert.match(hotkeyHelper, /EventHandler handler = HotkeyPressed/);
  assert.match(hotkeyHelper, /UnregisterHotKey/);
  assert.match(hotkeySmoke, /Ctrl\+Alt\+F24/);
  assert.match(hotkeySmoke, /ExitAfterSeconds 1/);
});

test("package scripts expose web and window launch commands", () => {
  assert.equal(packageJson.scripts.start, "node src/app/small-window-server.js");
  assert.equal(packageJson.scripts.window, "powershell -ExecutionPolicy Bypass -File scripts/start-small-window.ps1");
  assert.equal(packageJson.scripts["window:server"], "powershell -ExecutionPolicy Bypass -File scripts/start-small-window.ps1 -NoBrowser");
  assert.equal(packageJson.scripts["smoke:small-window"], "node scripts/smoke-small-window.mjs");
  assert.equal(packageJson.scripts["smoke:hotkey"], "powershell -ExecutionPolicy Bypass -File scripts/smoke-small-window-hotkey.ps1");
  assert.equal(packageJson.scripts["smoke:sqlite"], "node scripts/smoke-sqlite-cache.mjs");
  assert.equal(packageJson.scripts["audit:aliases"], "node scripts/audit-alias-coverage.mjs");
  assert.equal(packageJson.scripts["audit:items"], "node scripts/audit-item-availability.mjs");
});

test("sqlite smoke script verifies file-backed cache operations when a driver exists", () => {
  assert.match(sqliteSmoke, /SQLiteCacheStore\.open/);
  assert.match(sqliteSmoke, /SQLITE_SMOKE_PATH/);
  assert.match(sqliteSmoke, /SQLITE_SMOKE_KEEP/);
  assert.match(sqliteSmoke, /setUserPreference/);
  assert.match(sqliteSmoke, /setDefaultContext/);
  assert.match(sqliteSmoke, /addEntityAlias/);
  assert.match(sqliteSmoke, /addFeedbackEvent/);
  assert.match(sqliteSmoke, /findFeedbackEventByFeedbackId/);
  assert.match(sqliteSmoke, /SQLite smoke skipped/);
  assert.match(sqliteSmoke, /better-sqlite3/);
  assert.match(sqliteSmoke, /node:sqlite/);
});

test("small-window smoke script verifies local API flows without network", () => {
  assert.match(smallWindowSmoke, /startSmallWindowServer/);
  assert.match(smallWindowSmoke, /createSmallWindowRuntime/);
  assert.match(smallWindowSmoke, /\/api\/health/);
  assert.match(smallWindowSmoke, /\/api\/runtime/);
  assert.match(smallWindowSmoke, /explorerTimeoutMs/);
  assert.match(smallWindowSmoke, /\/api\/preferences/);
  assert.match(smallWindowSmoke, /defaultContextStrategy/);
  assert.match(smallWindowSmoke, /catalogPrewarm/);
  assert.match(smallWindowSmoke, /SMOKE_HOT_CACHE_MAX_MS/);
  assert.match(smallWindowSmoke, /SMOKE_LOCAL_CACHE_MAX_MS/);
  assert.match(smallWindowSmoke, /JsonFileCacheStore/);
  assert.match(smallWindowSmoke, /\/api\/recommend/);
  assert.match(smallWindowSmoke, /\/api\/feedback/);
  assert.match(smallWindowSmoke, /\/api\/entity-aliases\?limit=1&query=xayha/);
  assert.match(smallWindowSmoke, /\/api\/entity-aliases\/review/);
  assert.match(smallWindowSmoke, /excludedItemNames/);
  assert.match(smallWindowSmoke, /Small-window smoke checks passed/);
});

test("visual smoke script verifies responsive result states when Playwright is available", () => {
  assert.match(packageJson.scripts["smoke:visual"], /smoke-small-window-visual\.mjs/);
  assert.match(visualSmoke, /narrow-low-sample\.png/);
  assert.match(visualSmoke, /narrow-empty-result\.png/);
  assert.match(visualSmoke, /\.segmented/);
  assert.match(visualSmoke, /\.stats/);
  assert.match(smallWindowStyles, /\.shell\s*\{[^}]*width:\s*min\(100%,\s*460px\)/s);
  assert.doesNotMatch(smallWindowStyles, /width:\s*min\(100vw,\s*460px\)/);
});

test("alias audit script reports missing manual override coverage without promoting candidates", () => {
  assert.match(aliasAudit, /buildUnitCatalogFromCompsData/);
  assert.match(aliasAudit, /buildTraitCatalogFromCompsData/);
  assert.match(aliasAudit, /buildItemCatalogFromItemsResponse/);
  assert.match(aliasAudit, /meta_items\.json/);
  assert.match(aliasAudit, /CANDIDATE_UNIT_ALIAS_OVERRIDES/);
  assert.match(aliasAudit, /coverage_audit_candidate/);
  assert.match(aliasAudit, /zhName: null/);
  assert.match(aliasAudit, /--write/);
});

test("item availability audit verifies explicit current-patch removal rules", () => {
  assert.match(itemAvailabilityAudit, /ITEM_AVAILABILITY_OVERRIDES/);
  assert.match(itemAvailabilityAudit, /removed_or_legacy/);
  assert.match(itemAvailabilityAudit, /current=false and obtainable=false/);
  assert.match(itemAvailabilityAudit, /availabilityOverride/);
  assert.match(itemAvailabilityAudit, /meta_items_expanded\.json/);
  assert.match(itemAvailabilityAudit, /duplicate availability override/);
});
