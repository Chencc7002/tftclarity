import test from "node:test";
import assert from "node:assert/strict";
import { createExperienceGuidance, createManualInputTracker, GUIDANCE_STORAGE_KEY } from "../src/app/small-window-ui/experience-guidance.js";
import { createToolPreferences } from "../src/app/small-window-ui/quick-tool-preferences.js";

const DAY = 86_400_000;
function fixture(options = {}) {
  let time = 10 * DAY;
  let blocked = false;
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const events = [];
  const manager = createExperienceGuidance({ storage: () => storage, now: () => time,
    blocked: () => blocked, onEvent: event => events.push(event), ...options });
  const visible = new Set();
  const offer = (id, extra = {}) => manager.offer({ id, family: id === "voice" ? "voice" : "favorite",
    priority: id === "voice" ? 20 : 10, eligible: () => true,
    show: () => visible.add(id), hide: () => visible.delete(id), ...extra });
  return { manager, offer, visible, storage, values, events, now: () => time,
    advance(ms) { time += ms; }, block(value) { blocked = value; manager.refresh(); } };
}

test("manual text requires more than 20 Unicode characters and excludes paste/transcript", () => {
  const tracker = createManualInputTracker();
  const type = value => tracker.edit({ value, isTrusted: true, inputType: "insertText" });
  for (let n = 1; n <= 20; n++) assert.equal(type("字".repeat(n)), false);
  assert.equal(type("字".repeat(21)), true);
  assert.equal(tracker.edit({ value: "字".repeat(20), isTrusted: true, inputType: "deleteContentBackward" }), false);
  assert.equal(tracker.edit({ value: "字".repeat(90), isTrusted: true, inputType: "insertFromPaste" }), false);
  assert.equal(type("字".repeat(91)), false);
  assert.equal(tracker.edit({ value: "字".repeat(120), isTrusted: false, inputType: "insertText" }), false);
  tracker.reset();
  assert.equal(type("😀".repeat(20)), false);
  assert.equal(type("😀".repeat(21)), true);
});

test("IME replacements count actual length instead of repeated composition payloads", () => {
  const tracker = createManualInputTracker();
  const edit = value => tracker.edit({ value, isTrusted: true, inputType: "insertCompositionText" });
  assert.equal(edit("字".repeat(19)), false);
  assert.equal(edit("字".repeat(19) + "ni"), true);
  assert.equal(edit("字".repeat(19) + "你"), false);
  assert.equal(edit("字".repeat(19) + "你好"), true);
});

test("editing a long programmatic prefill does not count the prefill as manual typing", () => {
  const tracker = createManualInputTracker();
  tracker.beforeEdit("prefilled question ".repeat(10));
  assert.equal(tracker.edit({ value: "prefilled question ".repeat(10) + "a", isTrusted: true, inputType: "insertText" }), false);
});

test("priority, shared cooldown and mutual exclusion coordinate both families", async () => {
  const f = fixture();
  f.offer("favorite:unit-builds"); f.offer("voice");
  await Promise.resolve();
  assert.deepEqual([...f.visible], ["voice"]);
  f.manager.respond("voice", "later");
  f.manager.refresh();
  assert.equal(f.visible.size, 0);
  f.advance(31 * 60_000);
  f.offer("favorite:unit-builds");
  await Promise.resolve();
  assert.deepEqual([...f.visible], ["favorite:unit-builds"]);
});

test("blocked and expired candidates never consume an impression or legacy claim", async () => {
  const f = fixture(); let claims = 0;
  f.block(true);
  f.offer("favorite:unit-builds", { show: () => { claims++; } });
  await Promise.resolve();
  assert.equal(claims, 0);
  assert.equal(f.manager.snapshot().lastShownAt, 0);
  f.advance(121000); f.block(false);
  assert.equal(claims, 0);
  f.offer("voice", { show: () => false });
  await Promise.resolve();
  assert.equal(f.manager.snapshot().lastShownAt, 0);
});

test("dismissal, completion and global opt-out survive reload while contextual navigation stays observable", async () => {
  const f = fixture();
  f.offer("voice"); await Promise.resolve();
  f.manager.respond("voice", "never");
  f.advance(8 * DAY);
  const next = createExperienceGuidance({ storage: () => f.storage, now: f.now });
  let shown = false;
  next.offer({ id: "voice", family: "voice", eligible: () => true, show: () => { shown = true; }, hide() {} });
  await Promise.resolve(); assert.equal(shown, false);
  next.setEnabled(false);
  next.contextual("shown", "private-response-id");
  next.contextual("shown", "private-response-id");
  next.contextual("accepted", "private-response-id:1");
  const state = next.snapshot();
  assert.equal(state.counts.followup.shown, 1);
  assert.equal(state.counts.followup.accepted, 1);
  assert.doesNotMatch(f.values.get(GUIDANCE_STORAGE_KEY), /private-response-id/);
  next.complete("voice", "voice");
  assert.equal(next.snapshot().records.voice.completed, true);
});

test("another tab can disable an active prompt and write failures retain session opt-out", async () => {
  const f = fixture(); f.offer("voice"); await Promise.resolve();
  const other = createExperienceGuidance({ storage: () => f.storage, now: f.now });
  other.setEnabled(false); f.manager.refresh();
  assert.equal(f.visible.size, 0);
  const manager = createExperienceGuidance({ storage: () => ({
    getItem: () => JSON.stringify({ version: 1, enabled: true }),
    setItem() { throw new Error("quota exceeded"); }
  }) });
  manager.setEnabled(false);
  assert.equal(manager.snapshot().enabled, false);
});

test("shadow candidate evaluation has no presentation, persistence or domain side effects", async () => {
  const f = fixture({ mode: "shadow" }); let claims = 0;
  f.offer("voice", { show() { claims++; } });
  await Promise.resolve();
  assert.equal(claims, 0);
  assert.equal(f.values.size, 0);
  assert.deepEqual(f.events, [{ family: "voice", event: "shadow_candidate" }]);
});

test("legacy favorite preferences keep their original gates and only claim when displayed", async () => {
  const f = fixture();
  const prefs = createToolPreferences({ ids: ["unit-builds"], storage: () => f.storage, now: f.now });
  prefs.recordUse("unit-builds"); prefs.recordUse("unit-builds");
  f.advance(DAY); prefs.recordUse("unit-builds");
  assert.equal(prefs.reminderEligible("unit-builds"), true);
  f.block(true);
  f.offer("favorite:unit-builds", { show: () => prefs.claimReminder("unit-builds") });
  await Promise.resolve();
  assert.equal(prefs.snapshot().lastPromptAt, 0);
  f.block(false);
  assert.equal(prefs.snapshot().lastPromptAt, f.now());
  f.manager.respond("favorite:unit-builds", "never"); prefs.dismissReminder("unit-builds", true);
  f.advance(9 * DAY);
  assert.equal(prefs.reminderEligible("unit-builds"), false);
});
