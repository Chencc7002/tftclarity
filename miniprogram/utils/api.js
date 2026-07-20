const { API_BASE_URL } = require("../config");
const { createUtf8Decoder } = require("./utf8-stream");

function absoluteUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL.replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

function requestRecommendation(input, options) {
  const settings = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: absoluteUrl("/api/recommend"),
      method: "POST",
      header: { "content-type": "application/json" },
      data: {
        input,
        conversationId: settings.conversationId,
        deferConclusion: true,
        preferences: settings.preferences || {}
      },
      success(response) {
        const payload = response.data || {};
        if (response.statusCode < 200 || response.statusCode >= 300 || !payload.ok) {
          reject(new Error(payload.error || `查询失败（${response.statusCode}）`));
          return;
        }
        resolve(payload);
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      }
    });
  });
}

function createLineParser(onEvent) {
  let buffer = "";
  return {
    push(text, flush) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach((line) => {
        if (line.trim()) onEvent(JSON.parse(line));
      });
      if (flush && buffer.trim()) {
        onEvent(JSON.parse(buffer));
        buffer = "";
      }
    }
  };
}

function pollConclusion(pending, callbacks, stopped) {
  function poll() {
    if (stopped()) return;
    wx.request({
      url: absoluteUrl(pending.statusUrl),
      method: "GET",
      success(response) {
        const payload = response.data || {};
        if (payload.ok && payload.status === "complete") {
          callbacks.onEvent({ type: "complete", conclusion: payload.conclusion });
          callbacks.onDone();
          return;
        }
        if (!payload.ok) {
          callbacks.onError(new Error(payload.error || "结论任务不可用"));
          return;
        }
        setTimeout(poll, 700);
      },
      fail(error) {
        callbacks.onError(new Error(error.errMsg || "结论查询失败"));
      }
    });
  }
  poll();
}

function streamConclusion(pending, handlers) {
  const callbacks = Object.assign({
    onEvent() {},
    onDone() {},
    onError() {}
  }, handlers || {});
  let cancelled = false;
  let receivedChunks = false;
  let completed = false;
  const decoder = createUtf8Decoder();
  const parser = createLineParser((event) => {
    callbacks.onEvent(event);
    if (event.type === "complete") completed = true;
  });
  const task = wx.request({
    url: absoluteUrl(pending.streamUrl),
    method: "GET",
    enableChunked: true,
    responseType: "arraybuffer",
    header: { accept: "application/x-ndjson" },
    success(response) {
      if (cancelled) return;
      if (!receivedChunks && response.data instanceof ArrayBuffer) {
        parser.push(decoder.decode(response.data, true), true);
      } else {
        parser.push(decoder.decode(null, true), true);
      }
      if (completed) callbacks.onDone();
      else pollConclusion(pending, callbacks, () => cancelled);
    },
    fail(error) {
      if (!cancelled) {
        pollConclusion(pending, callbacks, () => cancelled);
      }
    }
  });

  if (task && typeof task.onChunkReceived === "function") {
    task.onChunkReceived((chunk) => {
      if (cancelled) return;
      receivedChunks = true;
      parser.push(decoder.decode(chunk.data, false), false);
    });
  }

  return {
    abort() {
      cancelled = true;
      if (task && typeof task.abort === "function") task.abort();
    }
  };
}

module.exports = {
  absoluteUrl,
  requestRecommendation,
  streamConclusion
};
