import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getPatchNote } from "../src/app/small-window-ui/patch-notes.js";

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
