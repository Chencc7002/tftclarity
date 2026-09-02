import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { createSmallWindowRuntimeAsync, startSmallWindowServer } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { createUnitPlayBrowserCandidate } from "../src/experiments/unit-play-guidance-browser/candidate.js";
import { REACT_DECISION_PROMPT_VERSION, REACT_SCOPED_TACTICAL_PROMPT_VERSION } from "../src/react/react-decision-provider.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_4, UNIT_PLAY_GUIDANCE_SKILL_V1_5_2, UNIT_PLAY_GUIDANCE_SKILL_V1_5_3, UNIT_PLAY_GUIDANCE_SKILL_V1_5_4, UNIT_PLAY_GUIDANCE_SKILL_V1_5_5, UNIT_PLAY_GUIDANCE_SKILL_V1_5_6, UNIT_PLAY_GUIDANCE_SKILL_V1_5_7, UNIT_PLAY_GUIDANCE_SKILL_V1_5_8, UNIT_PLAY_GUIDANCE_SKILL_V1_5_9, UNIT_PLAY_GUIDANCE_SKILL_V1_5_10, UNIT_PLAY_GUIDANCE_SKILL_V1_5_11 } from "../src/skills/definitions/unit-play-guidance.js";

// Explicit local diagnostic, never loaded by the production server. User browser
// interactions can incur normal configured-provider usage; no automatic queries.
if (!process.argv.includes("--live")) throw new Error("Pass --live only for an authorized real-provider browser check");
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const messageLayout = arg("message-layout", "append_only");
if (!["append_only", "legacy_full_state"].includes(messageLayout)) throw new Error("Unknown provider message layout");
const decisionMessages = arg("decision-messages", "event");
if (!["event", "action"].includes(decisionMessages)) throw new Error("Unknown diagnostic decision message format");
const deadlineRecovery = process.argv.includes("--deadline-recovery");
const compositionSnapshotReuse = process.argv.includes("--composition-snapshot-reuse");
const compositionCardScope = process.argv.includes("--composition-card-scope");
const compoundUnitPlayGuidance = process.argv.includes("--compound-unit-play");
const mechanismEvidence = process.argv.includes("--mechanism-evidence");
const answerContract = process.argv.includes("--answer-contract");
const tacticalPresentationScope = process.argv.includes("--tactical-presentation-scope");
const compactAnswerContract = process.argv.includes("--compact-answer-contract");
const cardsOnlyAnswerContract = process.argv.includes("--cards-only-answer-contract");
const exactCardQueryContract = process.argv.includes("--exact-card-query-contract");
const unitPlayItemBatch = process.argv.includes("--unit-play-item-batch");
const unitPlayCompletionStop = process.argv.includes("--unit-play-completion-stop");
const unitPlayCompletionAffordance = process.argv.includes("--unit-play-completion-affordance");
const conciseAnswerContract = process.argv.includes("--concise-answer-contract");
const unitMechanismAnswerContract = process.argv.includes("--unit-mechanism-answer-contract");
const modelObservationProjection = process.argv.includes("--model-observation-projection");
const maxRequestsArg = arg("max-requests", "");
const maxRequests = maxRequestsArg === "" ? null : Number(maxRequestsArg);
if (maxRequests !== null && (!Number.isInteger(maxRequests) || maxRequests < 1)) throw new Error("--max-requests must be a positive integer");
if (answerContract && !mechanismEvidence) throw new Error("--answer-contract requires --mechanism-evidence");
if (tacticalPresentationScope && !answerContract) throw new Error("--tactical-presentation-scope requires --answer-contract");
if (compactAnswerContract && !answerContract) throw new Error("--compact-answer-contract requires --answer-contract");
if (cardsOnlyAnswerContract && !compactAnswerContract) throw new Error("--cards-only-answer-contract requires --compact-answer-contract");
if (exactCardQueryContract && !cardsOnlyAnswerContract) throw new Error("--exact-card-query-contract requires --cards-only-answer-contract");
if (unitPlayItemBatch && !exactCardQueryContract) throw new Error("--unit-play-item-batch requires --exact-card-query-contract");
if (unitPlayCompletionStop && !unitPlayItemBatch) throw new Error("--unit-play-completion-stop requires --unit-play-item-batch");
if (unitPlayCompletionAffordance && !unitPlayCompletionStop) throw new Error("--unit-play-completion-affordance requires --unit-play-completion-stop");
if (conciseAnswerContract && !unitPlayCompletionAffordance) throw new Error("--concise-answer-contract requires --unit-play-completion-affordance");
if (unitMechanismAnswerContract && !conciseAnswerContract) throw new Error("--unit-mechanism-answer-contract requires --concise-answer-contract");
if (modelObservationProjection && !answerContract) throw new Error("--model-observation-projection requires --answer-contract");
const skill = unitMechanismAnswerContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_11
  : conciseAnswerContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_10
  : unitPlayCompletionAffordance ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_9
  : unitPlayCompletionStop ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_8
  : unitPlayItemBatch ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_7
  : exactCardQueryContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_6
  : cardsOnlyAnswerContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_5
  : compactAnswerContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_4
  : answerContract ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_3
  : mechanismEvidence ? UNIT_PLAY_GUIDANCE_SKILL_V1_5_2 : UNIT_PLAY_GUIDANCE_SKILL_V1_4;
const output = resolve(arg("output", `.cache/eval/skill-browser-candidate-${Date.now()}`));
mkdirSync(output, { recursive: true });
const env = { ...process.env };
loadLocalEnvironment({ processEnv: env });
env.TFT_AGENT_PERSISTENT_STORE = "memory";
env.TFT_AGENT_EPHEMERAL_STORE = "memory";
const log = (kind, event) => appendFileSync(resolve(output, "observations.jsonl"), JSON.stringify({ at: new Date().toISOString(), kind, ...event }) + "\n");
const modelLog = (event) => log("model", { status: event.status, model: event.model, durationMs: event.durationMs,
  actionType: event.action?.type, tool: event.action?.tool, arguments: event.action?.arguments,
  retryReason: event.status === "retry" ? event.error : undefined, usage: event.usage });
const runtime = await createSmallWindowRuntimeAsync({
  cacheStore: new MemoryCacheStore(), conversationBridgePath: resolve(output, "bridge.sqlite"),
  reactChatMode: "on", agentSkillsShadowV1: true, skillDefinitions: [skill],
  onAgentSkillShadow: (event) => log("skill", event), reactDecisionRequestLog: modelLog,
  onReactTaskFrameShadow: (event) => log("task_frame", event)
}, env);
if (runtime.reactDecisionProvider?.providerKind !== "react_decision_llm") throw new Error("Configure a real decision provider first");
if (!runtime.reactTaskFrameControlV1) throw new Error("This diagnostic requires the existing TaskFrame Control path; no production flag is changed here");
const candidate = createUnitPlayBrowserCandidate({ toolRegistry: runtime.toolRegistry, parseTask: runtime.parseSemanticTask,
  baselineProvider: runtime.reactDecisionProvider, skill, decisionMessages, onEvent: (event) => log("candidate", event),
  modelObservationProjection,
  providerOptions: { ...runtime.structuredParserConfig,
    timeoutMs: Number(env.TFT_AGENT_REACT_DECISION_TIMEOUT_MS ?? 25000),
    thinkingMode: "disabled", maxTokens: 1800, messageLayout, tacticalPresentationScope, onRequestLog: modelLog }
});
runtime.parseSemanticTask = candidate.parseTask;
runtime.reactDecisionProvider = candidate.decisionProvider;
runtime.reactDeadlineRecovery = deadlineRecovery;
runtime.reactCompositionSnapshotReuse = compositionSnapshotReuse;
runtime.reactCompositionCardScope = compositionCardScope;
runtime.reactCompositionCardsOwnPositioning = cardsOnlyAnswerContract;
runtime.reactCompoundUnitPlayGuidance = compoundUnitPlayGuidance;
runtime.reactOfficialItemEvidenceV1 = mechanismEvidence;
runtime.reactUnitPlayItemMechanismBatch = unitPlayItemBatch;
runtime.reactUnitPlayFixedCardCompletionAffordance = unitPlayCompletionAffordance;
runtime.reactUnitPlayFixedCardCount = 2;
runtime.reactUnitPlayInputLanguageGuard = unitMechanismAnswerContract;
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ mode: "isolated_browser_diagnostic", skillId: skill.id,
  skillVersion: skill.version, contentHash: candidate.contentHash, skill,
  model: runtime.reactDecisionProvider.model, taskFrameControl: runtime.reactTaskFrameControlV1,
  budget: runtime.reactChatBudget, messageLayout, decisionMessages, deadlineRecovery, compositionSnapshotReuse, compositionCardScope, compoundUnitPlayGuidance, mechanismEvidence, answerContract, tacticalPresentationScope,
  compactAnswerContract, cardsOnlyAnswerContract, exactCardQueryContract, unitPlayItemBatch, unitPlayCompletionStop,
  unitPlayCompletionAffordance, conciseAnswerContract, unitMechanismAnswerContract, modelObservationProjection,
  maxRequests,
  providerPromptVersion: tacticalPresentationScope ? REACT_SCOPED_TACTICAL_PROMPT_VERSION : REACT_DECISION_PROMPT_VERSION,
  productionSkillControl: false, frozenPairedEvaluation: false }, null, 2));
const { server, url } = await startSmallWindowServer({ runtime, env, host: "127.0.0.1", port: Number(arg("port", "17433")), prewarmCatalog: false });
const handlers = server.listeners("request");
server.removeAllListeners("request");
let serial = 0;
let completedRequests = 0;
server.on("request", (req, res) => candidate.runRequest(() => {
  if (["/api/react-chat/stream", "/api/recommend/stream"].includes(req.url?.split("?")[0])) {
    const id = ++serial, parts = [];
    const originalWrite = res.write, originalEnd = res.end;
    res.write = function(chunk, ...args) { if (chunk) parts.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)); return originalWrite.call(this, chunk, ...args); };
    res.end = function(chunk, ...args) { if (chunk && typeof chunk !== "function") parts.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)); return originalEnd.call(this, chunk, ...args); };
    res.on("finish", () => {
      writeFileSync(resolve(output, `response-${id}.ndjson`), parts.join(""));
      log("response", { id, status: res.statusCode });
      completedRequests += 1;
      if (maxRequests !== null && completedRequests >= maxRequests) {
        server.closeIdleConnections?.();
        server.close();
      }
    });
  }
  for (const handler of handlers) handler.call(server, req, res);
}));
console.log(JSON.stringify({ url, mode: "isolated_browser_diagnostic", skillVersion: skill.version, contentHash: candidate.contentHash, output }));
