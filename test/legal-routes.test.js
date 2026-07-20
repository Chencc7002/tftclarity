import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { safeStaticPath } from "../src/app/small-window-server.js";

test("extensionless legal URLs resolve to public HTML files", () => {
  assert.equal(basename(safeStaticPath("/privacy")), "privacy.html");
  assert.equal(basename(safeStaticPath("/privacy/")), "privacy.html");
  assert.equal(basename(safeStaticPath("/terms")), "terms.html");
  assert.equal(basename(safeStaticPath("/terms/")), "terms.html");
});
