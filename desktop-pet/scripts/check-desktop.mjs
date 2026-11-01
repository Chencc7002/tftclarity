import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-output'); mkdirSync(output, { recursive: true });
const stamp = Date.now();
const html = `<!doctype html><meta charset="utf-8"><title>Companion test fixture</title><style>.hidden{display:none}</style>
<div id="status" data-state="ready">ready</div><form><input id="query-input"><button>Send</button></form><button id="stop-button" class="hidden">Stop</button><div id="messages"></div>
<script>let timer;const stop=document.getElementById('stop-button'),status=document.getElementById('status');
document.querySelector('form').onsubmit=e=>{e.preventDefault();document.getElementById('query-input').value='';status.dataset.state='loading';stop.classList.remove('hidden');timer=setTimeout(()=>{document.getElementById('messages').insertAdjacentHTML('beforeend','<article class="assistant-message"><div class="message-body"><div class="chat-conclusion">reply;</div></div></article>');status.dataset.state='ready';stop.classList.add('hidden')},350)};
stop.onclick=()=>{clearTimeout(timer);status.dataset.state='error';stop.classList.add('hidden')};</script>`;
const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const env = { ...process.env, TFT_PET_DATA_DIR: resolve(output, 'profile-' + stamp), TFT_PET_SITE: base }; delete env.ELECTRON_RUN_AS_NODE;
let app; const report = { kind: 'local-fixture-desktop-check', checks: [], errors: [] };
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS', name); }
try {
  app = await electron.launch({ executablePath: process.env.PET_TEST_EXE || resolve(root, 'node_modules/electron/dist/electron.exe'), args: process.env.PET_TEST_EXE ? ['--pet-test'] : [root, '--pet-test'], env, timeout: 30000 });
  const pet = await app.firstWindow(); pet.on('pageerror', e => report.errors.push(e.message));
  await pet.waitForFunction(() => document.getElementById('pet')?.dataset.petId === 'prestige-gwen');
  // __petTest is assigned after loadFile resolves.
  for (let i = 0; i < 50 && !await app.evaluate(() => Boolean(global.__petTest)); i++) await new Promise(r => setTimeout(r, 100));
  await pet.waitForFunction(() => document.getElementById('bubble').textContent === '你好');
  await check('greeting expires without moving the character or blocking transparent space', async () => {
    const before = await pet.locator('#pet').boundingBox();
    await pet.locator('#bubble').waitFor({ state: 'hidden', timeout: 7000 });
    assert.deepEqual(await pet.locator('#pet').boundingBox(), before);
    await pet.mouse.move(160, 30); await new Promise(r => setTimeout(r, 100));
    assert.equal(await app.evaluate(() => global.__petTest.clickThrough), true);
  });
  await check('native window is transparent, frameless, always on top and does not take keyboard focus', async () => {
    const flags = await app.evaluate(() => { const w = global.__petTest.pet; return { top: w.isAlwaysOnTop(), focusable: w.isFocusable(), frame: w.getNormalBounds(), prefs: w.webContents.getLastWebPreferences() }; });
    assert.equal(flags.top, true); assert.equal(flags.focusable, false); assert.equal(flags.prefs.nodeIntegration, false); assert.equal(flags.prefs.contextIsolation, true); assert.equal(flags.prefs.sandbox, true);
    const alpha = await app.evaluate(async () => { const img = await global.__petTest.pet.webContents.capturePage(); const b = img.toBitmap(); let transparent = 0, opaque = 0; for (let i = 3; i < b.length; i += 4) { if (b[i] === 0) transparent++; if (b[i] === 255) opaque++; } return { transparent, opaque }; });
    assert.ok(alpha.transparent > 10000); assert.ok(alpha.opaque > 1000); report.alpha = alpha;
  });
  await check('original GLB renders with transparent canvas corners', async () => {
    const pixels = await pet.locator('#pet').evaluate(c => { const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return { corner: p[3], visible: p.some((v, i) => i % 4 === 3 && v > 200) }; });
    assert.equal(pixels.corner, 0); assert.equal(pixels.visible, true);
  });
  await check('feeding reuses upstream affinity and cooldown', async () => {
    assert.equal(await pet.locator('.panel, #feed').count(), 0);
    await app.evaluate(() => global.__petTest.menuTemplate().find(item => item.id === 'feed').click());
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).affinity.points, 5);
    assert.equal(await app.evaluate(() => global.__petTest.menuTemplate().find(item => item.id === 'feed').enabled), false);
    await app.evaluate(() => global.__petTest.menuTemplate().find(item => item.id === 'feed').click());
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).affinity.points, 5);
  });
  async function revealControls() {
    const point = await pet.locator('#pet').evaluate(c => {
      const r = c.getBoundingClientRect(), data = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let y=100;y<c.height-20;y++) for(let x=100;x<c.width-20;x++) if(data[(y*c.width+x)*4+3]>200) return {x:r.x+x*r.width/c.width,y:r.y+y*r.height/c.height};
    });
    await pet.mouse.move(point.x,point.y); await pet.locator('#chat').waitFor({state:'visible'});
  }
  await check('controls hide away from pet and reappear on hover', async () => {
    await pet.mouse.move(1,1); await pet.locator('#chat').waitFor({state:'hidden',timeout:4000});
    await revealControls();
  });
  await check('transparent area enables native mouse pass-through; controls disable it', async () => {
    await pet.mouse.move(1, 1); await new Promise(r => setTimeout(r, 100)); assert.equal(await app.evaluate(() => global.__petTest.clickThrough), true);
    await revealControls(); await pet.locator('#chat').hover(); await new Promise(r => setTimeout(r, 100)); assert.equal(await app.evaluate(() => global.__petTest.clickThrough), false);
  });
  await pet.screenshot({ path: resolve(output, 'pet.png'), omitBackground: true });
  const nextWindow = app.waitForEvent('window');
  await revealControls(); await pet.locator('#chat').click();
  await pet.locator('#message-input').fill('first hidden query');
  await pet.locator('#message-input').press('Enter');
  const chat = await nextWindow;
  await check('first inline message initializes a hidden chat and submits through its real form', async () => {
    await pet.locator('#composer').waitFor({state:'hidden', timeout:20000});
    assert.equal(await app.evaluate(() => global.__petTest.chat.isVisible()), false);
    await pet.waitForFunction(() => document.getElementById('bubble').textContent === 'reply;');
    assert.equal(await chat.locator('#messages .assistant-message').count(), 1);
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).affinity.points, 6);
  });
  await app.evaluate(() => global.__petTest.showChat());
  chat.on('pageerror', e => report.errors.push(e.message)); await chat.waitForSelector('#query-input');
  assert.equal(new URL(chat.url()).searchParams.get('companion'), 'gwen-companion.v1');
  await check('compact chat follows pet movement and keeps manually resized dimensions', async () => {
    const initial = await app.evaluate(() => global.__petTest.chat.getBounds());
    assert.ok(Math.abs(initial.width - 420) <= 4); assert.ok(Math.abs(initial.height - 600) <= 4);
    const before = await app.evaluate(({ screen }) => {
      const a = screen.getPrimaryDisplay().workArea;
      global.__petTest.pet.setPosition(a.x + a.width - 330, a.y + a.height - 390);
      return global.__petTest.pet.getBounds();
    });
    await new Promise(r => setTimeout(r, 150));
    const docked = await app.evaluate(() => global.__petTest.chat.getBounds());
    await app.evaluate(() => global.__petTest.chat.setSize(400, 560));
    await new Promise(r => setTimeout(r, 150));
    await app.evaluate(() => global.__petTest.chat.emit('resized'));
    const resized = await app.evaluate(({ }, p) => { const size = global.__petTest.chat.getBounds(); global.__petTest.pet.setPosition(p.x - 40, p.y - 40); return size; }, before);
    await new Promise(r => setTimeout(r, 150));
    const moved = await app.evaluate(() => global.__petTest.chat.getBounds());
    // Fractional display scaling can round an outer bound by one DIP on move.
    assert.notEqual(moved.x, docked.x); assert.ok(Math.abs(moved.width - resized.width) <= 2); assert.ok(Math.abs(moved.height - resized.height) <= 2);
    for (let i = 0; i < 12; i++) {
      await app.evaluate(({}, p) => global.__petTest.pet.setPosition(p.x, p.y), { x: before.x - 40 - i % 2, y: before.y - 40 });
      await new Promise(r => setTimeout(r, 30));
    }
    const settled = await app.evaluate(() => global.__petTest.chat.getBounds());
    assert.ok(Math.abs(settled.width - resized.width) <= 2); assert.ok(Math.abs(settled.height - resized.height) <= 2);
    await chat.locator('#query-input').fill('preserve draft');
    await app.evaluate(() => { global.__petTest.chat.hide(); const p = global.__petTest.pet.getBounds(); global.__petTest.pet.setPosition(p.x - 30, p.y); global.__petTest.showChat(); });
    const reopened = await app.evaluate(() => global.__petTest.chat.getBounds());
    assert.notEqual(reopened.x, moved.x);
    assert.equal(await chat.locator('#query-input').inputValue(), 'preserve draft');
  });
  await check('remote chat has no privileged desktop bridge', async () => {
    assert.deepEqual(await chat.evaluate(() => ({ require: typeof require, api: typeof companion })), { require: 'undefined', api: 'undefined' });
  });
  await check('real preload observes a query and rewards completion exactly once', async () => {
    assert.equal(await chat.locator('#messages .assistant-message').count(), 1);
    for (let i = 0; i < 60 && (await app.evaluate(() => global.__petTest.snapshot())).affinity.points !== 6; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).affinity.points, 6);
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).phase, 'done');
  });
  await check('closing the chat hides it without losing its page/context', async () => {
    await app.evaluate(() => global.__petTest.chat.close());
    assert.equal(await app.evaluate(() => global.__petTest.chat.isVisible()), false);
    await app.evaluate(() => global.__petTest.showChat());
    assert.equal(await chat.locator('#messages').textContent(), 'reply;');
  });
  await check('bubble previews actual answer text, truncates safely and follows streamed text changes', async () => {
    await pet.waitForFunction(() => document.getElementById('bubble').textContent === 'reply;');
    const long = '先保留经济，再根据来牌选择阵容。'.repeat(10) + '<img src=x>';
    await chat.locator('.chat-conclusion').evaluate((el, text) => { el.firstChild.data = text; }, long);
    const expected = Array.from(long).slice(0, 72).join('') + '…';
    await pet.waitForFunction(text => document.getElementById('bubble').textContent === text, expected);
    assert.equal(await pet.locator('#bubble img').count(), 0);
    await chat.locator('.message-body').last().evaluate(el => { el.innerHTML = '<section data-chat-model-conclusion><div class="assistant-rich-text">模型结论预览</div><button>赞</button></section>'; });
    await pet.waitForFunction(() => document.getElementById('bubble').textContent === '模型结论预览');
    await chat.locator('.message-body').last().evaluate(el => { el.innerHTML = '<div class="answer-summary">简短结果预览</div><button>查看详情</button>'; });
    await pet.waitForFunction(() => document.getElementById('bubble').textContent === '简短结果预览');
    await pet.screenshot({ path: resolve(output, 'answer-bubble.png'), omitBackground: true });
  });
  await check('stopping a query does not celebrate or add affinity', async () => {
    await chat.locator('form button').click(); await chat.locator('#stop-button').click();
    await new Promise(r => setTimeout(r, 100)); const s = await app.evaluate(() => global.__petTest.snapshot());
    assert.equal(s.phase, 'idle'); assert.equal(s.affinity.points, 6);
    assert.equal(s.answerPreview, '');
    assert.equal(s.narrationKey, 'stopped');
    await pet.waitForFunction(() => document.getElementById('bubble').textContent.includes('收起针线') || document.getElementById('bubble').textContent.includes('停下来啦') || document.getElementById('bubble').textContent.includes('再叫我'));
  });
  await check('failed query signals failure without a completion reward', async () => {
    await chat.evaluate(() => { document.getElementById('status').dataset.state = 'loading'; document.getElementById('stop-button').classList.remove('hidden'); });
    await new Promise(r => setTimeout(r, 60));
    await chat.evaluate(() => { document.getElementById('status').dataset.state = 'error'; document.getElementById('stop-button').classList.add('hidden'); });
    await new Promise(r => setTimeout(r, 60)); const s = await app.evaluate(() => global.__petTest.snapshot()); assert.equal(s.phase, 'failed'); assert.equal(s.affinity.points, 6);
  });
  await check('personal release exposes Gwen only and rejects unlisted characters', async () => {
    await app.evaluate(() => global.__petTest.selectPet('ouo-neko'));
    await pet.waitForFunction(() => document.getElementById('pet').dataset.petId === 'prestige-gwen');
    assert.deepEqual(await pet.evaluate(async () => (await (await fetch('./pets.json')).json()).map(p => p.id)), ['prestige-gwen']);
    assert.equal((await app.evaluate(() => global.__petTest.snapshot())).affinity.points, 6);
  });
  await check('inline composer sends through existing chat without opening it or losing context', async () => {
    await chat.locator('.message-body').last().evaluate(el => el.textContent = 'earlier reply');
    await app.evaluate(() => global.__petTest.chat.hide());
    await revealControls(); await pet.locator('#chat').click();
    await pet.locator('#message-input').fill('hello from pet');
    await pet.screenshot({path:resolve(output,'inline-composer.png'),omitBackground:true});
    assert.equal(await app.evaluate(() => global.__petTest.pet.isFocusable()), true);
    await pet.locator('#message-input').press('Enter');
    await pet.locator('#composer').waitFor({state:'hidden'});
    assert.equal(await app.evaluate(() => global.__petTest.chat.isVisible()), false);
    assert.equal(await app.evaluate(() => global.__petTest.pet.isFocusable()), false);
    await pet.waitForFunction(() => document.getElementById('bubble').textContent === 'reply;');
    assert.ok((await chat.locator('#messages').textContent()).includes('earlier reply'));
  });
  await check('draft conflict and IME confirmation cannot accidentally send', async () => {
    await chat.locator('#query-input').fill('existing draft');
    await revealControls(); await pet.locator('#chat').click();
    await pet.locator('#message-input').fill('keep this draft');
    await pet.locator('#message-input').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
    assert.equal(await pet.locator('#message-input').inputValue(), 'keep this draft');
    await pet.locator('#send').click();
    await pet.waitForFunction(() => document.getElementById('bubble').textContent.includes('草稿'));
    assert.equal(await pet.locator('#message-input').inputValue(), 'keep this draft');
    assert.equal(await chat.locator('#query-input').inputValue(), 'existing draft');
    await pet.locator('#message-input').press('Escape');
    await pet.locator('#composer').waitFor({state:'hidden'});
    assert.equal(await app.evaluate(() => global.__petTest.pet.isFocusable()), false);
  });
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) { if (app) { report.debug = await app.evaluate(() => ({ state: global.__petTest.snapshot() })); report.pages = await Promise.all(app.windows().map(p => p.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-1200), draft: document.getElementById('query-input')?.value, composeDraft: document.getElementById('message-input')?.value })))); } report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); }
finally { if (app) await app.close(); server.close(); writeFileSync(resolve(output, 'desktop-check.json'), JSON.stringify(report, null, 2)); }
