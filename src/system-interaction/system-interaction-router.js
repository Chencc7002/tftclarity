import { TFT_CAPABILITY_REGISTRY } from "./capability-registry.js";
import {
  unhandledSystemInteraction,
  validateSystemInteractionResult
} from "./system-interaction-contracts.js";
import { greetingHandler } from "./handlers/greeting-handler.js";
import { capabilityHelpHandler } from "./handlers/capability-help-handler.js";
import { usageHelpHandler } from "./handlers/usage-help-handler.js";
import { outOfDomainHandler } from "./handlers/out-of-domain-handler.js";

export const DEFAULT_SYSTEM_INTERACTION_HANDLERS = Object.freeze([
  greetingHandler,
  capabilityHelpHandler,
  usageHelpHandler,
  outOfDomainHandler
]);

function validateHandler(handler) {
  if (!handler || typeof handler !== "object") {
    throw new TypeError("System interaction handler must be an object");
  }
  if (!handler.interactionType) {
    throw new TypeError("System interaction handler requires interactionType");
  }
  if (typeof handler.matches !== "function" || typeof handler.handle !== "function") {
    throw new TypeError(`System interaction handler ${handler.interactionType} requires matches() and handle()`);
  }
  return handler;
}

export class SystemInteractionRouter {
  constructor(options = {}) {
    this.registry = options.registry ?? TFT_CAPABILITY_REGISTRY;
    this.handlers = [...(options.handlers ?? DEFAULT_SYSTEM_INTERACTION_HANDLERS)]
      .map(validateHandler);
  }

  route(value = {}) {
    const input = String(value.input ?? value.question ?? "").trim();
    if (!input) return unhandledSystemInteraction();
    const context = {
      ...value,
      input,
      registry: this.registry
    };
    for (const handler of this.handlers) {
      if (!handler.matches(context)) continue;
      const result = handler.handle(context);
      const validation = validateSystemInteractionResult(result);
      if (!validation.valid) {
        throw new TypeError(
          `Invalid ${handler.interactionType} system interaction result: ${validation.errors.join("; ")}`
        );
      }
      return result;
    }
    return unhandledSystemInteraction();
  }
}

export function createSystemInteractionRouter(options = {}) {
  return new SystemInteractionRouter(options);
}

export function routeSystemInteraction(value = {}, options = {}) {
  return createSystemInteractionRouter(options).route(value);
}
