import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createStructuredParserFromConfig,
  resolveStructuredParserConfig,
  validateStructuredParserOutput
} from "../src/index.js";

loadLocalEnvironment();
const config = resolveStructuredParserConfig();
if (!config.enabled) {
  throw new Error("LLM is disabled. Configure .env from .env.example before running this smoke test.");
}

const parser = createStructuredParserFromConfig(config);
const response = await parser({
  input: "霞带羊刀，推荐另外两件普通装备",
  parsed: {
    intent: "unit_best_3_items",
    unit: "TFT17_Xayah",
    itemCount: 3,
    itemPolicy: "ordinary_only",
    ownedItems: ["TFT_Item_GuinsoosRageblade"],
    parser: { entityMatches: [] }
  },
  catalogSummary: {
    unitAliases: ["霞", "Xayah"],
    itemAliases: ["羊刀", "鬼索的狂暴之刃", "Guinsoo's Rageblade"],
    traitAliases: []
  }
});
const validation = validateStructuredParserOutput(response);
if (!validation.valid) {
  throw new Error(`LLM returned invalid structured output: ${validation.errors.join("; ")}`);
}

console.log(JSON.stringify({
  ok: true,
  provider: config.provider,
  model: config.model,
  endpointHost: new URL(config.endpoint).host,
  mode: config.mode,
  intent: validation.value.intent
}, null, 2));
