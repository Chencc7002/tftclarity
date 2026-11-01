import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSmallWindowRuntime, handleReactChatRequest } from '../src/app/small-window-server.js';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('desktop source is excluded from website builds and root dependencies', () => {
  assert.match(read('.dockerignore'), /^desktop-pet\/$/m);
  const root = JSON.parse(read('package.json'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) assert.equal(root[section]?.electron, undefined);
  assert.doesNotMatch(read('Dockerfile'), /COPY\s+desktop-pet/);
  assert.match(read('desktop-pet/.gitignore'), /^\*\.glb$/m);
  assert.match(read('desktop-pet/.gitignore'), /^portable-data\/$/m);
});
test('default runtime rejects companion activation before any model call', async () => {
  let calls = 0;
  const runtime = createSmallWindowRuntime({ reactDecisionProvider: async () => { calls++; throw new Error('should not call'); } });
  const result = await handleReactChatRequest({ input: '你好', conversationId: 'disabled-desktop', companion: { schemaVersion: 'companion-context.v1', personaId: 'gwen-companion.v1' } }, runtime);
  assert.equal(result.statusCode, 503); assert.equal(result.payload.code, 'companion_unavailable'); assert.equal(calls, 0);
});
