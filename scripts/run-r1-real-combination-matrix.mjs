import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17338/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))
  ?.slice("--season=".length) ?? "set17-live";
const repeatValue = Number(
  process.argv.find((value) => value.startsWith("--repeat="))?.slice("--repeat=".length) ?? 3
);
const repeats = Number.isFinite(repeatValue)
  ? Math.max(1, Math.min(10, Math.floor(repeatValue)))
  : 3;
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/r1-real-combination-matrix.json"
);

async function json(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function liveCompositions() {
  const requestId = randomUUID();
  const payload = await json("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: "推荐当前版本热门阵容",
      conversationId: `r1-composition-sample-${requestId}`,
      seasonContextId,
      quickTask: {
        schemaVersion: "quick-task.v1",
        id: "comp-rankings",
        operation: "comp_rankings",
        requestId,
        arguments: {}
      }
    })
  });
  const candidates = [
    ...(payload.rankings?.top4Rate ?? []),
    ...(payload.rankings?.popularity ?? []),
    ...(payload.rankings?.winRate ?? [])
  ];
  const seen = new Set();
  return candidates.filter((comp) => {
    if (!comp?.compId || !comp?.name || !comp.units?.length || seen.has(comp.compId)) return false;
    seen.add(comp.compId);
    return true;
  });
}

function roleClaimAudit(answer, memberEvidence) {
  const sentences = String(answer ?? "").split(/[。！？\n]+/u).map((value) => value.trim()).filter(Boolean);
  const checks = [
    { role: "coreMember", pattern: /(?:核心成员|阵容核心)/iu },
    { role: "primaryCarry", pattern: /(?:主\s*[cC]|核心输出|primary\s*carry)/iu },
    { role: "primaryTank", pattern: /(?:主坦|核心前排|primary\s*tank)/iu },
    { role: "flexSlot", pattern: /(?:灵活位|摇摆位|挂件|flex\s*slot)/iu }
  ];
  const assertiveUnsupported = [];
  const labeledInference = [];
  const negatedOrReserved = [];
  for (const sentence of sentences) {
    for (const { role, pattern } of checks) {
      if (!pattern.test(sentence) || memberEvidence?.roleEvidence?.[role] === "supported") continue;
      const signal = { role, sentence };
      if (/(?:我的判断|推测|推断|可能|更可能|倾向|或许|大概率|定性判断|非事实证据)/iu.test(sentence)) {
        labeledInference.push(signal);
      } else if (/(?:不是|并非|不能|无法|未(?:观察|显示|证明|确认)|没有|而非|不(?:能|足以|代表|证明)|证据不足|缺乏直接证据)/iu.test(sentence)) {
        negatedOrReserved.push(signal);
      } else {
        assertiveUnsupported.push(signal);
      }
    }
  }
  return { assertiveUnsupported, labeledInference, negatedOrReserved };
}

async function react(caseId, input, expectedMemberApiName = null) {
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      input,
      conversationId: `${caseId}-${randomUUID()}`,
      seasonContextId
    })
  });
  const raw = await response.text();
  const lines = raw.trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const complete = lines.findLast((line) => line.type === "complete");
  const payload = complete?.payload ?? {};
  const compEvidence = (payload.evidence ?? []).find((entry) => entry.toolName === "comps_rankings");
  const composition = compEvidence?.value?.results?.[0] ?? null;
  const memberEvidence = composition?.members?.find((member) => (
    member.apiName === expectedMemberApiName
  )) ?? null;
  return {
    caseId,
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    toolSequence: events.filter((event) => event.type === "tool_started")
      .map((event) => event.data?.tool),
    resolution: compEvidence?.value?.resolution ?? null,
    compositionRef: composition?.compositionRef ?? null,
    members: composition?.members ?? [],
    expectedMemberEvidence: memberEvidence,
    qualitativeAudit: {
      groundingAudit: payload.groundingAudit ?? null,
      roleClaims: roleClaimAudit(payload.answer, memberEvidence)
    },
    warnings: payload.warnings ?? [],
    unavailableTools: payload.unavailableTools ?? [],
    latencyMs: Date.now() - startedAt
  };
}

const runtime = await json("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? null;
if (
  provenance?.decisionProviderMode !== "real_model"
  || provenance?.toolHandlerMode !== "production"
  || provenance?.fixtureMode !== false
) {
  throw new Error(`Real acceptance provenance failed: ${JSON.stringify(provenance)}`);
}
const compositions = await liveCompositions();
if (!compositions.length) throw new Error("No current live composition was available for dynamic sampling");
const selected = compositions[0];
const selectedMember = selected.units[0];
const occurrences = new Map();
for (const comp of compositions) {
  for (const member of comp.units) {
    const list = occurrences.get(member.apiName) ?? [];
    list.push({ compId: comp.compId, name: member.name });
    occurrences.set(member.apiName, list);
  }
}
const ambiguousMember = [...occurrences.entries()]
  .filter(([, list]) => list.length > 1)
  .sort((left, right) => right[1].length - left[1].length)[0] ?? null;

const cases = [];
cases.push(await react(
  "R1-C01-composition-members",
  `请介绍${selected.name}阵容的完整成员，并说明你能确认哪些成员关系。`
));
console.log(`R1-C01 complete: ${selected.name}`);
for (let index = 0; index < repeats; index += 1) {
  cases.push(await react(
    `R1-C02-composition-unit-role-${index + 1}`,
    `在${selected.name}阵容里，${selectedMember.name}是什么定位？请区分事实证据和你的判断。`,
    selectedMember.apiName
  ));
  console.log(`R1-C02 repeat ${index + 1}/${repeats} complete`);
}
if (ambiguousMember) {
  cases.push(await react(
    "R1-C03-member-only-ambiguity",
    `${ambiguousMember[1][0].name}阵容有哪些成员？`
  ));
  console.log(`R1-C03 complete: ${ambiguousMember[1][0].name}`);
}

const identityCases = cases.filter((entry) => entry.caseId.startsWith("R1-C01"));
const roleCases = cases.filter((entry) => entry.caseId.startsWith("R1-C02"));
const ambiguousCases = cases.filter((entry) => entry.caseId.startsWith("R1-C03"));
const summary = {
  g1Resolved: identityCases.every((entry) => (
    entry.toolSequence.includes("comps_rankings")
    && entry.resolution?.status === "resolved"
    && entry.compositionRef?.compId === selected.compId
    && entry.members.length > 0
    && entry.members.every((member) => member.relations?.includes("member_of_comp"))
  )),
  g2MemberEvidence: roleCases.every((entry) => (
    entry.toolSequence.includes("comps_rankings")
    && entry.resolution?.status === "resolved"
    && entry.expectedMemberEvidence?.relations?.includes("member_of_comp")
  )),
  roleObservationRuns: roleCases.length,
  unsupportedAssertiveRoleClaimRuns: roleCases.filter((entry) => (
    entry.qualitativeAudit.roleClaims.assertiveUnsupported.length > 0
  )).length,
  unsupportedAssertiveRoleClaimFrequency: roleCases.length
    ? roleCases.filter((entry) => entry.qualitativeAudit.roleClaims.assertiveUnsupported.length > 0).length
      / roleCases.length
    : null,
  labeledQualitativeJudgmentRuns: roleCases.filter((entry) => (
    entry.qualitativeAudit.roleClaims.labeledInference.length > 0
  )).length,
  ambiguityHandled: ambiguousCases.length === 0 ? null : ambiguousCases.every((entry) => (
    entry.resolution?.status === "ambiguous"
    && ["clarification_required", "completed_with_warning"].includes(entry.status)
  ))
};
const report = {
  schemaVersion: "r1-real-combination-matrix.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  provenance,
  runtimeGroundingMode: runtime.runtime?.agent?.groundingMode ?? null,
  selection: {
    composition: {
      compId: selected.compId,
      name: selected.name,
      memberApiName: selectedMember.apiName,
      memberName: selectedMember.name
    },
    candidateCompositionCount: compositions.length,
    ambiguousMember: ambiguousMember ? {
      apiName: ambiguousMember[0],
      name: ambiguousMember[1][0].name,
      compositionCount: ambiguousMember[1].length
    } : null
  },
  summary,
  cases
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary, selection: report.selection }, null, 2));
if (!summary.g1Resolved || !summary.g2MemberEvidence || summary.ambiguityHandled === false) {
  process.exitCode = 1;
}
