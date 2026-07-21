const STORAGE_KEY = "tftclarity.mini.session.v1";
const MAX_MESSAGES = 40;
const MAX_RESULTS = 8;

let memory = null;

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSession() {
  return {
    id: newId("conversation"),
    messages: [],
    results: {},
    resultOrder: []
  };
}

function load() {
  if (memory) return memory;
  try {
    const saved = wx.getStorageSync(STORAGE_KEY);
    memory = saved && saved.id ? saved : createSession();
  } catch (error) {
    memory = createSession();
  }
  memory.messages = Array.isArray(memory.messages) ? memory.messages : [];
  memory.results = memory.results || {};
  memory.resultOrder = Array.isArray(memory.resultOrder) ? memory.resultOrder : [];
  return memory;
}

function persist() {
  try {
    wx.setStorageSync(STORAGE_KEY, memory);
  } catch (error) {
    // The in-memory session still preserves back-navigation state if storage is full.
  }
}

function getSession() {
  return load();
}

function appendMessage(message) {
  const session = load();
  const value = Object.assign({
    id: newId("message"),
    createdAt: Date.now()
  }, message);
  session.messages.push(value);
  session.messages = session.messages.slice(-MAX_MESSAGES);
  persist();
  return value;
}

function updateMessage(id, patch) {
  const session = load();
  const message = session.messages.find((entry) => entry.id === id);
  if (!message) return null;
  Object.assign(message, patch);
  persist();
  return message;
}

function saveResult(payload, preferredId) {
  const session = load();
  const id = String(preferredId || payload.queryId || newId("result"));
  session.results[id] = payload;
  session.resultOrder = session.resultOrder.filter((entry) => entry !== id);
  session.resultOrder.push(id);
  while (session.resultOrder.length > MAX_RESULTS) {
    const removed = session.resultOrder.shift();
    delete session.results[removed];
  }
  persist();
  return id;
}

function getResult(id) {
  return load().results[String(id || "")] || null;
}

function clearSession() {
  memory = createSession();
  persist();
  return memory;
}

module.exports = {
  appendMessage,
  clearSession,
  getResult,
  getSession,
  saveResult,
  updateMessage
};
