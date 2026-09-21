import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildCommunityDragonEntityDetails } from "../src/data/communitydragon-entity-details.js";
import { normalizeTraitStyle, resolveTraitStyle } from "../src/data/trait-style.js";

const ui = (name) => readFileSync(new URL(`../src/app/small-window-ui/${name}`, import.meta.url), "utf8");

test("CommunityDragon trait tiers retain Riot display styles", () => {
  const details = buildCommunityDragonEntityDetails({
    teamplanner: {},
    lookup: { traits: [] },
    traits: [{
      display_name: "灵魂莲华",
      trait_id: "DA_18_Blossom",
      set: "TFTSet18",
      tooltip_text: "<row>(@MinUnits@)低</row><row>(@MinUnits@)中</row><row>(@MinUnits@)高</row><row>(@MinUnits@)最高</row>",
      conditional_trait_sets: [
        { min_units: 2, max_units: 3, style_idx: 2, style_name: "kBronze" },
        { min_units: 4, max_units: 5, style_idx: 3, style_name: "kSilver" },
        { min_units: 6, max_units: 7, style_idx: 5, style_name: "kGold" },
        { min_units: 8, max_units: 25000, style_idx: 6, style_name: "kChromatic" }
      ]
    }]
  }, { tftSet: "TFTSet18" });

  const levels = details.traits.get("DA_18_Blossom").levels;
  assert.deepEqual(levels.map((level) => level.style), ["bronze", "silver", "gold", "chromatic"]);
  assert.deepEqual(levels.map((level) => level.styleIndex), [2, 3, 5, 6]);
});

test("trait styles prefer explicit match style, then official tier metadata", () => {
  const entityDetails = { traits: new Map([["DA_18_Blossom", {
    levels: [
      { style: "bronze" },
      { style: "silver" },
      { style: "gold" },
      { style: "chromatic" }
    ]
  }]]) };

  assert.equal(normalizeTraitStyle(3), "gold");
  assert.equal(normalizeTraitStyle("kChromatic"), "chromatic");
  assert.equal(resolveTraitStyle({ apiName: "DA_18_Blossom", tier: 2 }, entityDetails), "silver");
  assert.equal(resolveTraitStyle({ apiName: "DA_18_Blossom", tier: 2, style: 3 }, entityDetails), "gold");
  assert.equal(resolveTraitStyle({ filterId: "DA_18_Blossom_4" }, entityDetails), "chromatic");
});

test("trait thumbnails hide fallback letters and receive tier color classes", () => {
  const app = ui("app.js");
  const server = readFileSync(new URL("../src/app/small-window-server.js", import.meta.url), "utf8");
  const context = vm.createContext({
    escapeHtml: String,
    localizedName: (trait) => trait.name
  });
  vm.runInContext(app.slice(app.indexOf("function assetThumb("), app.indexOf("// Image errors")), context);
  vm.runInContext(app.slice(app.indexOf("function compTraitLabel("), app.indexOf("function compRankLabel(")), context);

  const thumb = context.traitThumb({ name: "灵魂莲华", tier: 3, style: "gold", iconUrl: "trait.png" });
  assert.match(thumb, /trait-icon trait-style-gold/u);
  assert.match(thumb, /<img[^>]+><span class="asset-thumb-fallback">灵<\/span>/u);

  const styles = ui("styles.css");
  const html = ui("index.html");
  assert.match(server, /style: resolveTraitStyle\(trait, entityDetails\)/u);
  assert.match(styles, /img:not\(\[hidden\]\) \+ \.asset-thumb-fallback \{ visibility: hidden; \}/u);
  for (const style of ["bronze", "silver", "gold", "chromatic", "unique"]) {
    assert.match(styles, new RegExp(`trait-style-${style}`));
    assert.match(html, new RegExp(`trait-color-${style}`));
  }
});
