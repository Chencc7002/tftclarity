import { createJevIntentObserver } from "../src/understanding/jev-intent-observer.js";

// Reads only the process environment. No automatic env-file load or API calls.
try {
  const observer = createJevIntentObserver({ env: process.env });
  const { mode, sampleRate, maxRequests, controlMinConfidence } = observer.snapshot();
  const keyPresent = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  const dimensions = createJevIntentObserver({ env: process.env, policy: "dimensions",
    mode: process.env.TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE ?? "off",
    maxRequests: Number(process.env.TFT_AGENT_JEV_INTENT_DIMENSIONS_MAX_REQUESTS ?? 25),
    sampleRate: Number(process.env.TFT_AGENT_JEV_INTENT_DIMENSIONS_SAMPLE_RATE ?? 0.05) }).snapshot();
  const dimensionsReady = dimensions.mode === "off" || (keyPresent && dimensions.sampleRate > 0 && dimensions.maxRequests > 0);
  const ready = dimensionsReady && (dimensions.mode === "control" || mode === "off" || (keyPresent && sampleRate > 0 && maxRequests > 0));
  console.log(JSON.stringify({ ready, mode, keyPresent, sampleRate, maxRequests, controlMinConfidence,
    calls: 0, controlSupported: true, controlAuthority: "intent_hint_only",
    dimensions: { mode: dimensions.mode, sampleRate: dimensions.sampleRate, maxRequests: dimensions.maxRequests,
      threshold: dimensions.controlMinConfidence },
    requestCapScope: "runtime-lifetime" }, null, 2));
  if (!ready) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ ready: false, reason: "invalid_configuration", calls: 0 }));
  process.exitCode = 1;
}
