import test from 'node:test';
import assert from 'node:assert/strict';
import voice from '../windows-voice.cjs';

test('Windows voice launcher uses a fixed shortcut, foreground guard and hidden process', async () => {
  let invocation;
  const result = await voice.launchWindowsVoice(123n, { platform: 'win32', run: (...args) => { invocation = args; args[3](null); } });
  assert.deepEqual(result, { ok: true });
  const [executable, args, options] = invocation;
  assert.ok(executable.endsWith('powershell.exe'));
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(args[3], /GetForegroundWindow\(\).ToInt64\(\) != handle/);
  assert.match(args[3], /0x5B, 0x48, 0x48, 0x5B/);
  assert.equal(options.windowsHide, true);
  assert.equal(options.env.TFT_PET_VOICE_HWND, '123');
  assert.equal(options.timeout, 10000);
});

test('unsupported platforms, invalid handles and native failure do not claim listening', async () => {
  const unexpected = () => assert.fail('must not launch');
  assert.equal((await voice.launchWindowsVoice(1n, { platform: 'linux', run: unexpected })).ok, false);
  assert.equal((await voice.launchWindowsVoice(0n, { platform: 'win32', run: unexpected })).ok, false);
  const result = await voice.launchWindowsVoice(1n, { platform: 'win32', run: (...args) => args[3](new Error('focus changed')) });
  assert.equal(result.ok, false);
  assert.match(result.error, /Win\+H/);
});
