const baseArg = process.argv.find((value) => value.startsWith("--base-url="));
const expectedArg = process.argv.find((value) => value.startsWith("--expected-options="));
const expectMissingMechanics = process.argv.includes("--expect-missing-mechanics");
const baseUrl = baseArg?.slice("--base-url=".length) ?? "http://127.0.0.1:17330";
const expectedOptions = Number(expectedArg?.slice("--expected-options=".length) ?? 3);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const response = await fetch(`${baseUrl}/api/react-chat/stream`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/x-ndjson" },
  body: JSON.stringify({
    requestId: `ui07-${expectedOptions}-${Date.now()}`,
    input: "查卡尔玛出装，并解释三套方案在装备机制上的区别",
    conversationId: `ui07-${expectedOptions}-${Date.now()}`,
    seasonContextId: "set17-live"
  })
});
check(response.ok, `UI-07 endpoint returned HTTP ${response.status}`);
const events = (await response.text()).trim().split("\n").filter(Boolean).map(JSON.parse);
const complete = events.findLast((event) => event.type === "complete");
check(complete?.payload?.ok === true, "UI-07 request did not complete");
const payload = complete.payload;
const buildEvidenceEntries = payload.evidence?.filter((entry) => entry.toolName === "unit_builds_batch") ?? [];
check(buildEvidenceEntries.length === 1, "UI-07 must call the build statistics tool exactly once");
const itemEvidenceEntries = payload.evidence?.filter((entry) => entry.toolName === "item_details_batch") ?? [];
check(itemEvidenceEntries.length === 1, "UI-07 must call the item details batch exactly once");
const result = buildEvidenceEntries[0]?.value?.results?.[0];
const options = result?.buildOptions ?? [];
check(options.length === expectedOptions, `expected ${expectedOptions} build options, received ${options.length}`);
check(options[0]?.role === "stable", "the first build option is not stable");
check(options.slice(1).every((option) => option.role === "alternative"), "alternative roles are invalid");
check(new Set(options.map((option) => option.optionId)).size === options.length, "option ids are not unique");
check(new Set(options.map((option) => option.items.map((item) => item.apiName).sort().join("|"))).size === options.length, "duplicate item sets were returned");
check(options.every((option) => option.ranking?.strategy === "robust_applicability_v3"), "non-deterministic ranking strategy detected");
check(payload.narrative?.options?.length === expectedOptions, "per-option grounded narrative is incomplete");
check(payload.narrative.options.every((entry, index) => entry.optionId === options[index].optionId), "narrative changed deterministic option order");
const itemBatch = itemEvidenceEntries[0].value;
check(
  JSON.stringify(itemBatch.selection?.apiNames) === JSON.stringify(result.mechanismQueryPlan?.apiNames),
  "item_details_batch did not use the deterministic difference selection"
);
check(itemBatch.selection.apiNames.length <= 4, "item mechanism query exceeded the four-item limit");
if (expectMissingMechanics) {
  check(itemBatch.mechanismStatus === "unavailable", "UI-07E expected unavailable mechanism evidence");
  check(itemBatch.warnings?.includes("current_season_item_evidence_missing"), "UI-07E warning is missing");
  check(payload.narrative.options.every((entry) => entry.mechanismDifference == null), "UI-07E invented missing item mechanics");
  check(payload.narrative.options.every((entry) => (entry.suitableWhen ?? []).length === 0), "UI-07E invented mechanism-based advice");
} else {
  check(itemBatch.mechanismStatus === "available", "UI-07D current-season item evidence is unavailable");
  const explained = payload.narrative.options.filter((entry) => entry.mechanismDifference);
  check(explained.length === Math.max(0, expectedOptions - 1), "UI-07D did not explain each alternative's selected mechanism pair");
  check(explained.every((entry) => entry.suitableWhen?.every((condition) => (
    condition.inferenceType === "mechanism_based_advice"
  ))), "UI-07D did not label mechanism-based advice");
  check(JSON.stringify(explained).includes("重伤"), "UI-07D did not explain Morello's wound mechanism");
  check(JSON.stringify(explained).includes("技能可以暴击"), "UI-07D did not explain Jeweled Gauntlet's spell-crit mechanism");
}
if (expectedOptions < 3) {
  check(result.availableOptionCount === expectedOptions, "availableOptionCount mismatch");
  check(result.shortageReason === "insufficient_samples", `unexpected shortageReason: ${result.shortageReason}`);
} else {
  check(result.shortageReason === null, `unexpected shortageReason: ${result.shortageReason}`);
}

console.log(JSON.stringify({
  ok: true,
  expectedOptions,
  optionIds: options.map((option) => option.optionId),
  roles: options.map((option) => option.role),
  samples: options.map((option) => option.metrics.samples),
  shortageReason: result.shortageReason,
  narrativeBound: true,
  mechanismStatus: itemBatch.mechanismStatus,
  mechanismApiNames: itemBatch.selection.apiNames,
  toolCalls: buildEvidenceEntries.length + itemEvidenceEntries.length
}, null, 2));
