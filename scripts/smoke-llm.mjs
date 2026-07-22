import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  CURRENT_ITEM_LOCALIZATION,
  buildItemCatalogFromItemsResponse,
  createCatalog,
  createStructuredParserFromConfig,
  parseQuery,
  resolveStructuredParserConfig,
  validateStructuredParserOutput
} from "../src/index.js";

loadLocalEnvironment();
const config = resolveStructuredParserConfig();
if (!config.enabled) {
  throw new Error("LLM is disabled. Configure .env from .env.example before running this smoke test.");
}

const parser = createStructuredParserFromConfig(config);
const defaultInput = "霞带羊刀，推荐另外两件普通装备";
const input = process.env.SMOKE_LLM_QUERY ?? defaultInput;
const expectedIntent = process.env.SMOKE_LLM_EXPECT_INTENT;
const expectedPreferencesRaw = process.env.SMOKE_LLM_EXPECT_PREFERENCES;
const catalog = createCatalog({
  items: buildItemCatalogFromItemsResponse({
    data: CURRENT_ITEM_LOCALIZATION.items.map((item) => ({ items: item.apiName }))
  }, { patch: "current" })
});
const deterministicParsed = parseQuery(input, { catalog });
const relevantItemApiNames = [
  ...(deterministicParsed.lockedItems ?? []),
  ...(deterministicParsed.comparisonItems ?? []),
  ...(deterministicParsed.excludedItems ?? [])
];
const relevantUnit = deterministicParsed.unit
  ? catalog.unitByApiName.get(deterministicParsed.unit)
  : null;
const relevantItems = relevantItemApiNames
  .map((apiName) => catalog.itemByApiName.get(apiName))
  .filter(Boolean);
const response = await parser({
  input,
  parsed: deterministicParsed,
  catalogSummary: {
    unitAliases: relevantUnit
      ? [relevantUnit.zhName, relevantUnit.shortName, ...(relevantUnit.aliases ?? [])].filter(Boolean)
      : [],
    itemAliases: relevantItems
      .flatMap((item) => [item.zhName, item.shortName, ...(item.aliases ?? [])])
      .filter(Boolean),
    traitAliases: []
  }
});
const validation = validateStructuredParserOutput(response);
if (!validation.valid) {
  throw new Error(`LLM returned invalid structured output: ${validation.errors.join("; ")}`);
}
if (expectedIntent && validation.value.intent !== expectedIntent) {
  throw new Error(`LLM returned intent ${validation.value.intent}; expected ${expectedIntent}`);
}
let expectedPreferences = null;
if (expectedPreferencesRaw) {
  try {
    expectedPreferences = JSON.parse(expectedPreferencesRaw);
  } catch (error) {
    throw new Error(`SMOKE_LLM_EXPECT_PREFERENCES must be valid JSON: ${error.message}`);
  }
  for (const [field, expected] of Object.entries(expectedPreferences)) {
    const actual = validation.value.constraints[field];
    if (actual !== expected) {
      throw new Error(`LLM returned ${field}=${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  provider: config.provider,
  model: config.model,
  endpointHost: new URL(config.endpoint).host,
  mode: config.mode,
  intent: validation.value.intent,
  customInput: input !== defaultInput,
  unitMentions: validation.value.entities.unitMentions.length,
  itemMentions: validation.value.entities.itemMentions.length,
  preferenceConditions: expectedPreferences ? Object.fromEntries(
    Object.keys(expectedPreferences).map((field) => [field, validation.value.constraints[field]])
  ) : null
}, null, 2));
