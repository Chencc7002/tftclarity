import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { mountEmblemRankings } from "../src/app/small-window-ui/emblem-rankings.js";

test("production permits official equipment images while retaining strict scripts", () => {
  const caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  const policy = caddy.match(/Content-Security-Policy "([^"]+)"/)[1];
  const images = policy.split(";").find(value => value.trim().startsWith("img-src ")).trim().split(/\s+/);
  assert.ok(images.includes("https://game.gtimg.cn"));
  assert.equal(policy.split(";").find(value => value.trim().startsWith("script-src ")).trim(), "script-src 'self'");
});

test("dynamic thumbnails retry once and hide broken images without inline scripts", () => {
  const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
  let handler;
  const context = vm.createContext({ escapeHtml: String, document: {
    addEventListener: (name, callback, capture) => { assert.equal(name, "error"); assert.equal(capture, true); handler = callback; }
  } });
  vm.runInContext(app.slice(app.indexOf("function assetThumb("), app.indexOf("function hasNumericValue(")), context);
  assert.doesNotMatch(context.assetThumb("https://example.com/a.png", "装备"), /onerror=/);
  const image = { tagName: "IMG", src: "primary", dataset: { fallbackSrc: "backup" },
    closest: () => true, getAttribute() { return this.src; } };
  handler({ target: image });
  assert.equal(image.src, "backup");
  assert.equal(image.hidden, undefined);
  handler({ target: image });
  assert.equal(image.hidden, true);
  const unrelated = { tagName: "IMG", dataset: {}, closest: () => false };
  handler({ target: unrelated });
  assert.equal(unrelated.hidden, undefined);
});

test("expanded carriers show scoped complete builds and separate build sample counts", async () => {
  let toggle;
  const content = {};
  const details = { open: true, dataset: { emblemCarriers: "emblem" },
    querySelector: () => content, addEventListener: (_, callback) => { toggle = callback; } };
  const root = { innerHTML: "", querySelector: () => ({ addEventListener() {} }),
    querySelectorAll: selector => selector === "[data-emblem-carriers]" ? [details] : [] };
  const stats = { games: 400, avgPlacement: 4, top4Rate: .5, winRate: .1 };
  const build = { items: ["emblem", "a", "b"], displayItems: [{ name: "纹章" }, { name: "羊刀" }, { name: "夜之锋刃" }],
    stats: { games: 123, avgPlacement: 3.75 } };
  let calls = 0;
  mountEmblemRankings({ root, data: { rows: [{ item: { apiName: "emblem" }, recipeBase: "pan", recipe: [], stats }], updatedAt: "2026-09-11" },
    t: key => key, escapeHtml: String, itemPill: item => `<item>${item.name}</item>`, assetThumb: () => "",
    localizedName: item => item?.name ?? "hero", loadCarriers: async () => { calls++; return { item: "emblem", carriers: [
      { unit: { name: "婕拉" }, stats, builds: [build] },
      { unit: { name: "阿狸" }, stats, builds: [{ ...build, items: ["emblem"] }] }
    ] }; } });
  await toggle();
  assert.match(content.innerHTML, /羊刀/);
  assert.match(content.innerHTML, /夜之锋刃/);
  assert.match(content.innerHTML, /emblemBuildSamples 123/);
  assert.match(content.innerHTML, /3\.75/);
  assert.match(content.innerHTML, /emblemNoBuild/);
  await toggle();
  assert.equal(calls, 1, "reopening reuses the current scoped carrier response");
});
