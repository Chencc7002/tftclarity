const api = require("../../utils/api");
const store = require("../../utils/session-store");
const { buildResultView } = require("../../utils/result-view");

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    missing: false,
    view: null,
    streamText: "",
    conclusionPending: false
  },

  onLoad(options) {
    const app = getApp();
    this.resultId = decodeURIComponent(options.id || "");
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navigationBarHeight: app.globalData.navigationBarHeight
    });
    this.loadResult();
  },

  onUnload() {
    if (this.streamTask) this.streamTask.abort();
    if (this.streamTimer) clearTimeout(this.streamTimer);
  },

  loadResult() {
    const payload = store.getResult(this.resultId);
    if (!payload) {
      this.setData({ missing: true, view: null });
      return;
    }
    this.payload = payload;
    const view = buildResultView(payload);
    this.setData({
      missing: false,
      view,
      conclusionPending: view.conclusionPending,
      streamText: view.conclusionPending ? "AI 正在结合数据生成结论…" : ""
    });
    const pending = payload.answer && payload.answer.generatedConclusion;
    if (pending && pending.status === "pending") this.startConclusion(pending);
  },

  startConclusion(pending) {
    this.streamBuffer = "";
    this.streamTask = api.streamConclusion(pending, {
      onEvent: (event) => {
        if (event.type === "delta") {
          this.streamBuffer += String(event.text || "");
          this.scheduleStreamRender();
          return;
        }
        if (event.type === "complete" && event.conclusion) {
          if (this.streamTimer) clearTimeout(this.streamTimer);
          this.payload.answer.generatedConclusion = event.conclusion;
          store.saveResult(this.payload, this.resultId);
          this.setData({
            view: buildResultView(this.payload),
            conclusionPending: false,
            streamText: this.streamBuffer
          });
        }
      },
      onError: () => {
        this.setData({
          conclusionPending: false,
          streamText: ""
        });
      }
    });
  },

  scheduleStreamRender() {
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      this.setData({ streamText: this.streamBuffer });
    }, 32);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: "/pages/chat/chat" });
    }
  },

  copySource() {
    if (!this.data.view || !this.data.view.sourceUrl) return;
    wx.setClipboardData({
      data: this.data.view.sourceUrl,
      success() {
        wx.showToast({ title: "链接已复制", icon: "success" });
      }
    });
  }
});
