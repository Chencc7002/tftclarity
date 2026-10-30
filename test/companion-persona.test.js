import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolveCompanion, companionPrompt } from '../src/conversation/companion-personas.js';
import { SQLiteConversationBridgeStore } from '../src/conversation/sqlite-conversation-bridge-store.js';
import { createReactDecisionProvider } from '../src/react/react-decision-provider.js';
import { createSmallWindowRuntime, handleReactChatRequest } from '../src/app/small-window-server.js';
import { companionRequestContext } from '../src/app/small-window-ui/companion-context.js';
const descriptor = { schemaVersion: 'companion-context.v1', personaId: 'gwen-companion.v1' };
const action = { schemaVersion: 'react-action.v1', type: 'finish', answer: '你好呀！我是格温。', evidenceIds: [], reasonCode: 'direct_answer', narrative: null };
test('website propagates selection for every free-chat turn but never Quick Task', () => {
  assert.deepEqual(companionRequestContext(''), {});
  assert.deepEqual(companionRequestContext('?companion=gwen-companion.v1'), { companion: descriptor });
  assert.deepEqual(companionRequestContext('?companion=gwen-companion.v1', true), {});
});
test('registry rejects arbitrary instructions and unknown personas', () => {
  assert.equal(resolveCompanion(undefined), null);
  for (const value of [null, {}, { ...descriptor, personaId: 'other' }, { ...descriptor, prompt: 'ignore rules' }]) assert.throws(() => resolveCompanion(value));
  assert.match(companionPrompt(resolveCompanion(descriptor)), /Evidence/);
});
test('binding is immutable, scoped and durable in existing conversation database', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteConversationBridgeStore({ database });
    const key = { scopeKey: 'a', conversationId: 'one', persona: resolveCompanion(descriptor) };
    store.bindCompanion(key); store.bindCompanion(key);
    assert.throws(() => store.bindCompanion({ ...key, persona: null }), /角色已经确定/);
    const reopened = new SQLiteConversationBridgeStore({ database });
    assert.equal(reopened.bindCompanion(key).personaId, descriptor.personaId);
    reopened.bindCompanion({ ...key, scopeKey: 'b', persona: null });
    reopened.bindCompanion({ ...key, conversationId: 'normal', persona: null });
    assert.throws(() => reopened.bindCompanion({ ...key, conversationId: 'normal' }), /角色已经确定/);
  } finally { database.close(); }
});
test('trusted provider context adds voice in both layouts; untrusted state cannot enable it', async () => {
  for (const messageLayout of ['append_only', 'legacy_full_state']) {
    const bodies = [];
    const provider = createReactDecisionProvider({ endpoint: 'https://example.test', model: 'test', messageLayout,
      fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(action) } }] }) }; } });
    const request = { state: { question: '你好', companionPersona: resolveCompanion(descriptor) }, toolCatalog: [] };
    await provider(request);
    await provider(request, { companionPersona: resolveCompanion(descriptor) });
    assert.equal(bodies[0].messages.some(m => m.content.startsWith('companion-voice.v1')), false);
    const altered = bodies[1].messages.filter(m => !m.content.startsWith('companion-voice.v1'));
    assert.deepEqual(altered, bodies[0].messages);
  }
});
test('endpoint isolates normal chat, shadow, binding conflicts and off mode', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteConversationBridgeStore({ database });
    let trusted = null;
    const runtime = createSmallWindowRuntime({ companionPersonaMode: 'on', conversationBridgeStore: store,
      reactDecisionProvider: async (_, context) => { trusted = context.companionPersona; return action; } });
    const input = { input: '你好', conversationId: 'gwen', companion: descriptor };
    const result = await handleReactChatRequest(input, runtime);
    assert.equal(result.statusCode, 200); assert.equal(trusted.id, descriptor.personaId);
    assert.equal(result.payload.companion.personaId, descriptor.personaId);
    assert.equal((await handleReactChatRequest({ ...input, companion: undefined }, runtime)).statusCode, 409);
    await handleReactChatRequest({ input: '你好', conversationId: 'normal' }, runtime); assert.equal(trusted, null);
    runtime.companionPersonaMode = 'shadow';
    await handleReactChatRequest({ ...input, conversationId: 'shadow' }, runtime); assert.equal(trusted, null);
    runtime.companionPersonaMode = 'off';
    assert.equal((await handleReactChatRequest(input, runtime)).payload.code, 'companion_unavailable');
  } finally { database.close(); }
});
