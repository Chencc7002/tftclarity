import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyOfficialItemLocalization,
  auditItemPatchChanges,
  buildOfficialItemLocalizationCatalog,
  createItemLocalizationMap,
  mergeCatalogItems
} from "../src/index.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(testDir, "fixtures", "item-localization");
const repoRoot = resolve(testDir, "..");

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

test("merges official Tencent zh-CN names by Riot/MetaTFT apiName", () => {
  const records = buildOfficialItemLocalizationCatalog(
    fixture("tencent-equip-16.13.json"),
    fixture("riot-en-16.13.1.json"),
    {
      scopeApiNames: ["TFT_Item_GuinsoosRageblade", "TFT_Item_Artifact_CappaJuice"],
      tftPatch: "17.6"
    }
  );
  const byApiName = createItemLocalizationMap(records);

  assert.equal(byApiName.get("TFT_Item_GuinsoosRageblade").zhName, "鬼索的狂暴之刃");
  assert.equal(byApiName.get("TFT_Item_GuinsoosRageblade").sourcePatch, "16.13");
  assert.equal(byApiName.get("TFT_Item_GuinsoosRageblade").tftPatch, "17.6");
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").zhName, "帽子饮品");
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").enName, "Cappa Juice");
  assert.equal(byApiName.get("TFT_Item_Artifact_CappaJuice").traceabilityStatus, "official_zh_cn");
});

test("official canonical names win while manual short names and aliases remain", () => {
  const records = buildOfficialItemLocalizationCatalog(
    fixture("tencent-equip-16.13.json"),
    fixture("riot-en-16.13.1.json"),
    { scopeApiNames: ["TFT_Item_GuinsoosRageblade", "TFT_Item_Artifact_CappaJuice"] }
  );
  const localizationByApiName = createItemLocalizationMap(records);
  const rageblade = applyOfficialItemLocalization({
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "人工旧名",
    shortName: "羊刀",
    aliases: ["鬼索", "guinsoo"]
  }, { localizationByApiName });
  const cappa = applyOfficialItemLocalization({
    apiName: "TFT_Item_Artifact_CappaJuice",
    shortName: "Cappa Juice",
    aliases: ["cappajuice"]
  }, { localizationByApiName });

  assert.equal(rageblade.zhName, "鬼索的狂暴之刃");
  assert.equal(rageblade.shortName, "羊刀");
  assert.equal(rageblade.manualNameCandidate, "人工旧名");
  assert.equal(rageblade.aliases.includes("鬼索"), true);
  assert.equal(rageblade.nameSource, "tencent_lol_official_tft_catalog");
  assert.equal(cappa.zhName, "帽子饮品");
  assert.equal(cappa.shortName, "帽子饮品");
  assert.equal(cappa.aliases.includes("Cappa Juice"), true);
});

test("missing zh-CN rejects placeholders and falls back to verified English pending review", () => {
  const records = buildOfficialItemLocalizationCatalog(
    fixture("tencent-equip-16.13.json"),
    fixture("riot-en-16.13.1.json"),
    { scopeApiNames: ["TFT_Item_MissingZh"] }
  );
  const localized = applyOfficialItemLocalization({
    apiName: "TFT_Item_MissingZh",
    zhName: "未经验证中文",
    shortName: "未经验证中文",
    aliases: ["人工候选"]
  }, { localizationByApiName: createItemLocalizationMap(records) });

  assert.equal(localized.zhName, null);
  assert.equal(localized.displayName, "Verified English Fallback");
  assert.equal(localized.shortName, "Verified English Fallback");
  assert.equal(localized.nameStatus, "official_en_fallback_pending_zh_cn");
  assert.equal(localized.nameSource, "riot_data_dragon");
  assert.equal(localized.namePatch, "16.13.1");
  assert.equal(localized.nameNeedsReview, true);
});

test("missing official names uses a low-confidence derived token with honest provenance", () => {
  const [record] = buildOfficialItemLocalizationCatalog(
    fixture("tencent-equip-16.13.json"),
    fixture("riot-en-16.13.1.json"),
    { scopeApiNames: ["TFT_Item_UncataloguedWidget"] }
  );

  assert.equal(record.enName, "Uncatalogued Widget");
  assert.equal(record.source, "derived_api_token");
  assert.equal(record.sourceUrl, null);
  assert.equal(record.sourcePatch, null);
  assert.equal(record.season, null);
  assert.equal(record.sourceUpdatedAt, null);
  assert.equal(record.confidence, 0.25);
  assert.equal(record.traceabilityStatus, "derived_api_token_pending_review");
  assert.equal(record.needsReview, true);
});

test("catalog merge preserves a manual name candidate across repeated localization", () => {
  const records = buildOfficialItemLocalizationCatalog(
    fixture("tencent-equip-16.13.json"),
    fixture("riot-en-16.13.1.json"),
    { scopeApiNames: ["TFT_Item_GuinsoosRageblade"] }
  );
  const localizationByApiName = createItemLocalizationMap(records);
  const localized = applyOfficialItemLocalization({
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "人工旧名",
    shortName: "羊刀",
    aliases: []
  }, { localizationByApiName });
  const [merged] = mergeCatalogItems([], [localized], { localizationByApiName });

  assert.equal(localized.manualNameCandidate, "人工旧名");
  assert.equal(merged.manualNameCandidate, "人工旧名");
});

test("patch audit reports additions, observations, missing localization and name changes", () => {
  const report = auditItemPatchChanges({
    patch: "current",
    previousItems: [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_CappaJuice",
      "TFT_Item_RunaansHurricane",
      "TFT_Item_UnconfirmedRemoved"
    ],
    currentItems: [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_CappaJuice",
      "TFT_Item_NewOfficial",
      "TFT_Item_MissingZh"
    ],
    previousLocalization: fixture("localization-previous.json").items,
    currentLocalization: buildOfficialItemLocalizationCatalog(
      fixture("tencent-equip-16.13.json"),
      fixture("riot-en-16.13.1.json")
    )
  });

  assert.deepEqual(report.added, ["TFT_Item_MissingZh", "TFT_Item_NewOfficial"]);
  assert.equal(report.removed.find((entry) => entry.apiName === "TFT_Item_RunaansHurricane").availabilityDecision, "manual_review_required");
  assert.equal(report.removed.find((entry) => entry.apiName === "TFT_Item_UnconfirmedRemoved").availabilityDecision, "manual_review_required");
  assert.equal(report.removed.every((entry) => entry.availabilityChanged === false), true);
  assert.deepEqual(report.missingLocalization.map((entry) => entry.apiName), ["TFT_Item_MissingZh"]);
  assert.deepEqual(report.nameChanges.map((entry) => entry.apiName), ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(report.availabilityPolicy, "item-availability-overrides-only");
});

test("refresh and patch audit scripts run entirely from offline fixtures", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tft-item-localization-"));
  const output = join(tempDir, "current-localization.json");
  try {
    const refreshOutput = execFileSync(process.execPath, [
      join(repoRoot, "scripts", "refresh-item-localization.mjs"),
      "--cn", join(fixtureDir, "tencent-equip-16.13.json"),
      "--en", join(fixtureDir, "riot-en-16.13.1.json"),
      "--items", join(fixtureDir, "metatft-items-current.json"),
      "--output", output
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.match(refreshOutput, /items=4, localized=3, missing=1/);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).items.length, 4);

    const checkArgs = [
      join(repoRoot, "scripts", "refresh-item-localization.mjs"),
      "--cn", join(fixtureDir, "tencent-equip-16.13.json"),
      "--en", join(fixtureDir, "riot-en-16.13.1.json"),
      "--items", join(fixtureDir, "metatft-items-current.json"),
      "--output", output,
      "--check"
    ];
    const checkOutput = execFileSync(process.execPath, checkArgs, {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.match(checkOutput, /check=up-to-date/);

    const drifted = JSON.parse(readFileSync(output, "utf8"));
    drifted.metadata.itemCount = 999;
    writeFileSync(output, `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
    const driftCheck = spawnSync(process.execPath, checkArgs, {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(driftCheck.status, 0);
    assert.match(driftCheck.stderr, /snapshot drift detected/);

    execFileSync(process.execPath, checkArgs.filter((arg) => arg !== "--check"), {
      cwd: repoRoot,
      encoding: "utf8"
    });

    const auditOutput = execFileSync(process.execPath, [
      join(repoRoot, "scripts", "audit-item-patch.mjs"),
      "--previous-items", join(fixtureDir, "metatft-items-previous.json"),
      "--current-items", join(fixtureDir, "metatft-items-current.json"),
      "--previous-localization", join(fixtureDir, "localization-previous.json"),
      "--current-localization", output,
      "--json"
    ], { cwd: repoRoot, encoding: "utf8" });
    const report = JSON.parse(auditOutput);
    assert.equal(report.counts.added, 2);
    assert.equal(report.counts.removed, 2);
    assert.equal(report.counts.missingLocalization, 1);
    assert.equal(report.counts.nameChanges, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
