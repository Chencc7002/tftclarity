import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNarration } from '../narration.mjs';
const copy = JSON.parse(readFileSync(new URL('../assets/prestige-gwen/pet.json', import.meta.url))).narration;
test('narration stays stable per phase, uses elapsed waiting and preserves actual answers', () => {
  let time = 0;
  const voice = createNarration(copy, { now: () => time, random: () => 0 });
  assert.equal(voice.update({ serial: 0, phase: 'idle' }), copy.greeting);
  const busy = { serial: 1, phase: 'thinking' };
  assert.equal(voice.update(busy), copy.thinking[0]);
  time = 1600; assert.equal(voice.update(busy), copy.querying[0]);
  time = 13000; assert.equal(voice.update(busy), copy.slow[0]);
  time = 60000; assert.equal(voice.update(busy), copy.slow[0]);
  assert.equal(voice.update({ serial: 2, phase: 'done', answerPreview: '真实答案' }), '真实答案');
  assert.equal(voice.update({ serial: 3, phase: 'idle', narrationKey: 'stopped' }), copy.stopped[0]);
  assert.equal(voice.update({ serial: 4, phase: 'failed' }), copy.failed[0]);
  assert.equal(voice.update({ serial: 5, phase: 'thinking' }), copy.thinking[0]);
});
