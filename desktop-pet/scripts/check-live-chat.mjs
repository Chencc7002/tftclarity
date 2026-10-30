import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-output'); mkdirSync(output, { recursive: true });
const env = { ...process.env, TFT_PET_DATA_DIR: resolve(output, 'live-profile-' + Date.now()) }; delete env.ELECTRON_RUN_AS_NODE; delete env.TFT_PET_SITE;
const report = { kind: 'real-model-desktop-chat', at: new Date().toISOString(), checks: [] }; let app, chat;
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--pet-test'], env, timeout: 30000 });
  const pet = await app.firstWindow(); await pet.waitForFunction(() => document.getElementById('pet')?.dataset.petId === 'prestige-gwen');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
  await app.context().addInitScript(() => {
    localStorage.setItem('tftagent.onboarding.v1', JSON.stringify({ version: 1, status: 'dismissed' }));
    window.__petLive = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (/\/api\/(?:react-chat|recommend)\/stream/.test(String(args[0]))) {
        const request = JSON.parse(args[1].body);
        response.clone().text().then(text => window.__petLive.push({ request, text, status: response.status }));
      }
      return response;
    };
  });
  for (let i = 0; i < 50 && !await app.evaluate(() => Boolean(global.__petTest)); i++) await new Promise(r => setTimeout(r, 100));
  await app.evaluate(({ ipcMain }) => { global.__phaseTrace = []; ipcMain.on('chat:status', (_e, phase) => global.__phaseTrace.push(phase)); });
  const next = app.waitForEvent('window'); await app.evaluate(() => global.__petTest.showChat()); chat = await next;
  await app.evaluate(() => { global.__petTest.chat.hide(); global.__petTest.pet.hide(); });
  const errors = []; chat.on('pageerror', e => errors.push(e.message));
  await chat.waitForSelector('#query-input', { timeout: 30000 });
  await chat.waitForLoadState('load', { timeout: 30000 });
  await chat.waitForSelector('.welcome-message', { state: 'attached', timeout: 30000 });
  console.log('PASS website application initialized');
  const runtime = await chat.evaluate(async () => (await fetch('/api/runtime')).json());
  const provenance = (runtime.runtime ?? runtime).acceptanceProvenance;
  report.provenance = provenance; assert.equal(provenance.fixtureMode, false); assert.equal(provenance.decisionProviderMode, 'real_model');
  const marker = '海蓝' + randomUUID().slice(0, 8); report.marker = marker;
  async function send(text) {
    const count = await chat.evaluate(() => window.__petLive.length);
    await chat.evaluate(text => {
      const input = document.querySelector('#query-input'); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); input.closest('form').requestSubmit();
    }, text);
    await chat.waitForFunction(n => window.__petLive.length > n, count, { timeout: 120000, polling: 100 });
    const result = await chat.evaluate(() => window.__petLive.at(-1));
    report.lastInput = result.request.input;
    assert.equal(result.request.input, text);
    assert.equal(result.status, 200);
    const events = result.text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const payload = events.find(e => e.type === 'complete')?.payload;
    assert.equal(payload?.ok, true);
    const answer = typeof payload.answer === 'string' ? payload.answer : payload.assistantResponse?.text ?? payload.text ?? JSON.stringify(payload.answer);
    assert.ok(answer.includes(marker), answer.slice(0, 500));
    await chat.waitForFunction(() => document.querySelector('#stop-button').classList.contains('hidden'), null, { polling: 100 });
    await pet.waitForFunction(marker => document.getElementById('bubble').textContent.includes(marker), marker, { polling: 100, timeout: 15000 });
    report.checks.push('native bubble contains the actual real-model answer');
    return { answer, request: result.request };
  }
  const first = await send(`请记住这次聊天的临时代号是 ${marker}。只回复这个代号，不补充其他内容。`);
  console.log('PASS real first reply:', first.answer); report.checks.push('real model replies in native chat window');
  await app.evaluate(() => global.__petTest.chat.close()); assert.equal(await app.evaluate(() => global.__petTest.chat.isVisible()), false);
  await app.evaluate(() => global.__petTest.showChat());
  await app.evaluate(() => { global.__petTest.chat.hide(); global.__petTest.pet.hide(); });
  const second = await send('刚才的临时代号是什么？只回复代号。');
  assert.equal(second.request.conversationId, first.request.conversationId);
  assert.ok(second.request.messages.some(m => m.content.includes(marker)));
  console.log('PASS follow-up after hiding/reopening:', second.answer); report.checks.push('same conversation ID and history survive close/reopen; model recalls marker');
  report.answers = [first.answer, second.answer]; report.sentHistoryMessages = second.request.messages.length;
  const snapshot = await app.evaluate(() => global.__petTest.snapshot());
  assert.equal(snapshot.affinity.turns, 2); report.checks.push('two successful turns produce exactly two companion rewards');
  await app.evaluate(() => { global.__petTest.pet.showInactive(); global.__petTest.chat.showInactive(); });
  await chat.screenshot({ path: resolve(output, 'live-chat.png'), timeout: 10000 });
  await pet.screenshot({ path: resolve(output, 'live-gwen.png'), omitBackground: true, timeout: 10000 });
  report.errors = errors; assert.deepEqual(errors, []); report.ok = true;
  report.phases = await app.evaluate(() => global.__phaseTrace); assert.ok(report.phases.includes('thinking')); assert.ok(report.phases.includes('done'));
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  if (chat) { report.ui = await chat.evaluate(() => ({ stop: document.querySelector('#stop-button')?.outerHTML, status: document.querySelector('#status')?.outerHTML, replies: window.__petLive?.map(r => ({ status: r.status, text: r.text.slice(-1500) })) })); }
  if (app) report.phases = await app.evaluate(() => global.__phaseTrace);
}
finally { if (app) await app.close(); writeFileSync(resolve(output, 'live-chat-check.json'), JSON.stringify(report, null, 2)); }
