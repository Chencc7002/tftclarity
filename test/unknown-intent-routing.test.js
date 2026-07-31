import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog, evaluateClarification, parseQuery } from "../src/index.js";

test("unknown deterministic input never defaults to unit build rankings", () => {
  const catalog = createCatalog();
  const parsed = parseQuery("这个体系补什么外援", { catalog });
  assert.equal(parsed.intent, "unknown");
  const clarification = evaluateClarification(
    parsed,
    { ...parsed, intent: "unknown" },
    { valid: false, errors: ["unit is required"], warnings: [] },
    { catalog }
  );
  assert.equal(clarification.blocking, false);
  assert.equal(clarification.reason, "semantic_parse_required");
});
