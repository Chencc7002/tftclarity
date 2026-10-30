import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../window-policy.cjs';
import { emptyAffinity, applyInteraction } from '../vendor/dsh-pet/affinity.mjs';
import { PetStateMachine } from '../vendor/dsh-pet/state.mjs';
test('remote chat accepts only TFTClarity or an explicit loopback development server', () => {
  assert.equal(policy.allowedSite(), 'https://tftclarity.cn/');
  assert.equal(policy.allowedSite('http://127.0.0.1:17317/'), 'http://127.0.0.1:17317/');
  for (const url of ['https://tftclarity.cn.evil.example/', 'https://tftclarity.cn@evil.example', 'file:///C:/test.html', 'http://192.168.1.1/', 'https://a:b@tftclarity.cn/']) assert.throws(() => policy.allowedSite(url));
  assert.equal(policy.publicLink('javascript:alert(1)'), false);
  assert.equal(policy.publicLink('file:///C:/test.html'), false);
});
test('restored pet stays inside a valid monitor work area, including negative monitor coordinates', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(policy.clampBounds({ x: -2500, y: 9999, width: 320, height: 380 }, area), { x: -1920, y: 660, width: 320, height: 380 });
  assert.deepEqual(policy.clampBounds({ x: 9999, y: -50, width: 320, height: 380 }, area), { x: -320, y: 0, width: 320, height: 380 });
});
test('reused petting and feeding cooldowns preserve affinity without repeated rewards', () => {
  const first = applyInteraction(emptyAffinity(), 'pet', 1000);
  const repeated = applyInteraction(first.affinity, 'pet', 2000);
  assert.equal(first.delta, 1); assert.equal(repeated.delta, 0);
  const fed = applyInteraction(repeated.affinity, 'feed', 2000);
  assert.equal(fed.delta, 5); assert.equal(fed.affinity.points, 6);
  assert.equal(applyInteraction(fed.affinity, 'feed', 31999).accepted, false);
  assert.equal(applyInteraction(fed.affinity, 'feed', 32000).accepted, true);
});
test('reused animation mapping settles completion and failure back to idle', () => {
  let now = 10000; const machine = new PetStateMachine({}, () => now);
  machine.onActivityStatus({ phase: 'thinking' }); assert.equal(machine.render().animation, 'running');
  machine.onActivityStatus({ phase: 'done' }); assert.equal(machine.render().animation, 'jumping');
  now += 2500; assert.equal(machine.render().animation, 'idle');
  machine.onActivityStatus({ phase: 'failed' }); assert.equal(machine.render().animation, 'failed');
  now += 2500; assert.equal(machine.render().animation, 'idle');
});
