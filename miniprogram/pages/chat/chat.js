const api = require("../../utils/api");
const store = require("../../utils/session-store");
const patchNote = require("../../data/patch-notes");

const QUICK_TASKS = {
  comps: {
    label: "热门阵容",
    query: "推荐当前版本热门阵容"
  },
  trends: {
    label: "阵容趋势",
    query: "查看当前版本阵容趋势"
  },
  build: {
    label: "英雄出装",
    template: "查询【英雄名称】的当前版本最稳三件装备"
  },
  patch: {
    label: "更新公告"
  }
};

function resultSummary(payload) {
  if (payload.clarification && payload.clarification.needsClarification) {
    return payload.clarification.question;
  }
  if (payload.answer && payload.answer.summary) return payload.answer.summary;
  if (payload.type === "comp_trends") return "当前版本阵容趋势已经整理完成。";
  if (payload.type === "comp_rankings") return "当前版本热门阵容榜已经整理完成。";
  return payload.text || "查询完成，点击查看完整数据结果。";
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    messages: [],
    input: "",
    inputFocus: false,
    loading: false,
    scrollTarget: "chat-bottom"
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navigationBarHeight: app.globalData.navigationBarHeight
    });
    this.refreshSession();
  },

  onShow() {
    this.refreshSession();
  },

  refreshSession() {
    const session = store.getSession();
    this.setData({
      messages: session.messages,
      scrollTarget: "chat-bottom"
    });
  },

  scrollToBottom() {
    this.setData({
      messages: store.getSession().messages,
      scrollTarget: ""
    }, () => this.setData({ scrollTarget: "chat-bottom" }));
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  onConfirm() {
    this.sendCurrent();
  },

  sendCurrent() {
    const input = String(this.data.input || "").trim();
    if (!input || this.data.loading) return;
    if (input.indexOf("【英雄名称】") >= 0) {
      wx.showToast({ title: "请先替换为英雄名称", icon: "none" });
      this.setData({ inputFocus: true });
      return;
    }
    this.submitQuery(input, input);
  },

  async submitQuery(input, displayText) {
    const session = store.getSession();
    store.appendMessage({ role: "user", text: displayText });
    const pending = store.appendMessage({
      role: "assistant",
      text: "正在查询结构化数据…",
      pending: true
    });
    this.setData({ input: "", inputFocus: false, loading: true });
    this.scrollToBottom();

    try {
      const payload = await api.requestRecommendation(input, {
        conversationId: session.id
      });
      const resultId = store.saveResult(payload);
      store.updateMessage(pending.id, {
        pending: false,
        text: resultSummary(payload),
        resultId,
        actionLabel: "查看结果"
      });
    } catch (error) {
      store.updateMessage(pending.id, {
        pending: false,
        failed: true,
        text: error.message || "查询失败，请稍后重试。"
      });
    } finally {
      this.setData({ loading: false });
      this.scrollToBottom();
    }
  },

  onQuickTask(event) {
    if (this.data.loading) return;
    const task = QUICK_TASKS[event.currentTarget.dataset.task];
    if (!task) return;
    if (task.template) {
      this.setData({ input: task.template, inputFocus: true });
      wx.showToast({ title: "请替换为要查询的英雄", icon: "none" });
      return;
    }
    if (event.currentTarget.dataset.task === "patch") {
      const payload = Object.assign({ ok: true, type: "patch_notes" }, patchNote);
      store.appendMessage({ role: "user", text: `查看 ${patchNote.version} 更新公告` });
      const resultId = store.saveResult(payload, `patch-${patchNote.version}`);
      store.appendMessage({
        role: "assistant",
        text: patchNote.summary,
        resultId,
        actionLabel: "查看公告"
      });
      this.scrollToBottom();
      return;
    }
    this.submitQuery(task.query, task.label);
  },

  openResult(event) {
    const resultId = event.currentTarget.dataset.resultId;
    if (!resultId) return;
    wx.navigateTo({
      url: `/pages/result/result?id=${encodeURIComponent(resultId)}`
    });
  },

  clearConversation() {
    wx.showModal({
      title: "清空会话",
      content: "将删除当前小程序内保存的对话和查询结果。",
      success: (response) => {
        if (!response.confirm) return;
        store.clearSession();
        this.refreshSession();
      }
    });
  }
});
