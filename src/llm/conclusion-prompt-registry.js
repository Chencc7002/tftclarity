import { readFile } from "node:fs/promises";
import { CONCLUSION_SPEC_REGISTRY } from "./conclusion-spec-registry.js";

export const BASE_CONCLUSION_PROMPT_VERSION = "base-conclusion.v3";
export const CORRECTION_PROMPT_VERSION = "conclusion-correction.v3";

const BASE_PROMPT_URL = new URL("./prompts/base-conclusion.md", import.meta.url);
const CORRECTION_PROMPT_URL = new URL("./prompts/conclusion-correction.md", import.meta.url);

const ROUTES = Object.freeze(Object.fromEntries(CONCLUSION_SPEC_REGISTRY.list({ enabled: true })
  .filter((entry) => entry.match.questionType === "default" || entry.match.intent === "comp_analysis" && entry.match.questionType === "meta_fit")
  .map((entry) => [entry.match.intent, Object.freeze({ ...entry.prompt })])));

export function getConclusionPromptRoute(intent, questionType = "default", resultType = intent) {
  try {
    const normalizedQuestionType = intent === "comp_analysis" && questionType === "default" ? "meta_fit" : questionType;
    const spec = CONCLUSION_SPEC_REGISTRY.resolve({ intent, questionType: normalizedQuestionType, resultType });
    return { intent, questionType, specId: spec.id, specVersion: spec.version, ...spec.prompt };
  } catch {
    return null;
  }
}

export class ConclusionPromptRegistry {
  constructor(options = {}) {
    this.readFile = options.readFile ?? readFile;
    this.basePromptUrl = options.basePromptUrl ?? BASE_PROMPT_URL;
    this.correctionPromptUrl = options.correctionPromptUrl ?? CORRECTION_PROMPT_URL;
    this.cache = new Map();
  }

  has(intent, questionType = "default", resultType = intent) {
    return Boolean(getConclusionPromptRoute(intent, questionType, resultType));
  }

  route(intentOrContext, questionType = "default", resultType = intentOrContext) {
    if (intentOrContext && typeof intentOrContext === "object") {
      const spec = intentOrContext.specId ? CONCLUSION_SPEC_REGISTRY.get(intentOrContext.specId) : null;
      return spec ? {
        intent: spec.match.intent, questionType: spec.match.questionType,
        specId: spec.id, specVersion: spec.version, ...spec.prompt
      } : getConclusionPromptRoute(intentOrContext.intent, intentOrContext.questionType, intentOrContext.resultType);
    }
    return getConclusionPromptRoute(intentOrContext, questionType, resultType);
  }

  async readCached(key, url) {
    if (!this.cache.has(key)) this.cache.set(key, Promise.resolve(this.readFile(url, "utf8")));
    return this.cache.get(key);
  }

  async load(intentOrContext, options = {}) {
    const route = this.route(intentOrContext);
    if (!route) return null;
    const base = await this.readCached("base", this.basePromptUrl);
    const intentUrl = new URL(`./prompts/conclusion-intents/${route.file}`, import.meta.url);
    const intentPrompt = await this.readCached(`intent:${route.key}`, intentUrl);
    const correction = options.correction
      ? await this.readCached("correction", this.correctionPromptUrl)
      : null;
    return {
      intent: route.intent,
      questionType: route.questionType,
      specId: route.specId,
      key: route.key,
      baseVersion: BASE_CONCLUSION_PROMPT_VERSION,
      intentVersion: route.version,
      correctionVersion: correction ? CORRECTION_PROMPT_VERSION : null,
      text: [base.trim(), intentPrompt.trim(), correction?.trim()].filter(Boolean).join("\n\n---\n\n")
    };
  }

  versions(intentOrContext, model = null) {
    const route = this.route(intentOrContext);
    if (!route) return null;
    return {
      basePromptVersion: BASE_CONCLUSION_PROMPT_VERSION,
      intentPromptVersion: route.version,
      model: model ?? null
    };
  }
}

export function createConclusionPromptRegistry(options = {}) {
  return new ConclusionPromptRegistry(options);
}

export { ROUTES as CONCLUSION_PROMPT_ROUTES };
