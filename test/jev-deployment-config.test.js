import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");

test("production Compose limits Jev credentials to the app service", () => {
  const compose = read("compose.yaml");
  const app = compose.split("\n  worker:", 1)[0];
  const nonApp = compose.slice(compose.indexOf("\n  worker:"));
  assert.match(app, /- path: \.env\.jev\.production\n\s+required: false/u);
  assert.doesNotMatch(nonApp, /\.env\.jev\.production/u);
});

test("Jev production template is bounded, off by default and cannot be committed with a real key", () => {
  const template = read(".env.jev.production.example");
  assert.match(template, /^TYPESAFE_API_KEY=replace-me$/mu);
  assert.match(template, /^TFT_AGENT_JEV_INTENT_MODE=off$/mu);
  assert.match(template, /^TFT_AGENT_JEV_INTENT_TIMEOUT_MS=1500$/mu);
  assert.match(template, /^TFT_AGENT_JEV_INTENT_SAMPLE_RATE=0\.05$/mu);
  assert.match(template, /^TFT_AGENT_JEV_INTENT_MAX_REQUESTS=100$/mu);
  assert.match(template, /^TFT_AGENT_JEV_INTENT_CONTROL_MIN_CONFIDENCE=0\.70$/mu);
  const gitignore = read(".gitignore");
  const dockerignore = read(".dockerignore");
  assert.match(gitignore, /^\.env\.\*$/mu);
  assert.match(gitignore, /^!\.env\.jev\.production\.example$/mu);
  assert.match(dockerignore, /^\.env\.\*$/mu);
});
