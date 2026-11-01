import test from 'node:test';
import assert from 'node:assert/strict';
import { createBubbleLifetime, readingDuration } from '../bubble-lifetime.mjs';
test('reading time scales with Unicode characters and has usable lower and upper limits', () => {
  assert.equal(readingDuration('你好'), 4000);
  assert.equal(readingDuration('字'.repeat(40)), 7700);
  assert.equal(readingDuration('字'.repeat(200)), 15000);
  assert.equal(readingDuration('🙂'.repeat(40)), 7700);
});
test('render ticks do not renew deadlines; old text stays hidden after an interaction', () => {
  let time = 0; const timer = createBubbleLifetime({ now: () => time });
  assert.equal(timer.visible('你好', 'turn-0'), true);
  time = 3900; assert.equal(timer.visible('你好', 'turn-0'), true);
  time = 4100; assert.equal(timer.visible('你好', 'turn-0'), false);
  assert.equal(timer.visible('摸头回应', 'interaction-1'), true);
  assert.equal(timer.visible('你好', 'turn-0'), false);
  assert.equal(timer.visible('你好', 'turn-1'), true);
  time = 60000; assert.equal(timer.visible('查询中', 'busy-2', true), true);
  time = 120000; assert.equal(timer.visible('查询中', 'busy-2', true), true);
  assert.equal(timer.visible('完成', 'done-3'), true);
});
