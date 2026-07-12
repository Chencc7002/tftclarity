import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildItemCatalogFromItemsResponse,
  ITEM_AVAILABILITY_OVERRIDES
} from "../src/index.js";

function parseArgs(argv) {
  const options = {
    patch: "current",
    probePath: resolve(".probe", "meta_items_expanded.json")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--patch" && argv[index + 1]) {
      options.patch = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--patch=")) {
      options.patch = arg.slice("--patch=".length);
    } else if (arg === "--probe" && argv[index + 1]) {
      options.probePath = resolve(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--probe=")) {
      options.probePath = resolve(arg.slice("--probe=".length));
    }
  }

  return options;
}

function appliesToPatch(override, patch) {
  return override.patch === "*"
    || String(override.patch).toLowerCase() === String(patch).toLowerCase();
}

function validateOverrideShape(override, index, errors) {
  if (!override.apiName) errors.push(`override[${index}] is missing apiName`);
  if (!override.patch) errors.push(`override[${index}] is missing patch`);
  if (override.category !== "removed_or_legacy") {
    errors.push(`override[${index}] must use category=removed_or_legacy`);
  }
  if (override.current !== false || override.obtainable !== false) {
    errors.push(`override[${index}] must set current=false and obtainable=false`);
  }
  if (!override.reason || !override.source) {
    errors.push(`override[${index}] must include reason and source`);
  }
  if (["current", "*"].includes(String(override.patch).trim().toLowerCase())) {
    errors.push(`override[${index}] must bind to an explicit patch, not ${override.patch}`);
  }
  if (!override.season) errors.push(`override[${index}] is missing season`);
}

const options = parseArgs(process.argv.slice(2));
const response = JSON.parse(await readFile(options.probePath, "utf8"));
const catalog = buildItemCatalogFromItemsResponse(response, { patch: options.patch });
const byApiName = new Map(catalog.map((item) => [item.apiName, item]));
const applicable = ITEM_AVAILABILITY_OVERRIDES.filter((override) => (
  appliesToPatch(override, options.patch)
));
const errors = [];
const seen = new Set();

ITEM_AVAILABILITY_OVERRIDES.forEach((override, index) => {
  validateOverrideShape(override, index, errors);
  const key = `${override.apiName}:${String(override.patch).toLowerCase()}`;
  if (seen.has(key)) errors.push(`duplicate availability override: ${key}`);
  seen.add(key);
});

let observed = 0;
for (const override of applicable) {
  const record = byApiName.get(override.apiName);
  if (record?.raw) observed += 1;

  const synthetic = buildItemCatalogFromItemsResponse({
    data: [{ items: override.apiName, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
  }, {
    patch: options.patch
  }).find((item) => item.apiName === override.apiName);

  if (
    synthetic?.category !== "removed_or_legacy"
    || synthetic.current !== false
    || synthetic.obtainable !== false
    || synthetic.availabilityOverride !== true
  ) {
    errors.push(`availability override is not enforced by the generated catalog: ${override.apiName}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `item availability overrides: total=${ITEM_AVAILABILITY_OVERRIDES.length}, `
    + `patch=${options.patch}, applicable=${applicable.length}, observed=${observed}`
  );
  for (const override of applicable) {
    console.log(`${override.apiName}: removed_or_legacy (${override.source})`);
  }
}
