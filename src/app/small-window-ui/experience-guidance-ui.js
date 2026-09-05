import { GUIDANCE_STORAGE_KEY, createManualInputTracker, VOICE_HINT_IDLE_MS, VOICE_HINT_THRESHOLD } from "./experience-guidance.js";

export function bindExperienceGuidance({ guidance, input, voice, t, root = document }) {
  const reminder = root.querySelector("#voice-guidance");
  const toggle = root.querySelector("#experience-guidance-toggle");
  const voiceButton = root.querySelector("#voice-input-button");
  const tracker = createManualInputTracker();
  let timer;
  let composing = false;
  let eligibleEdit = false;
  let idle = false;
  const listeners = new AbortController();
  const listen = (target, event, callback) => target?.addEventListener(event, callback, { signal: listeners.signal });
  const ownsFocus = element => element === input || element === voiceButton || reminder.contains(element);
  function eligible() {
    return eligibleEdit && idle && !composing && voice.available && !voice.active
      && !input.hidden && !input.disabled && ownsFocus(root.activeElement)
      && [...input.value.trim()].length > VOICE_HINT_THRESHOLD;
  }
  function render() {
    reminder.replaceChildren();
    const message = root.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = t("guidanceVoiceMessage");
    const actions = root.createElement("div");
    for (const [action, key] of [["accepted", "guidanceVoiceTry"], ["later", "guidanceLater"], ["never", "guidanceNever"]]) {
      const button = root.createElement("button");
      button.type = "button";
      button.dataset.guidanceAction = action;
      button.textContent = t(key);
      actions.append(button);
    }
    reminder.append(message, actions);
    reminder.hidden = false;
  }
  function clear() {
    clearTimeout(timer);
    idle = false;
    guidance.cancel("voice");
  }
  function schedule() {
    clearTimeout(timer);
    if (!eligibleEdit || composing) return;
    timer = setTimeout(() => {
      idle = true;
      guidance.offer({ id: "voice", family: "voice", priority: 20, eligible,
        show: render, hide: () => { reminder.hidden = true; } });
    }, VOICE_HINT_IDLE_MS);
  }
  function resetInput() {
    clear(); eligibleEdit = false; tracker.reset(input.value);
  }
  listen(input, "beforeinput", () => tracker.beforeEdit(input.value));
  listen(input, "compositionstart", () => { composing = true; clear(); });
  listen(input, "compositionend", () => { composing = false; schedule(); });
  listen(input, "input", event => {
    clear();
    eligibleEdit = tracker.edit({ value: input.value, isTrusted: event.isTrusted, inputType: event.inputType });
    if (!event.isComposing) schedule();
  });
  listen(input, "paste", resetInput);
  listen(input, "drop", resetInput);
  listen(input.form, "submit", resetInput);
  // Keep the hint available when keyboard focus moves from the input to its buttons.
  listen(input, "blur", event => {
    if (!ownsFocus(event.relatedTarget)) clear();
  });
  listen(root, "focusin", event => { if (!ownsFocus(event.target)) clear(); });
  listen(reminder, "click", event => {
    const action = event.target.closest("[data-guidance-action]")?.dataset.guidanceAction;
    if (!action) return;
    guidance.respond("voice", action);
    if (action === "accepted") voice.start();
    input.focus();
  });
  toggle.checked = guidance.snapshot().enabled;
  listen(toggle, "change", () => guidance.setEnabled(toggle.checked));
  const refresh = () => {
    guidance.refresh();
    toggle.checked = guidance.snapshot().enabled;
  };
  // Shared scheduling reacts to dialogs, onboarding, page visibility and request UI.
  const mutationObserver = new MutationObserver(() => {
    guidance.refresh();
    observeFollowups();
  });
  const observed = new WeakSet();
  const intersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || root.hidden) continue;
      guidance.contextual("shown", entry.target.dataset.guidanceResponse);
      intersectionObserver.unobserve(entry.target);
    }
  });
  function observeFollowups() {
    root.querySelectorAll("[data-guidance-response]").forEach(node => {
      if (!observed.has(node)) { observed.add(node); intersectionObserver.observe(node); }
    });
  }
  mutationObserver.observe(root.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["hidden", "class", "open", "disabled"] });
  listen(root, "visibilitychange", refresh);
  listen(window, "storage", event => {
    if (!event.key || event.key === GUIDANCE_STORAGE_KEY) refresh();
  });
  observeFollowups();
  return {
    resetInput,
    refreshLocale() { if (!reminder.hidden) render(); },
    destroy() { clear(); listeners.abort(); mutationObserver.disconnect(); intersectionObserver.disconnect(); }
  };
}
