// Local presentation only. Never infer tool execution or successful retrieval.
export function createNarration(copy = {}, { random = Math.random, now = Date.now } = {}) {
  let serial, key = 'idle', started = 0, line = '', waiting = false, slow = false;
  function choose(name) {
    const options = copy[name];
    return Array.isArray(options) && options.length ? options[Math.floor(random() * options.length) % options.length] : '';
  }
  return {
    update(state) {
      if (serial !== state.serial) {
        serial = state.serial; key = state.narrationKey || state.phase; started = now(); waiting = false; slow = false;
        line = key === 'idle' ? copy.greeting || '你好呀～' : choose(key);
      }
      if (key === 'thinking' && !waiting && now() - started >= 1500) { waiting = true; line = choose('querying') || line; }
      if (key === 'thinking' && !slow && now() - started >= 12000) { slow = true; line = choose('slow') || line; }
      return state.phase === 'done' && state.answerPreview ? state.answerPreview : line;
    }
  };
}
