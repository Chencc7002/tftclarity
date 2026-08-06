import test from "node:test";
import assert from "node:assert/strict";
import {
  clientPatchFromVersion,
  patchLabelFromVersion
} from "../services/opgg/patch.mjs";

test("OP.GG client builds map to TFT Set 17 patch labels", () => {
  const version = "Linux Version 16.14.794.9266 <Releases/16.14>";
  assert.equal(clientPatchFromVersion(version), "16.14");
  assert.equal(patchLabelFromVersion(version, { setNumber: 17 }), "17.8");
  assert.equal(
    patchLabelFromVersion("Linux Version 16.13.1 <Releases/16.13>", { setNumber: 17 }),
    "17.7"
  );
});

test("unknown set alignments retain the stable client patch", () => {
  assert.equal(patchLabelFromVersion("15.16.1", { setNumber: 17 }), "15.16");
  assert.equal(patchLabelFromVersion("15.16.1", { setNumber: 16 }), "15.16");
  assert.equal(patchLabelFromVersion(null, { setNumber: 17 }), null);
});
