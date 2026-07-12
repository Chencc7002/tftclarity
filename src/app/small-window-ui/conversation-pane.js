export class ConversationPane {
  constructor(root) { this.root = root; }
  appendUser(html, metaHtml) {
    const message = document.createElement("article");
    message.className = "message user-message";
    message.innerHTML = `<div class="message-meta">${metaHtml}</div><div class="message-body">${html}</div>`;
    this.root.append(message); this.scroll(); return message;
  }
  appendAssistant(html, metaHtml) {
    const message = document.createElement("article");
    message.className = "message assistant-message";
    message.innerHTML = `<div class="message-meta"><span class="assistant-avatar" aria-hidden="true">✦</span>${metaHtml}</div><div class="message-body">${html}</div>`;
    this.root.append(message); this.scroll(); return message.querySelector(".message-body");
  }
  scroll() { this.root.scrollTop = this.root.scrollHeight; }
}

export class Composer {
  constructor({ form, input }) { this.form = form; this.input = input; }
  clear() { this.input.value = ""; }
  focusWith(value = "") { this.input.value = value; this.input.focus(); }
}
