import { createNarration } from './narration.mjs';
import { rowOf, animationForPhase } from './vendor/dsh-pet/state.mjs';
import { scaledCellSize } from './vendor/dsh-pet/client/spritesheet.mjs';
const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubble = document.getElementById('bubble-text');
const api = window.companion;
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
    document.getElementById('pet-name').textContent = entry.name;
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
  document.getElementById('pet-name').textContent = entry.name.replace('（精致版）', '');
  canvas.setAttribute('aria-label', entry.name + '：点击摸头，按住拖动');
}
function phaseText() { return narration.update(state) || phrases[state.phase] || phrases.idle; }
function renderState(next) {
  state = next;
  if (state.petId !== loadedPet) void loadPet(state.petId).catch(() => { bubble.textContent = '格温加载失败，请退出后重新打开桌宠。'; });
  const points = state.affinity?.points ?? 0;
  document.getElementById('affinity').textContent = `${points < 25 ? '初次见面' : points < 50 ? '伙伴' : '挚友'} · ${points}`;
  if (lastSerial !== state.serial) {
    lastSerial = state.serial;
    // New work takes precedence over an earlier pat/feed reaction.
    if (state.phase !== 'idle') reactionUntil = 0;
    terminalUntil = ['done', 'failed'].includes(state.phase) ? Date.now() + (modelRenderer && state.phase === 'done' ? 4000 : 2600) : 0;
    if (Date.now() >= reactionUntil) { bubble.textContent = phaseText(); setAnimation(animationForPhase(state.phase) || 'idle'); }
  }
  if (!reactionUntil && state.phase === 'done' && state.answerPreview) bubble.textContent = state.answerPreview;
  document.getElementById('hint').textContent = state.quiet ? '安静陪伴中 · 菜单可恢复动画' : '摸摸头 · 拖动换位置';
}
function setAnimation(value) { if (animation !== value) { animation = value; frame = 0; modelRenderer?.setAction(modelActions[value] ?? modelActions.idle, { once: ['waving', 'jumping', 'failed'].includes(value) }); } }
await loadPet(state.petId); api.onState(renderState); renderState(state);
async function interact(kind) {
  const result = await api.interact(kind);
  if (!result) return;
  bubble.textContent = result.reaction;
  reactionUntil = Date.now() + (modelRenderer && kind === 'feed' ? 4000 : 3200);
  setAnimation(result.accepted ? kind === 'feed' ? 'jumping' : 'waving' : 'waiting');
}
function tick() {
  const now = Date.now();
  if (reactionUntil && now >= reactionUntil) { reactionUntil = 0; bubble.textContent = phaseText(); setAnimation(animationForPhase(state.phase) || 'idle'); }
  if (!reactionUntil && terminalUntil && now >= terminalUntil) { terminalUntil = 0; setAnimation('idle'); bubble.textContent = phaseText(); }
  if (!reactionUntil) bubble.textContent = phaseText();
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
  if (event.target.closest?.('.hit')) return true;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - r.left) * canvas.width / r.width), y = Math.floor((event.clientY - r.top) * canvas.height / r.height);
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && pixels?.[(y * canvas.width + x) * 4 + 3] > 24;
}
function sendHit(hit) { if (lastHit !== hit) { lastHit = hit; api.hit(hit); } }
document.addEventListener('pointermove', event => {
  if (pointer) {
    if (!pointer.dragged && Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5) { pointer.dragged = true; canvas.classList.add('dragging'); api.action('drag-start'); }
    return;
  }
  sendHit(hitAt(event));
});
document.addEventListener('pointerleave', () => { if (!pointer) sendHit(false); });
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
document.getElementById('chat').onclick = () => api.action('chat');
document.getElementById('bubble').onclick = () => api.action('chat');
document.getElementById('feed').onclick = () => void interact('feed');
document.getElementById('menu').onclick = () => api.action('menu');
