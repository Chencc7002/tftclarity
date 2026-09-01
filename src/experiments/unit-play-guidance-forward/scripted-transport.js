function parsedMessages(options) {
  return JSON.parse(options.body).messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).filter(Boolean);
}

function toolObservations(messages) {
  return messages.flatMap((entry) => entry?.schemaVersion === "react-transcript-event.v1"
    && entry.type === "observation" && entry.value?.type === "tool_result" ? [entry.value] : []);
}

const observedValue = (entry) => entry.value ?? entry.evidence?.value;
const call = (tool, args, purposeCode = "retrieve_current_statistics") => ({
  schemaVersion: "react-action.v1", type: "call_tool", tool, arguments: args, purposeCode
});

function response(action) {
  const body = { choices: [{ message: { content: JSON.stringify(action) }, finish_reason: "stop" }],
    model: "deepseek-v4-flash-scripted-test", system_fingerprint: "forward-scripted-v2",
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  const make = () => ({ ok: true, status: 200, async json() { return structuredClone(body); }, clone: make });
  return make();
}

export function createForwardScriptedTransport() {
  let requests = 0, active = 0, maxActive = 0;
  return {
    async fetchImpl(_url, options) {
      requests += 1;
      maxActive = Math.max(maxActive, ++active);
      try {
        const messages = parsedMessages(options);
        const context = messages.find((entry) => entry?.schemaVersion === "react-run-context.v1")
          ?? messages.find((entry) => entry?.state && entry?.toolCatalog)?.state;
        const unit = context?.semanticAdvisory?.subject?.resolvedId;
        if (!unit) throw new Error("scripted transport requires the frozen TaskFrame subject");
        const seen = toolObservations(messages);
        const ofTool = (name) => seen.filter((entry) => entry.tool === name);
        let action;
        if (!ofTool("unit_details").length) action = call("unit_details", { apiName: unit }, "retrieve_entity_details");
        else if (!ofTool("unit_builds").length) action = call("unit_builds", { unit });
        else if (!ofTool("item_details_batch").length) {
          const plan = observedValue(ofTool("unit_builds")[0]).mechanismQueryPlan;
          action = call("item_details_batch", { apiNames: plan.apiNames, seasonContextId: plan.seasonContextId },
            "retrieve_entity_details");
        } else if (!ofTool("comps_rankings").length) action = call("comps_rankings", { unit });
        else if (!ofTool("composition_tactical_details").length) {
          const comps = ofTool("comps_rankings");
          if (comps.length === 1) {
            action = call("comps_rankings", { mention: observedValue(comps[0]).results[0].compositionRef.compId });
          } else {
            const plan = observedValue(comps.at(-1)).results[0].tacticalDetailQueryPlan;
            action = call("composition_tactical_details", { compositionId: plan.compositionId,
              clusterId: plan.clusterId, units: plan.units, seasonContextId: plan.seasonContextId });
          }
        } else if (ofTool("composition_tactical_details").length === 1) {
          const comps = ofTool("comps_rankings");
          if (comps.length === 2) {
            action = call("comps_rankings", { mention: observedValue(comps[0]).results[1].compositionRef.compId });
          } else {
            const plan = observedValue(comps.at(-1)).results[0].tacticalDetailQueryPlan;
            action = call("composition_tactical_details", { compositionId: plan.compositionId,
              clusterId: plan.clusterId, units: plan.units, seasonContextId: plan.seasonContextId });
          }
        } else {
          action = { schemaVersion: "react-action.v1", type: "finish",
            answer: "英雄按工具资料理解并使用推荐装备；拿到推荐装备或本体来牌顺时考虑选择。阵容方案见卡片。",
            evidenceIds: seen.map((entry) => entry.evidence?.evidenceId).filter(Boolean),
            reasonCode: "sufficient_evidence", narrative: null };
        }
        return response(action);
      } finally { active -= 1; }
    },
    snapshot: () => ({ requests, maxActive })
  };
}
