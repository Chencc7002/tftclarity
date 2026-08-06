import {
  compactSystemInteractionInput,
  createSystemInteractionResult
} from "../system-interaction-contracts.js";
import { renderGreeting } from "../renderers/system-interaction-renderers.js";

const GREETINGS = new Set([
  "你好",
  "您好",
  "hi",
  "hello",
  "在吗",
  "早上好",
  "晚上好"
]);

export const greetingHandler = Object.freeze({
  interactionType: "greeting",
  matches({ input }) {
    const compact = compactSystemInteractionInput(input)
      .replace(/(?:呀|啊|哦|哈|呢)$/u, "");
    return GREETINGS.has(compact);
  },
  handle() {
    return createSystemInteractionResult({
      interactionType: "greeting",
      answer: renderGreeting()
    });
  }
});
