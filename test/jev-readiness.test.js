import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Jev preflight is secret-free and rejects unusable shadow/control configuration", () => {
  const script = fileURLToPath(new URL("../scripts/check-jev-readiness.mjs", import.meta.url));
  for (const [config, expected] of [
    [{ TFT_AGENT_JEV_INTENT_MODE: "off" }, 0],
    [{ TFT_AGENT_JEV_INTENT_MODE: "shadow" }, 1],
    [{ TFT_AGENT_JEV_INTENT_MODE: "shadow", TYPESAFE_API_KEY: "test-private-key" }, 0],
    [{ TFT_AGENT_JEV_INTENT_MODE: "control", TYPESAFE_API_KEY: "test-private-key" }, 0],
    [{ TFT_AGENT_JEV_INTENT_MODE: "invalid", TYPESAFE_API_KEY: "test-private-key" }, 1],
    [{ TFT_AGENT_JEV_INTENT_MODE: "shadow", TYPESAFE_API_KEY: "test-private-key", TFT_AGENT_JEV_INTENT_MAX_REQUESTS: "0" }, 1]
  ]) {
    const child = spawnSync(process.execPath, [script], { encoding: "utf8", env: {
      ...process.env, TYPESAFE_API_KEY: "", TFT_AGENT_JEV_INTENT_TIMEOUT_MS: "1500",
      TFT_AGENT_JEV_INTENT_SAMPLE_RATE: "1", TFT_AGENT_JEV_INTENT_MAX_REQUESTS: "100",
      TFT_AGENT_JEV_INTENT_CONTROL_MIN_CONFIDENCE: "0.7", ...config
    } });
    assert.equal(child.status, expected, child.stderr);
    assert.equal(JSON.parse(child.stdout).calls, 0);
    assert.ok(!child.stdout.includes("test-private-key"));
  }
});
