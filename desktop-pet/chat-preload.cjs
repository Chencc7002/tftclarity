// Read-only UI observation in the isolated preload world. No Node/IPC bridge is
// exposed to the remote website; requests, answers and conversation IDs stay in
// the existing TFTClarity page. A close/hide does not unload that page.
const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  let wasBusy = false, stopped = false, last = '', completedBody = null, lastPreview = '';
  function preview() {
    if (!completedBody?.isConnected) return;
    const source = completedBody.querySelector('[data-chat-model-conclusion] .assistant-rich-text')
      || completedBody.querySelector('.chat-conclusion')
      || completedBody.querySelector('.answer-summary');
    if (!source) return;
    const copy = source.cloneNode(true);
    copy.querySelectorAll('button, script, style, [hidden], .hidden').forEach(el => el.remove());
    const chars = Array.from((copy.textContent || '').replace(/\s+/g, ' ').trim());
    const text = chars.slice(0, 72).join('') + (chars.length > 72 ? '…' : '');
    if (text !== lastPreview) { lastPreview = text; ipcRenderer.send('chat:preview', text); }
  }
  const report = phase => { if (phase !== last) { last = phase; ipcRenderer.send('chat:status', phase); } };
  document.addEventListener('click', event => { if (event.target.closest?.('#stop-button')) stopped = true; }, true);
  function observe() {
    const stop = document.getElementById('stop-button');
    const busy = Boolean(stop && !stop.classList.contains('hidden') && !stop.hidden);
    if (busy) {
      if (!wasBusy) { stopped = false; completedBody = null; lastPreview = ''; }
      report('thinking');
    } else if (wasBusy) {
      const status = document.getElementById('status')?.dataset.state;
      report(stopped ? 'stopped' : status === 'error' ? 'failed' : ['ready', 'stale'].includes(status) ? 'done' : 'idle');
    }
    if (!busy && wasBusy && last === 'done') completedBody = [...document.querySelectorAll('.assistant-message:not(.welcome-message) > .message-body')].at(-1) || null;
    if (!busy && last === 'done') preview();
    wasBusy = busy;
  }
  new MutationObserver(observe).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-state'] });
  observe();
});
