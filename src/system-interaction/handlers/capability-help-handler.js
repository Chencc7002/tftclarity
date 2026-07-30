import {
  compactSystemInteractionInput,
  createSystemInteractionResult
} from "../system-interaction-contracts.js";
import { renderCapabilityHelp } from "../renderers/system-interaction-renderers.js";

const CAPABILITY_HELP_PATTERNS = [
  /^你是谁(?:呀|啊)?$/u,
  /^你能做什么(?:呀|啊)?$/u,
  /^你有什么功能$/u,
  /^这个网站能干什么$/u,
  /^这个网站有什么功能$/u,
  /^tftclarity能做什么$/iu
];

export const capabilityHelpHandler = Object.freeze({
  interactionType: "capability_help",
  matches({ input }) {
    const compact = compactSystemInteractionInput(input);
    return CAPABILITY_HELP_PATTERNS.some((pattern) => pattern.test(compact));
  },
  handle({ registry }) {
    return createSystemInteractionResult({
      interactionType: "capability_help",
      answer: renderCapabilityHelp(registry)
    });
  }
});
