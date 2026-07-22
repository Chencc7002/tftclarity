import { readFile } from "node:fs/promises";

export const BASE_CONCLUSION_PROMPT_VERSION = "base-conclusion.v1";
export const CORRECTION_PROMPT_VERSION = "conclusion-correction.v1";

const BASE_PROMPT_URL = new URL("./prompts/base-conclusion.md", import.meta.url);
const CORRECTION_PROMPT_URL = new URL("./prompts/conclusion-correction.md", import.meta.url);

const ROUTES = Object.freeze({
  unit_build_rankings: Object.freeze({ key: "unit-build-rankings", version: "unit-build-rankings.v2", file: "unit-build-rankings.md" }),
  unit_build_completion: Object.freeze({ key: "unit-build-rankings", version: "unit-build-rankings.v2", file: "unit-build-rankings.md" }),
  unit_best_3_items: Object.freeze({ key: "unit-build-rankings", version: "unit-build-rankings.v2", file: "unit-build-rankings.md" }),
  unit_item_rankings: Object.freeze({ key: "unit-item-rankings", version: "unit-item-rankings.v2", file: "unit-item-rankings.md" }),
  unit_item_comparison: Object.freeze({ key: "unit-item-comparison", version: "unit-item-comparison.v1", file: "unit-item-comparison.md" }),
  unit_emblem_rankings: Object.freeze({ key: "unit-emblem-rankings", version: "unit-emblem-rankings.v1", file: "unit-emblem-rankings.md" }),
  comp_rankings: Object.freeze({ key: "comp-rankings", version: "comp-rankings.v1", file: "comp-rankings.md" }),
  comp_trends: Object.freeze({ key: "comp-trends", version: "comp-trends.v1", file: "comp-trends.md" }),
  comp_analysis: Object.freeze({ key: "comp-analysis", version: "comp-analysis.v1", file: "comp-analysis.md" })
});

export function getConclusionPromptRoute(intent) {
  const route = ROUTES[intent];
  return route ? { intent, ...route } : null;
}

export class ConclusionPromptRegistry {
  constructor(options = {}) {
    this.readFile = options.readFile ?? readFile;
    this.basePromptUrl = options.basePromptUrl ?? BASE_PROMPT_URL;
    this.correctionPromptUrl = options.correctionPromptUrl ?? CORRECTION_PROMPT_URL;
    this.cache = new Map();
  }

  has(intent) {
    return Boolean(ROUTES[intent]);
  }

  route(intent) {
    return getConclusionPromptRoute(intent);
  }

  async readCached(key, url) {
    if (!this.cache.has(key)) this.cache.set(key, Promise.resolve(this.readFile(url, "utf8")));
    return this.cache.get(key);
  }

  async load(intent, options = {}) {
    const route = this.route(intent);
    if (!route) return null;
    const base = await this.readCached("base", this.basePromptUrl);
    const intentUrl = new URL(`./prompts/conclusion-intents/${route.file}`, import.meta.url);
    const intentPrompt = await this.readCached(`intent:${route.key}`, intentUrl);
    const correction = options.correction
      ? await this.readCached("correction", this.correctionPromptUrl)
      : null;
    return {
      intent,
      key: route.key,
      baseVersion: BASE_CONCLUSION_PROMPT_VERSION,
      intentVersion: route.version,
      correctionVersion: correction ? CORRECTION_PROMPT_VERSION : null,
      text: [base.trim(), intentPrompt.trim(), correction?.trim()].filter(Boolean).join("\n\n---\n\n")
    };
  }

  versions(intent, model = null) {
    const route = this.route(intent);
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
