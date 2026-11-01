const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, Tray, nativeImage, shell, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { allowedSite, clampBounds, publicLink } = require('./window-policy.cjs');
const pets = require('./pets.json');
const testMode = process.argv.includes('--pet-test');
const site = allowedSite(process.env.TFT_PET_SITE);
const dataDir = process.env.TFT_PET_DATA_DIR || path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'portable-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setName('TFTClarity Companion');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let pet, chat, tray, affinityModule;
  let chatSize = { width: 420, height: 600 };
  let pendingSend = false;
  let quitting = false, dragging = null, dragTimer, clickThrough = true, quiet = false;
  let answerPreview = '';
  let narrationKey = 'idle';
  let phase = 'idle', phaseSerial = 0, currentTurn = false;
  const statePath = path.join(dataDir, 'companion.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* First launch or interrupted write. */ }
  function persist() {
    if (pet && !pet.isDestroyed()) saved.position = pet.getBounds();
    saved.quiet = quiet;
    if (saved.petId && saved.affinity) saved.affinities = { ...saved.affinities, [saved.petId]: saved.affinity };
    try { fs.writeFileSync(statePath + '.tmp', JSON.stringify(saved, null, 2)); fs.renameSync(statePath + '.tmp', statePath); }
    catch (error) { console.error('Could not save companion state:', error.message); }
  }
  function snapshot() { return { phase, narrationKey, answerPreview, serial: phaseSerial, quiet, petId: saved.petId, affinity: saved.affinity, chatVisible: Boolean(chat?.isVisible()), hotkey: hotkeyReady }; }
  function publish() { if (pet && !pet.isDestroyed()) pet.webContents.send('pet:state', snapshot()); }
  function setPhase(next, copyKey = next) { if (next === 'thinking' || next === 'idle') answerPreview = ''; if (phase !== next || narrationKey !== copyKey) { phase = next; narrationKey = copyKey; phaseSerial++; publish(); } }
  function setClickThrough(value) {
    clickThrough = value;
    if (pet && !pet.isDestroyed()) pet.setIgnoreMouseEvents(value, { forward: true });
  }
  function petSender(event) { return event.sender === pet?.webContents && event.senderFrame === pet.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'pet.html')).href; }
  function chatSender(event) { return event.sender === chat?.webContents && event.senderFrame === chat.webContents.mainFrame && event.senderFrame.url.startsWith(site); }
  function positionChat() {
    if (!chat || chat.isDestroyed()) return;
    const bounds = pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const size = chatSize;
    const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height - 24);
    const desired = { x: bounds.x - width - 4, y: bounds.y + bounds.height - height, width, height };
    if (desired.x < area.x) desired.x = bounds.x + bounds.width + 4;
    const fitted = clampBounds(desired, area);
    chat.setBounds(fitted);
  }
  function openExternal(url) { if (publicLink(url)) void shell.openExternal(url); }
  function createChat() {
    chat = new BrowserWindow({ width: 420, height: 600, minWidth: 320, minHeight: 360, show: false, title: 'TFTClarity · 随身聊天', autoHideMenuBar: true, alwaysOnTop: true,
      icon: path.join(__dirname, 'assets/tray.png'), backgroundColor: '#faf8fb',
      webPreferences: { preload: path.join(__dirname, 'chat-preload.cjs'), partition: 'persist:tftclarity', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    chat.setAlwaysOnTop(true, 'screen-saver');
    // Windows emits resized after a manual resize; programmatic following must
    // never feed rounded native bounds back into the next requested size.
    chat.on('resized', () => { const b = chat.getBounds(); chatSize = { width: b.width, height: b.height }; });
    chat.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    chat.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(site)) { event.preventDefault(); openExternal(url); } });
    chat.webContents.on('will-redirect', (event, url) => { if (!url.startsWith(site)) event.preventDefault(); });
    chat.webContents.on('will-attach-webview', event => event.preventDefault());
    chat.on('close', event => { if (!quitting) { event.preventDefault(); chat.hide(); publish(); } });
    chat.on('show', publish); chat.on('hide', publish);
    chat.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape' && !input.isComposing) { event.preventDefault(); chat.hide(); } });
    chat.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) { currentTurn = false; setPhase('idle'); } });
    chat.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { setPhase('failed'); dialog.showMessageBox(chat, { type: 'warning', message: '聊天网站暂时无法连接', detail: '桌宠仍可使用。网络恢复后，在桌宠菜单中选择“重新加载聊天”。' }); }
    });
    positionChat();
    const chatUrl = new URL(site);
    const personaId = pets.find(p => p.id === saved.petId)?.personaId;
    if (personaId) chatUrl.searchParams.set('companion', personaId);
    chat.loadURL(chatUrl.href).catch(error => console.error('Chat load:', error.message));
  }
  async function sendMessage(text) {
    if (pendingSend || typeof text !== 'string' || !text.trim() || text.length > 8000) return { ok: false, error: '请稍后重试，或检查输入内容。' };
    pendingSend = true;
    try {
      if (!chat || chat.isDestroyed()) createChat();
      const target = chat;
      const result = await target.webContents.executeJavaScript(`new Promise(resolve => {
        const deadline = Date.now() + 12000;
        const text = ${JSON.stringify(text.trim())};
        function submit() {
          const input = document.getElementById('query-input');
          const form = input?.closest('form');
          const stop = document.getElementById('stop-button');
          if (stop && !stop.classList.contains('hidden') && !stop.hidden) return resolve({ ok: false, error: '上一条还在回复，稍等一下再发哦。' });
          if (!input || !form || document.readyState !== 'complete') {
            if (Date.now() >= deadline) return resolve({ ok: false, error: '聊天还没准备好，请稍后重试。' });
            return setTimeout(submit, 100);
          }
          if (input.disabled || input.readOnly) return resolve({ ok: false, error: '当前暂时无法发送，请打开完整聊天查看。' });
          if (input.value.trim()) return resolve({ ok: false, error: '完整聊天里还有未发送的草稿，请先处理它。' });
          input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
          try { form.requestSubmit(); resolve({ ok: true }); }
          catch { resolve({ ok: false, error: '没有发出，请打开完整聊天检查草稿。' }); }
        }
        submit();
      })`);
      return result;
    } catch { return { ok: false, error: '暂时没能连接聊天，你写的内容还在。' }; }
    finally { pendingSend = false; }
  }
  function showChat() { if (!chat || chat.isDestroyed()) createChat(); if (!pet.isVisible()) pet.showInactive(); positionChat(); chat.show(); chat.focus(); publish(); }
  function toggleChat() { if (chat?.isVisible()) { chat.hide(); publish(); } else showChat(); }
  function toggleAll() { if (pet.isVisible()) { pet.hide(); chat?.hide(); } else pet.showInactive(); }
  function cleanAffinity(value) {
    const clean = affinityModule.emptyAffinity();
    for (const key of Object.keys(clean)) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) clean[key] = value[key];
    return clean;
  }
  function selectPet(id) {
    if (!pets.some(p => p.id === id) || saved.petId === id) return;
    persist(); saved.petId = id; saved.affinity = cleanAffinity(saved.affinities?.[id]); persist(); publish();
  }
  function interactPet(kind) {
    if (!['pet', 'feed'].includes(kind)) return null;
    const result = affinityModule.applyInteraction(saved.affinity, kind, Date.now());
    saved.affinity = result.affinity; persist(); publish();
    return { accepted: result.accepted, reaction: result.reaction.replaceAll('鲸鱼娘', '格温'), delta: result.delta };
  }
  function menuTemplate() {
    const points = saved.affinity.points;
    const remaining = Math.max(0, Math.ceil((30000 - (Date.now() - saved.affinity.lastFeedAt)) / 1000));
    return [
      { label: `${pets.find(p => p.id === saved.petId)?.name} · ${points < 25 ? '初次见面' : points < 50 ? '伙伴' : '挚友'} · ${points}`, enabled: false },
      { id: 'feed', label: remaining ? `喂食（${remaining} 秒后）` : '喂食', enabled: !remaining,
        click: () => { const result = interactPet('feed'); pet.webContents.send('pet:interaction', { result, kind: 'feed' }); } },
      { type: 'separator' },
      { label: '输入消息', click: () => { pet.showInactive(); pet.webContents.send('pet:compose'); } },
      { label: '打开完整聊天  Ctrl+Shift+Space', click: showChat },
      ...(pets.length > 1 ? [{ label: '切换角色', submenu: pets.map(p => ({ label: p.name, type: 'radio', checked: saved.petId === p.id, click: () => selectPet(p.id) })) }] : []),
      { label: quiet ? '恢复动画' : '安静模式（暂停动画）', click: () => { quiet = !quiet; persist(); publish(); } },
      { label: '重新加载聊天', click: () => { if (!chat || chat.isDestroyed()) showChat(); else { chat.reload(); showChat(); } } },
      { label: '把桌宠移回主屏幕', click: () => { const a = screen.getPrimaryDisplay().workArea; pet.setPosition(a.x + a.width - 344, a.y + a.height - 410); pet.showInactive(); persist(); } },
      { label: '隐藏 / 显示  Ctrl+Alt+P', click: toggleAll },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ];
  }
  function menu() { Menu.buildFromTemplate(menuTemplate()).popup({ window: pet }); }
  let hotkeyReady = false;
  app.whenReady().then(async () => {
    affinityModule = await import('./vendor/dsh-pet/affinity.mjs');
    saved.petId = pets.some(p => p.id === saved.petId) ? saved.petId : 'prestige-gwen';
    saved.affinity = cleanAffinity(saved.affinities?.[saved.petId] ?? saved.affinity);
    quiet = saved.quiet === true;
    const a = screen.getPrimaryDisplay().workArea;
    let initial = { x: a.x + a.width - 344, y: a.y + a.height - 410, width: 320, height: 316 };
    if (Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) initial = { ...initial, x: saved.position.x, y: saved.position.y };
    initial = clampBounds(initial, screen.getDisplayMatching(initial).workArea);
    pet = new BrowserWindow({ ...initial, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
      title: 'TFTClarity 随身伙伴', icon: path.join(__dirname, 'assets/tray.png'),
      webPreferences: { preload: path.join(__dirname, 'pet-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    pet.setAlwaysOnTop(true, 'screen-saver');
    pet.on('move', () => { if (chat?.isVisible()) positionChat(); });
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pet.webContents.on('will-navigate', event => event.preventDefault());
    for (const s of [session.defaultSession, session.fromPartition('persist:tftclarity')]) {
      s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      s.setPermissionCheckHandler(() => false);
      s.on('will-download', event => event.preventDefault());
    }
    ipcMain.handle('pet:send-message', (event, text) => petSender(event) ? sendMessage(text) : { ok: false });
    pet.on('blur', () => pet.webContents.send('pet:composer-blur'));
    ipcMain.handle('pet:snapshot', event => petSender(event) ? snapshot() : null);
    ipcMain.handle('pet:interact', (event, kind) => petSender(event) ? interactPet(kind) : null);
    ipcMain.on('pet:hit', (event, hit) => { if (petSender(event) && typeof hit === 'boolean' && !dragging) setClickThrough(!hit); });
    ipcMain.on('pet:action', (event, action) => {
      if (!petSender(event)) return;
      if (action === 'chat') toggleChat();
      if (action === 'compose-focus') { setClickThrough(false); pet.setFocusable(true); pet.focus(); }
      if (action === 'compose-blur') { pet.setFocusable(false); }
      if (action === 'menu') menu();
      if (action === 'hide') toggleAll();
      if (action === 'drag-start') {
        dragging = { cursor: screen.getCursorScreenPoint(), bounds: pet.getBounds() }; setClickThrough(false);
        clearInterval(dragTimer);
        dragTimer = setInterval(() => { if (!dragging) return; const p = screen.getCursorScreenPoint(); pet.setPosition(dragging.bounds.x + p.x - dragging.cursor.x, dragging.bounds.y + p.y - dragging.cursor.y); }, 16);
      }
      if (action === 'drag-end') {
        dragging = null; clearInterval(dragTimer);
        const b = pet.getBounds(); pet.setBounds(clampBounds(b, screen.getDisplayMatching(b).workArea)); persist(); setClickThrough(true);
      }
    });
    ipcMain.on('chat:preview', (event, text) => {
      if (!chatSender(event) || phase !== 'done' || typeof text !== 'string') return;
      answerPreview = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 120).join(''); publish();
    });
    ipcMain.on('chat:status', (event, next) => {
      if (!chatSender(event) || !['thinking', 'review', 'done', 'failed', 'idle', 'stopped'].includes(next)) return;
      const copyKey = next;
      if (next === 'stopped') next = 'idle';
      if (next === 'thinking' || next === 'review') currentTurn = true;
      if (next === 'done' && currentTurn) { saved.affinity = affinityModule.applyTurnReward(saved.affinity); persist(); }
      if (['done', 'failed', 'idle'].includes(next)) currentTurn = false;
      setPhase(next, copyKey);
    });
    pet.once('ready-to-show', () => { setClickThrough(true); pet.showInactive(); });
    await pet.loadFile(path.join(__dirname, 'pet.html'));
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon); tray.setToolTip('TFTClarity 随身伙伴 · Ctrl+Shift+Space 聊天');
    tray.on('click', () => { pet.showInactive(); showChat(); }); tray.on('right-click', menu);
    if (!testMode) {
      hotkeyReady = globalShortcut.register('CommandOrControl+Shift+Space', toggleChat);
      globalShortcut.register('CommandOrControl+Alt+P', toggleAll);
    }
    publish();
    // Test-only observability, never exposed to either renderer or a network port.
    if (testMode) global.__petTest = { showChat, toggleChat, selectPet, menuTemplate, get pet() { return pet; }, get chat() { return chat; }, snapshot, get clickThrough() { return clickThrough; }, dataDir };
  }).catch(error => { dialog.showErrorBox('桌宠启动失败', error.message); app.quit(); });
  app.on('second-instance', () => { if (pet) { pet.showInactive(); showChat(); } });
  app.on('before-quit', () => { quitting = true; clearInterval(dragTimer); persist(); globalShortcut.unregisterAll(); });
  app.on('window-all-closed', () => app.quit());
}
