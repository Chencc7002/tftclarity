import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17335/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))?.slice("--season=".length)
  ?? "set17-live";
const count = Math.max(1, Math.min(20, Number(
  process.argv.find((value) => value.startsWith("--count="))?.slice("--count=".length) ?? 10
)));
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/ra-01-real-hero-matrix.json"
);

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function score(seed, apiName) {
  return createHash("sha256").update(`${seed}|${apiName}`).digest("hex");
}

function supportedUnit(unit) {
  return (
    /^TFT17_[A-Za-z0-9]+$/u.test(String(unit.apiName ?? ""))
    && Number(unit.cost) >= 1
    && Number(unit.cost) <= 5
    && unit.hasDetails === true
    && Array.isArray(unit.traitNames)
    && unit.traitNames.length > 0
    && !/(?:Fake|PVE|Summon|Core)/iu.test(unit.apiName)
  );
}

function sampleUnits(units, seed, limit) {
  const sorted = [...units].sort((a, b) => score(seed, a.apiName).localeCompare(score(seed, b.apiName)));
  const byCost = new Map([1, 2, 3, 4, 5].map((cost) => [cost, sorted.filter((unit) => unit.cost === cost)]));
  const selected = [];
  let layer = 0;
  while (selected.length < limit) {
    let progressed = false;
    for (const cost of [1, 2, 3, 4, 5]) {
      const candidate = byCost.get(cost)?.[layer];
      if (!candidate || selected.length >= limit) continue;
      selected.push(candidate);
      progressed = true;
    }
    if (!progressed) break;
    layer += 1;
  }
  return selected;
}

async function runUnit(unit) {
  const startedAt = Date.now();
  const input = `${unit.name}怎么做装备`;
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      input,
      conversationId: `ra-01-${unit.apiName}-${Date.now()}`,
      seasonContextId
    })
  });
  const lines = (await response.text()).trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const complete = lines.findLast((line) => line.type === "complete");
  const payload = complete?.payload ?? {};
  const buildEvidence = (payload.evidence ?? []).find((entry) => entry.toolName === "unit_builds_batch");
  const entityResult = buildEvidence?.value?.results?.find((entry) => entry.apiName === unit.apiName)
    ?? buildEvidence?.value?.results?.[0]
    ?? null;
  const optionCount = entityResult?.buildOptions?.length ?? 0;
  const eventTypes = events.map((event) => event.type);
  const rejectionErrors = events
    .filter((event) => event.type === "decision_rejected")
    .flatMap((event) => event.data?.errors ?? []);
  const legalFinish = (
    response.ok
    && complete?.statusCode === 200
    && payload.status !== "failed"
    && !["invalid_finish", "missing_required_evidence", "decision_provider_failed"].includes(payload.terminationReason)
    && typeof payload.answer === "string"
    && payload.answer.length > 0
  );
  return {
    input,
    apiName: unit.apiName,
    name: unit.name,
    cost: unit.cost,
    traits: unit.traitNames,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    legalFinish,
    optionCount,
    roles: (entityResult?.buildOptions ?? []).map((option) => option.role),
    cache: buildEvidence?.value?.source?.cache ?? null,
    evidenceIds: payload.evidenceIds ?? [],
    toolSequence: events.filter((event) => event.type === "tool_started").map((event) => event.data?.tool),
    eventTypes,
    rejectionErrors,
    unknownToolExecutions: rejectionErrors.filter((error) => /not registered|unknown tool/iu.test(error)).length,
    finalAnswerPreview: String(payload.answer ?? "").slice(0, 240),
    latencyMs: Date.now() - startedAt
  };
}

const runtime = await json(new URL("/api/runtime", baseUrl));
const provenance = runtime.runtime?.acceptanceProvenance ?? null;
if (
  provenance?.decisionProviderMode !== "real_model"
  || provenance?.fixtureMode !== false
  || provenance?.toolHandlerMode !== "production"
) {
  throw new Error(`RA-00 provenance failed: ${JSON.stringify(provenance)}`);
}
const catalog = await json(new URL(`/api/entity-catalog?type=unit&seasonContextId=${encodeURIComponent(seasonContextId)}`, baseUrl));
const candidates = (catalog.items ?? []).filter(supportedUnit);
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const seed = createHash("sha256").update(`${gitHead}|${seasonContextId}`).digest("hex");
const selected = sampleUnits(candidates, seed, count);
if (selected.length !== count) throw new Error(`Only ${selected.length}/${count} supported units were sampled`);

const results = [];
for (let index = 0; index < selected.length; index += 2) {
  const batch = selected.slice(index, index + 2);
  results.push(...await Promise.all(batch.map(runUnit)));
  console.log(`RA-01 progress ${results.length}/${selected.length}: ${batch.map((unit) => unit.name).join(", ")}`);
}

const legalFinishCount = results.filter((result) => result.legalFinish).length;
const dataBearingCount = results.filter((result) => result.optionCount > 0).length;
const failedCount = results.filter((result) => result.status === "failed").length;
const invalidFinishCount = results.filter((result) => result.terminationReason === "invalid_finish").length;
const unknownToolExecutions = results.reduce((sum, result) => sum + result.unknownToolExecutions, 0);
const report = {
  schemaVersion: "r1-real-hero-matrix.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  gitHead,
  seed,
  provenance,
  selection: selected.map(({ apiName, name, cost, traitNames }) => ({ apiName, name, cost, traitNames })),
  thresholds: {
    legalFinish: `${count}/${count}`,
    dataBearing: `${Math.ceil(count * 0.8)}/${count}`,
    failed: 0,
    invalidFinish: 0,
    unknownToolExecutions: 0
  },
  summary: {
    ok: (
      legalFinishCount === count
      && dataBearingCount >= Math.ceil(count * 0.8)
      && failedCount === 0
      && invalidFinishCount === 0
      && unknownToolExecutions === 0
    ),
    legalFinishCount,
    dataBearingCount,
    failedCount,
    invalidFinishCount,
    unknownToolExecutions
  },
  results
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary, selected: report.selection }, null, 2));
if (!report.summary.ok) process.exitCode = 1;
