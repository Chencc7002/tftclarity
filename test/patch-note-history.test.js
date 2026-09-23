import { createRequire } from "node:module";
import { createSeasonContextService } from "../src/season/season-context.js";
import vm from "node:vm";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getCurrentPatchNote, getPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = (name) => fs.readFileSync(path.join(here, "../src/app/small-window-ui", name), "utf8");

test("18.1 announcement exposes a numeric-only traceable revision chain", () => {
  const patch = getPatchNote("18.1", "zh-CN");
  assert.equal(patch.updatedAt, "2026-08-31");
  assert.deepEqual(
    patch.history.map(({ id, parentId }) => ({ id, parentId })),
    [{ id: "18.1-balance-2026-08-31", parentId: null }]
  );
  const changes = patch.history.flatMap((revision) => revision.groups.flatMap((group) => group.changes));
  assert.equal(changes.length, 15);
  assert.equal(new Set(changes.map((change) => change.id)).size, changes.length);
  assert.equal(changes.every((change) => ["buff", "nerf"].includes(change.direction)), true);
  assert.equal(changes.every((change) => change.before && change.after), true);
  assert.equal(changes.filter((change) => change.direction === "buff").length, 7);
  assert.equal(changes.filter((change) => change.direction === "nerf").length, 8);
  assert.equal(changes.find((change) => change.id.endsWith("amumu-heal")).after, "2.5%");
  assert.deepEqual(
    changes.find((change) => change.id.endsWith("amumu-heal")).entityApiNames,
    ["DA_Amumu18"]
  );
  assert.equal(patch.history.every((revision) => revision.sourceUrl.includes("teamfighttactics.leagueoflegends.com")), true);
});

test("numeric change localization preserves trace identifiers and values", () => {
  const zh = getPatchNote("18.1", "zh-CN");
  const en = getPatchNote("18.1", "en-US");
  assert.deepEqual(en.history.map((revision) => revision.id), zh.history.map((revision) => revision.id));
  assert.deepEqual(en.history.map((revision) => revision.parentId), zh.history.map((revision) => revision.parentId));
  assert.match(en.history[0].title, /balance update/u);
  assert.match(en.history[0].groups[0].changes.at(-1).body, /Lux/u);
  assert.equal(en.history[0].groups[0].changes.at(-1).after, "8%");
});

test("announcement renderer exposes trace anchors and buff/nerf visuals", () => {
  const app = ui("app.js");
  const styles = ui("styles.css");
  assert.match(app, /data-revision-id/u);
  assert.match(app, /data-parent-revision-id/u);
  assert.match(app, /href="#\$\{escapeHtml\(change\.id\)\}"/u);
  assert.match(app, /patch-change-values/u);
  assert.match(app, /theme\?\.patchNoteVersion \?\? CURRENT_PATCH_VERSION/u);
  assert.match(styles, /\.patch-history-node::before/u);
  assert.match(styles, /\.patch-change\.is-buff/u);
  assert.match(styles, /\.patch-change\.is-nerf/u);
  assert.match(styles, /\.patch-history-groups li:target/u);
});

test("18.3 is reachable from the active season and matches the mini program", () => {
  const season = createSeasonContextService().listPublic().find((record) => record.id === "set18-live");
  const patch = getPatchNote(season.theme.patchNoteVersion, "zh-CN");
  const mini = createRequire(import.meta.url)("../miniprogram/data/patch-notes.js");
  assert.equal(patch.version, "18.3");
  assert.deepEqual(patch, getCurrentPatchNote());
  assert.equal(patch.publishedAt, "2026-09-22T18:00:00.000Z");
  assert.equal(patch.updatedAt, "2026-09-23");
  assert.match(season.notices[0], /18\.3 版本已上线/u);
  assert.match(season.theme.subtitle["en-US"], /18\.3/u);
  const changes = patch.history.flatMap((revision) => revision.groups.flatMap((group) => group.changes));
  assert.equal(changes.length, 74);
  assert.equal(new Set(changes.map((change) => change.id)).size, changes.length);
  assert.deepEqual(mini.history.filter((revision) => revision.id.startsWith("18.3-")).flatMap((revision) => revision.changes).map(({ id, direction, before, after, label }) => ({ id, direction, before, after, body: label })), changes.map(({ id, direction, before, after, body }) => ({ id, direction, before, after, body })));
  assert.equal(mini.sourceUrl, patch.sourceUrl);
  const en = getCurrentPatchNote("en-US");
  assert.deepEqual(en.history.flatMap((r) => r.groups.flatMap((g) => g.changes)).map(({ body, ...change }) => change), changes.map(({ body, ...change }) => change));
});

test("18.2 distinguishes mixed tuning and excludes tooltip-only buffs", () => {
  const changes = getPatchNote("18.2").history.flatMap((r) => r.groups.flatMap((g) => g.changes));
  const find = (id) => changes.find((change) => change.id === `18.2-release-2026-09-09-${id}`);
  assert.equal(find("xp-8").after, "56");
  assert.equal(find("ahri-damage").direction, "buff");
  assert.equal(find("ahri-falloff").direction, "nerf");
  assert.equal(find("edge-of-night").direction, "mixed");
  assert.equal(find("taric-shield-base").direction, "nerf");
  assert.equal(find("taric-shield-hp").direction, "buff");
  assert.equal(find("combust-cost").direction, "buff");
  assert.equal(find("combust-damage").direction, "nerf");
  assert.equal(changes.some((change) => /veigar/iu.test(change.id)), false);
  assert.match(ui("app.js"), /mixed: "patchNotesMixed"/u);
});

test("announcement timeline preserves 18.1 with its own values, anchors, and source", () => {
  const messages = vm.runInNewContext(`${ui("i18n.js").replaceAll("export ", "")}\nmessages`, {
    localStorage: { getItem: () => null }
  });
  for (const locale of ["zh-CN", "en-US"]) {
    const timeline = getPatchNoteTimeline("18.2", locale);
    const old = getPatchNote("18.1", locale).history;
    assert.deepEqual(timeline.history.slice(0, old.length), old);
    assert.equal(timeline.history[old.length].parentId, old.at(-1).id);
    assert.equal(timeline.history.at(-1).sourceUrl.endsWith("teamfight-tactics-patch-18-2/"), true);
    assert.equal(timeline.history[0].sourceUrl.endsWith("teamfight-tactics-patch-18-1/"), true);
    assert.equal(timeline.history.flatMap((r) => r.groups.flatMap((g) => g.changes)).length, 186);
    assert.deepEqual(getPatchNoteTimeline("18.1", locale).history, old);
    assert.equal(getPatchNote("18.2", locale).history.length, 2);
    for (const key of ["patchNotesRelease", "patchNotesBalance", "patchNotesHotfix", "patchNotesMixed"]) {
      assert.ok(messages[locale][key], `${locale}: missing ${key}`);
    }
  }
  assert.equal(getPatchNoteTimeline("99.1"), null);
  assert.match(ui("app.js"), /getPatchNoteTimeline\(version, getLocale\(\)\)/u);
});
