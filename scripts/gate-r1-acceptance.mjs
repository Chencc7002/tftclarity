import { resolve } from "node:path";
import { SQLiteConversationBridgeStore } from "../src/index.js";

const baseArg = process.argv.find((value) => value.startsWith("--base-url="));
const bridgeArg = process.argv.find((value) => value.startsWith("--bridge="));
const baseUrl = baseArg?.slice("--base-url=".length) ?? "http://127.0.0.1:17329";
const bridgePath = resolve(
  bridgeArg?.slice("--bridge=".length)
    ?? process.env.TFT_AGENT_CONVERSATION_BRIDGE_PATH
    ?? ".artifacts/acceptance-fixture/conversation-bridge.sqlite"
);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function stream(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify(body)
  });
  check(response.ok, `${path} returned HTTP ${response.status}`);
  const events = (await response.text()).trim().split("\n").filter(Boolean).map(JSON.parse);
  check(events[0]?.type === "diagnostic", `${path} first event is not diagnostic`);
  const complete = events.findLast((event) => event.type === "complete");
  check(complete, `${path} did not complete`);
  return { events, diagnostic: events[0], complete, payload: complete.payload };
}

const runtimeResponse = await fetch(`${baseUrl}/api/runtime`);
const runtime = await runtimeResponse.json();
check(runtimeResponse.ok && runtime.ok, "runtime status unavailable");
check(runtime.runtime.routing.reactChatEnabled === true, "ReAct frontend flag is not enabled");
check(runtime.runtime.routing.conversationBridgeEnabled === true, "Conversation Bridge is not enabled");

const ordinaryConversationId = `gate-ordinary-${Date.now()}`;
const ordinary = await stream("/api/react-chat/stream", {
  requestId: "gate-ordinary-request",
  input: "你好，这是普通聊天，不要执行快捷工具。",
  conversationId: ordinaryConversationId,
  seasonContextId: "set17-live"
});
check(ordinary.diagnostic.endpointMode === "react_chat", "ordinary chat did not use ReAct endpoint");
check(ordinary.payload.ok === true, "ordinary ReAct chat failed");

const m17 = await stream("/api/react-chat/stream", {
  requestId: "gate-m17-request",
  input: "请检索 M17：启动装备为什么影响首次施法等待？",
  conversationId: `gate-m17-${Date.now()}`,
  seasonContextId: "set17-live"
});
check(m17.payload.evidence?.some((entry) => entry.toolName === "semantic_search"), "M17 semantic_search evidence missing");
check(JSON.stringify(m17.payload).includes("M17"), "M17 marker missing from response");

const karma = await stream("/api/react-chat/stream", {
  requestId: "gate-karma-react-request",
  input: "查询卡尔玛当前出装，必须使用捕获的验收数据。",
  conversationId: `gate-karma-react-${Date.now()}`,
  seasonContextId: "set17-live"
});
check(karma.payload.evidence?.some((entry) => entry.toolName === "unit_builds_batch"), "Karma unit_builds_batch evidence missing");
check(JSON.stringify(karma.payload).includes("TFT17_Karma"), "captured Karma fixture was not returned");
const karmaEvidence = karma.payload.evidence.find((entry) => entry.toolName === "unit_builds_batch");
const karmaOptions = karmaEvidence?.value?.results?.[0]?.buildOptions ?? [];
check(karmaOptions.length === 3, "UI-07A requires three deterministic Karma build options");
check(karmaOptions[0]?.role === "stable", "UI-07A first Karma option must be stable");
check(karmaOptions.slice(1).every((option) => option.role === "alternative"), "UI-07A alternatives are not labeled correctly");
check(karma.payload.narrative?.options?.length === 3, "UI-07A grounded narrative is missing per-option explanations");
check(
  karma.payload.narrative.options.every((entry, index) => entry.optionId === karmaOptions[index].optionId),
  "UI-07A narrative option binding does not match deterministic order"
);

const bridgeConversationId = `gate-bridge-${Date.now()}`;
const quickRequestId = `gate-quick-${Date.now()}`;
const quick = await stream("/api/recommend/stream", {
  requestId: quickRequestId,
  input: "查询卡尔玛的当前版本最稳三件装备",
  supplementalText: "谢谢",
  conversationId: bridgeConversationId,
  seasonContextId: "set17-live",
  startNewTask: true,
  quickTask: {
    schemaVersion: "quick-task.v1",
    requestId: quickRequestId,
    id: "unit-build",
    operation: "unit_build_rankings",
    arguments: { champion: "卡尔玛" }
  }
});
check(quick.diagnostic.endpointMode === "recommend", "quick task did not use recommend endpoint");
check(quick.payload.ok === true, "captured Karma quick task failed");
check(quick.payload.quickTask?.supplemental?.relation === "social", "supplementalText was not classified as social");
check(quick.payload.conversationBridge?.status === "saved", "quick task bridge artifacts were not saved");
check(quick.payload.cards?.length === 3, "quick task must preserve all three deterministic build cards");

const followup = await stream("/api/react-chat/stream", {
  requestId: "gate-followup-request",
  input: "刚才这个快捷工具的目的和结果是什么？",
  conversationId: bridgeConversationId,
  seasonContextId: "set17-live"
});
check(followup.payload.conversationBridge?.relation === "return_to_previous", "follow-up did not resolve to quick-task history");
check(followup.payload.conversationBridge?.promotedEvidenceCount === 1, "historical quick-task evidence was not promoted");

const store = await SQLiteConversationBridgeStore.open({ filePath: bridgePath });
try {
  const state = await store.load({
    scopeKey: "local",
    conversationId: bridgeConversationId,
    seasonContextId: "set17-live"
  });
  check(state.records.some((record) => record.requestId === quickRequestId && record.status === "completed"), "completed TurnRecord missing");
  check(state.snapshots.length === 1, "successful quick task must create exactly one snapshot");
  const snapshotResultItems = state.snapshots[0]?.claims?.filter((claim) => claim.claimType === "result_item") ?? [];
  check(snapshotResultItems.length === 3, "quick-task snapshot must preserve all three build result items");
  check(Boolean(state.activeRecordId), "successful quick task did not become active");
  console.log(JSON.stringify({
    ok: true,
    gates: {
      routing: "pass",
      m17: "pass",
      karmaCapturedFixture: "pass",
      ui07DeterministicOptionsAndNarrative: "pass",
      supplementalText: "pass",
      bridgeHistory: "pass"
    },
    diagnostics: {
      ordinary: ordinary.diagnostic,
      quick: quick.diagnostic
    },
    bridge: {
      contextEpoch: state.contextEpoch,
      activeRecordId: state.activeRecordId,
      recordStatuses: state.records.map((record) => record.status),
      snapshotCount: state.snapshots.length,
      snapshotResultItemCount: snapshotResultItems.length
    }
  }, null, 2));
} finally {
  store.close();
}
