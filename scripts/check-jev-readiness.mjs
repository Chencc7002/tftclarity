import { createJevIntentObserver } from "../src/understanding/jev-intent-observer.js";

// Reads only the process environment. No automatic env-file load or API calls.
try {
  const observer = createJevIntentObserver({ env: process.env });
  const { mode, sampleRate, maxRequests, controlMinConfidence } = observer.snapshot();
  const keyPresent = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  const ready = mode === "off" || (keyPresent && sampleRate > 0 && maxRequests > 0);
  console.log(JSON.stringify({ ready, mode, keyPresent, sampleRate, maxRequests, controlMinConfidence,
    calls: 0, controlSupported: true, controlAuthority: "intent_hint_only",
    requestCapScope: "runtime-lifetime" }, null, 2));
  if (!ready) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ ready: false, reason: "invalid_configuration", calls: 0 }));
  process.exitCode = 1;
}
