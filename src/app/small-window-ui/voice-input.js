export function appendVoiceTranscript(base, transcript) {
  const left = String(base ?? "").trimEnd();
  const right = String(transcript ?? "").trim();
  if (!left) return right;
  if (!right) return left;
  const needsSpace = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function speechConstructor() {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
}

export function createVoiceInput({
  button,
  input,
  status,
  t,
  getLocale,
  onStarted = () => {},
  RecognitionConstructor = speechConstructor()
} = {}) {
  if (!button || !input || !status) {
    return { supported: false, active: false, cancel() {}, refreshLocale() {}, setEnabled() {} };
  }

  let recognition = null;
  let active = false;
  let starting = false;
  let enabled = true;
  let permissionBlocked = false;
  let baseText = "";
  let applyingTranscript = false;
  let statusKey = "";
  let statusTimer = null;
  const finalSegments = new Map();
  const supported = typeof RecognitionConstructor === "function";

  function localizedLocale() {
    return getLocale?.() === "en-US" ? "en-US" : "zh-CN";
  }

  function announce(key, { autoHide = false } = {}) {
    clearTimeout(statusTimer);
    statusKey = key;
    status.textContent = key ? t(key) : "";
    status.hidden = !key;
    if (key && autoHide) {
      statusTimer = setTimeout(() => {
        statusKey = "";
        status.textContent = "";
        status.hidden = true;
      }, 2600);
    }
  }

  function updateButton() {
    const listening = active || starting;
    const labelKey = !supported ? "voiceUnsupported" : listening ? "voiceStop" : "voiceStart";
    button.setAttribute("aria-label", t(labelKey));
    button.title = t(labelKey);
    button.setAttribute("aria-pressed", String(listening));
    button.setAttribute("aria-disabled", String(!supported || !enabled));
    button.classList.toggle("is-listening", listening);
  }

  function composedTranscript(results) {
    const interim = [];
    for (const index of [...finalSegments.keys()]) {
      if (index >= results.length) finalSegments.delete(index);
    }
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) finalSegments.set(index, transcript);
      else if (transcript) interim.push(transcript);
    }
    return [...finalSegments.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)
      .concat(interim)
      .reduce((combined, segment) => appendVoiceTranscript(combined, segment), "");
  }

  function applyTranscript(transcript) {
    applyingTranscript = true;
    input.value = appendVoiceTranscript(baseText, transcript);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    applyingTranscript = false;
  }

  function cancel({ silent = false } = {}) {
    if (!recognition || (!active && !starting)) return;
    active = false;
    starting = false;
    try { recognition.abort(); } catch {}
    updateButton();
    if (silent) announce("");
    else announce("voiceStopped", { autoHide: true });
  }

  function start() {
    if (!enabled) return;
    if (!supported) {
      announce("voiceUnsupported");
      updateButton();
      return;
    }
    if (active || starting) {
      active = false;
      starting = false;
      try { recognition?.stop(); } catch {}
      updateButton();
      announce("voiceStopped", { autoHide: true });
      return;
    }
    finalSegments.clear();
    baseText = input.value;
    recognition = new RecognitionConstructor();
    recognition.lang = localizedLocale();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      starting = false;
      active = true;
      updateButton();
      announce("voiceListening");
      permissionBlocked = false;
      onStarted();
    };
    recognition.onresult = (event) => {
      if (!active && !starting) return;
      applyTranscript(composedTranscript(event.results));
    };
    recognition.onerror = (event) => {
      active = false;
      starting = false;
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) permissionBlocked = true;
      updateButton();
      const key = ["not-allowed", "service-not-allowed"].includes(event.error) ? "voicePermissionDenied"
        : event.error === "audio-capture" ? "voiceMicrophoneUnavailable"
          : event.error === "no-speech" ? "voiceNoSpeech"
            : event.error === "network" ? "voiceNetworkError"
              : event.error === "aborted" ? "" : "voiceRecognitionFailed";
      if (key) announce(key);
    };
    recognition.onend = () => {
      const wasListening = active || starting;
      active = false;
      starting = false;
      updateButton();
      if (wasListening) announce("voiceStopped", { autoHide: true });
    };
    starting = true;
    updateButton();
    announce("voiceRequestingPermission");
    try { recognition.start(); }
    catch {
      active = false;
      starting = false;
      updateButton();
      announce("voiceRecognitionFailed");
    }
  }

  button.addEventListener("click", start);
  input.addEventListener("input", () => {
    if (!applyingTranscript && (active || starting)) cancel({ silent: true });
  });
  input.form?.addEventListener("submit", () => cancel({ silent: true }));
  updateButton();

  return {
    supported,
    get available() { return supported && enabled && !permissionBlocked; },
    get active() { return active || starting; },
    start,
    cancel,
    refreshLocale() {
      updateButton();
      if (statusKey) status.textContent = t(statusKey);
    },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      if (!enabled) cancel({ silent: true });
      button.disabled = !enabled;
      updateButton();
    }
  };
}
