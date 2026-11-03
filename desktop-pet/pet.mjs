import { createBubbleLifetime, readingDuration } from './bubble-lifetime.mjs';
import { createNarration } from './narration.mjs';
import { rowOf, animationForPhase } from './vendor/dsh-pet/state.mjs';
import { scaledCellSize } from './vendor/dsh-pet/client/spritesheet.mjs';
const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubble = document.getElementById('bubble-text');
const bubbleShell = document.getElementById('bubble');
const bubbleTimer = createBubbleLifetime();
let interactionSerial = 0, interactionText = '', lastPointerEvent = null;
const api = window.companion;
const capsule = document.querySelector('.capsule');
const composer = document.getElementById('composer');
const input = document.getElementById('message-input');
const sendButton = document.getElementById('send');
let controlsUntil = Date.now() + 2500, sending = false;
let voiceLaunching = false, voiceSession = false;
const voiceButton = document.getElementById('composer-voice');
const pets = await (await fetch('./pets.json')).json();
let spec, atlas, size, loadedPet = '', loadSerial = 0;
let modelRenderer = null, modelActions = {}, lastModelFrame = 0;
let state = await api.snapshot(), animation = 'idle', frame = 0, lastSerial = -1, reactionUntil = 0, terminalUntil = 0, lastHit = false, pointer = null, pixels;
let narration = createNarration();
const phrases = { idle: '今天也陪你下一局。', thinking: '正在帮你查，稍等一下。', review: '答案快整理好啦。', done: '查好了，点我看看！', failed: '这次没连上，打开聊天看看吧。' };
async function loadPet(id) {
  const entry = pets.find(p => p.id === id); if (!entry) return;
  const serial = ++loadSerial;
  const manifest = await (await fetch('./' + entry.manifest)).json();
  narration = createNarration(manifest.narration);
  if (manifest.renderer === 'glb') {
    const { createModelRenderer } = await import('./model-renderer.mjs');
    const model = await createModelRenderer(new URL(manifest.model, new URL(entry.manifest, location.href)).href, manifest.camera);
    if (serial !== loadSerial) { model.dispose(); return; }
    modelRenderer?.dispose(); modelRenderer = model; modelActions = manifest.actions;
    canvas.width = 384; canvas.height = 416; frame = 0; loadedPet = id; canvas.dataset.petId = id;
    canvas.setAttribute('aria-label', entry.name + '：点击摸头，按住拖动');
    modelRenderer.setAction(modelActions[animation] ?? modelActions.idle); return;
  }
  const definition = { cell: { width: 192, height: 208 }, columns: 8, ...manifest.sprite2d };
  const image = new Image(); image.src = new URL(definition.spritesheetPath, new URL(entry.manifest, location.href)).href; await image.decode();
  if (serial !== loadSerial) return;
  modelRenderer?.dispose(); modelRenderer = null;
  atlas = image; spec = definition; size = scaledCellSize(spec.cell, 1);
  canvas.width = size.width; canvas.height = size.height; frame = 0;
  loadedPet = id; canvas.dataset.petId = id;
  canvas.setAttribute('aria-label', entry.name + '：点击摸头，按住拖动');
}
function phaseText() { return narration.update(state) || phrases[state.phase] || phrases.idle; }
function renderState(next) {
  state = next;
  if (state.petId !== loadedPet) void loadPet(state.petId).catch(() => { bubble.textContent = '格温加载失败，请退出后重新打开桌宠。'; });
  if (lastSerial !== state.serial) {
    lastSerial = state.serial;
    // New work takes precedence over an earlier pat/feed reaction.
    if (state.phase !== 'idle') reactionUntil = 0;
    terminalUntil = ['done', 'failed'].includes(state.phase) ? Date.now() + (modelRenderer && state.phase === 'done' ? 4000 : 2600) : 0;
    if (Date.now() >= reactionUntil) { bubble.textContent = phaseText(); setAnimation(animationForPhase(state.phase) || 'idle'); }
  }
  if (!reactionUntil && state.phase === 'done' && state.answerPreview) bubble.textContent = state.answerPreview;
  document.getElementById('menu').title = state.quiet ? '更多操作 · 安静模式中' : '更多操作 · 也可右键格温';
}
function setAnimation(value) { if (animation !== value) { animation = value; frame = 0; modelRenderer?.setAction(modelActions[value] ?? modelActions.idle, { once: ['waving', 'jumping', 'failed'].includes(value) }); } }
await loadPet(state.petId); api.onState(renderState); renderState(state);
api.onInteraction(({ result, kind }) => showInteraction(result, kind));
async function interact(kind) {
  const result = await api.interact(kind);
  showInteraction(result, kind);
}
function showInteraction(result, kind) {
  if (!result) return;
  interactionText = result.reaction; interactionSerial++;
  bubble.textContent = interactionText;
  reactionUntil = Date.now() + readingDuration(result.reaction);
  setAnimation(result.accepted ? kind === 'feed' ? 'jumping' : 'waving' : 'waiting');
}
function tick() {
  const now = Date.now();
  if (lastPointerEvent && hitAt(lastPointerEvent)) controlsUntil = now + 1800;
  const showControls = !composer.hidden || now < controlsUntil;
  const controlsChanged = document.body.classList.contains('controls-visible') !== showControls;
  document.body.classList.toggle('controls-visible', showControls);
  if (controlsChanged && lastPointerEvent && !pointer) sendHit(hitAt(lastPointerEvent));
  if (reactionUntil && now >= reactionUntil) { reactionUntil = 0; bubble.textContent = phaseText(); setAnimation(animationForPhase(state.phase) || 'idle'); }
  if (!reactionUntil && terminalUntil && now >= terminalUntil) { terminalUntil = 0; setAnimation('idle'); bubble.textContent = phaseText(); }
  const reacting = now < reactionUntil;
  const text = reacting ? interactionText : phaseText();
  const persistent = !reacting && ['thinking', 'review'].includes(state.phase);
  const visible = bubbleTimer.visible(text, reacting ? `interaction:${interactionSerial}` : `phase:${state.serial}`, persistent);
  if (bubble.textContent !== text) bubble.textContent = text;
  const changed = bubbleShell.classList.contains('expired') === visible;
  bubbleShell.classList.toggle('expired', !visible);
  bubbleShell.setAttribute('aria-hidden', String(!visible));
  if (changed && lastPointerEvent && !pointer) sendHit(hitAt(lastPointerEvent));
  if (modelRenderer) {
    const paused = document.hidden || state.quiet || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delta = paused || !lastModelFrame ? 0 : Math.min(0.1, (now - lastModelFrame) / 1000); lastModelFrame = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(modelRenderer.render(delta), 0, 0);
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    setTimeout(tick, paused ? 250 : 1000 / 24); return;
  }
  lastModelFrame = 0;
  const row = rowOf(animation), count = spec.frames[row] || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(atlas, (frame % count) * spec.cell.width, row * spec.cell.height, spec.cell.width, spec.cell.height, 0, 0, size.width, size.height);
  pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const durations = spec.tracks?.[animation]?.durations;
  const delay = durations?.[frame % durations.length] ?? (['running', 'running-right', 'jumping'].includes(animation) ? 160 : 330);
  if (!state.quiet && !matchMedia('(prefers-reduced-motion: reduce)').matches) frame = (frame + 1) % count;
  setTimeout(tick, delay);
}
tick();
function hitAt(event) {
  const control = document.elementFromPoint(event.clientX, event.clientY)?.closest('.hit');
  if (control && getComputedStyle(control).visibility !== 'hidden') return true;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - r.left) * canvas.width / r.width), y = Math.floor((event.clientY - r.top) * canvas.height / r.height);
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && pixels?.[(y * canvas.width + x) * 4 + 3] > 24;
}
function sendHit(hit) { if (lastHit !== hit) { lastHit = hit; api.hit(hit); } }
document.addEventListener('pointermove', event => {
  lastPointerEvent = event;
  if (pointer) {
    if (!pointer.dragged && Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5) { pointer.dragged = true; canvas.classList.add('dragging'); api.action('drag-start'); }
    return;
  }
  const hit = hitAt(event);
  if (hit) controlsUntil = Date.now() + 1800;
  sendHit(hit);
});
document.addEventListener('pointerleave', () => { lastPointerEvent = null; if (!pointer) sendHit(false); });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !hitAt(event)) return;
  pointer = { x: event.screenX, y: event.screenY, dragged: false }; canvas.setPointerCapture(event.pointerId);
});
function endPointer(event, cancelled = false) {
  if (!pointer) return;
  const dragged = pointer.dragged; pointer = null; canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (dragged) { api.action('drag-end'); lastHit = false; }
  else if (!cancelled) void interact('pet');
}
canvas.addEventListener('pointerup', event => endPointer(event));
canvas.addEventListener('pointercancel', event => endPointer(event, true));
document.addEventListener('contextmenu', event => { event.preventDefault(); api.action('menu'); });
function openComposer() {
  composer.hidden = false; capsule.hidden = true;
  api.action('compose-focus'); input.focus();
}
function closeComposer() {
  if (sending || composer.hidden) return;
  voiceSession = false;
  composer.hidden = true; capsule.hidden = false; controlsUntil = 0;
  api.action('compose-blur'); sendHit(false);
}
document.getElementById('chat').onclick = openComposer;
api.onCompose(openComposer);
api.onComposerBlur(() => { if (!voiceLaunching && !voiceSession) closeComposer(); });

async function startVoiceInput() {
  if (sending || voiceLaunching) return;
  openComposer();
  voiceLaunching = true; voiceSession = true; voiceButton.disabled = true;
  let result;
  try { result = await api.startVoiceInput(); }
  catch { result = { ok: false, error: '语音输入暂时无法打开，请在输入框中按 Win+H。' }; }
  voiceLaunching = false; voiceButton.disabled = false;
  if (!result?.ok) voiceSession = false;
  interactionText = result?.ok ? '请在 Windows 语音面板中说话，确认文字后再发送。' : result?.error || '无法打开语音输入，请在输入框中按 Win+H。';
  interactionSerial++; reactionUntil = Date.now() + readingDuration(interactionText);
}
document.getElementById('voice').onclick = startVoiceInput;
voiceButton.onclick = startVoiceInput;
document.getElementById('close-composer').onclick = closeComposer;
input.addEventListener('input', () => { sendButton.disabled = sending || !input.value.trim(); });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) { event.preventDefault(); return; }
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeComposer(); }
});
composer.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !input.value.trim()) return;
  sending = true; sendButton.disabled = true;
  voiceButton.disabled = true; voiceSession = false;
  const text = input.value;
  let result;
  try { result = await api.sendMessage(text); } catch { result = { ok: false, error: '暂时没有发出，请稍后重试。' }; }
  sending = false;
  voiceButton.disabled = false;
  if (result?.ok) { input.value = ''; closeComposer(); }
  else { interactionText = result?.error || '暂时没有发出，请稍后重试。'; interactionSerial++; reactionUntil = Date.now() + readingDuration(interactionText); }
  sendButton.disabled = !input.value.trim();
});
document.getElementById('bubble').onclick = () => api.action('chat');
document.getElementById('menu').onclick = () => api.action('menu');
