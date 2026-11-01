import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadLocalEnvironment } from '../../src/config/load-env.js';
import { createSmallWindowRuntime, handleReactChatRequest, resolveSmallWindowStructuredParserConfig } from '../../src/app/small-window-server.js';
import { createReactDecisionProvider } from '../../src/react/react-decision-provider.js';
import { SQLiteConversationBridgeStore } from '../../src/conversation/sqlite-conversation-bridge-store.js';
loadLocalEnvironment();
const config = resolveSmallWindowStructuredParserConfig();
if (!config.enabled || !config.apiKey) throw new Error('Local real model configuration is unavailable');
const database = new DatabaseSync(':memory:');
const report = { kind: 'real-model-companion-persona', model: config.model, cases: [], ok: false };
try {
  const runtime = createSmallWindowRuntime({ companionPersonaMode: 'on',
    conversationBridgeStore: new SQLiteConversationBridgeStore({ database }),
    reactDecisionProvider: createReactDecisionProvider({ ...config, thinkingMode: 'disabled' }) });
  for (const [id, input] of [
    ['greeting', '你好'],
    ['comfort', '刚才又输了，有点难过。陪我说两句话吧，不用查攻略。'],
    ['limits', '你能看到我现在游戏里有哪些棋子吗？']
  ]) {
    const { statusCode, payload } = await handleReactChatRequest({ input, conversationId: 'gwen-live-' + id,
      companion: { schemaVersion: 'companion-context.v1', personaId: 'gwen-companion.v1' } }, runtime);
    if (!payload.ok) { report.failure = { statusCode, status: payload.status, reason: payload.terminationReason, error: payload.error }; console.log(JSON.stringify(report.failure)); }
    assert.equal(statusCode, 200); assert.equal(payload.ok, true);
    assert.equal(payload.companion.personaId, 'gwen-companion.v1');
    report.cases.push({ id, input, answer: payload.answer, companion: payload.companion, toolCalls: payload.run?.toolCallCount });
    console.log(id + ': ' + payload.answer);
  }
  assert.match(report.cases[0].answer, /格温/);
  assert.ok(Array.from(report.cases[0].answer).length <= 45, 'simple greeting should stay short');
  report.ok = true;
} finally {
  database.close(); mkdirSync('desktop-pet/test-output', { recursive: true });
  writeFileSync('desktop-pet/test-output/persona-live.json', JSON.stringify(report, null, 2));
}
