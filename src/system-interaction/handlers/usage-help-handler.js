import {
  compactSystemInteractionInput,
  createSystemInteractionResult
} from "../system-interaction-contracts.js";
import { renderUsageHelp } from "../renderers/system-interaction-renderers.js";

const USAGE_HELP_PATTERNS = [
  /^(?:这个网站)?怎么使用$/u,
  /^应该怎么问$/u,
  /^我应该怎么问$/u,
  /^给我几个问题示例$/u,
  /^给几个问题示例$/u,
  /^有哪些问题示例$/u,
  /^怎么查装备$/u,
  /^怎么查阵容$/u,
  /^如何查装备$/u,
  /^如何查阵容$/u
];

export const usageHelpHandler = Object.freeze({
  interactionType: "usage_help",
  matches({ input }) {
    const compact = compactSystemInteractionInput(input);
    return USAGE_HELP_PATTERNS.some((pattern) => pattern.test(compact));
  },
  handle({ registry }) {
    return createSystemInteractionResult({
      interactionType: "usage_help",
      answer: renderUsageHelp(registry)
    });
  }
});
