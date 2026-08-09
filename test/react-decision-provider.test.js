import assert from "node:assert/strict";
import test from "node:test";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";

test("react decision provider sends bounded state and returns a validated action", async () => {
  let observedBody;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    apiKey: "secret",
    fetchImpl: async (_url, options) => {
      observedBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  schemaVersion: "react-action.v1",
                  type: "call_tool",
                  tool: "unit_details",
                  arguments: { apiName: "TFT18_Xayah" },
                  purposeCode: "retrieve_entity_details"
                })
              }
            }],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      };
    }
  });
  const response = await provider({
    state: { question: "霞的技能是什么？", evidence: [] },
    toolCatalog: [{ name: "unit_details", inputSchema: { type: "object" } }]
  });
  assert.equal(response.action.type, "call_tool");
  assert.equal(response.action.tool, "unit_details");
  assert.equal(observedBody.model, "test-model");
  assert.equal(observedBody.response_format.type, "json_object");
  assert.match(observedBody.messages[0].content, /call_tool, ask_user, or finish/u);
  assert.match(observedBody.messages[0].content, /entity_catalog_query with entityType and filters\.names/u);
  assert.match(observedBody.messages[0].content, /call comps_rankings with the concise composition mention/u);
  assert.match(observedBody.messages[0].content, /itemized_core_candidate proves only/u);
  assert.match(observedBody.messages[0].content, /composition_replacement_evaluation/u);
  assert.match(observedBody.messages[0].content, /composition_change_evaluation/u);
  assert.match(observedBody.messages[0].content, /add requires incomingApiName only/u);
  assert.match(observedBody.messages[0].content, /Never calculate composition trait counts or breakpoint changes yourself/u);
  assert.match(observedBody.messages[0].content, /not_evaluated/u);
  assert.match(observedBody.messages[0].content, /structured invalid status/u);
  assert.match(observedBody.messages[0].content, /Do not use direct_answer/u);
  assert.match(observedBody.messages[0].content, /itemContentionQueryPlan/u);
  assert.match(observedBody.messages[0].content, /itemContentionPlan\.status=available/u);
  assert.match(observedBody.messages[0].content, /coverageStatus=partial/u);
  assert.match(observedBody.messages[0].content, /whole composition may contain additional unobserved conflicts/u);
  assert.match(observedBody.messages[0].content, /priorityConclusion=not_evaluated/u);
  assert.match(observedBody.messages[0].content, /never repeat the baseline call/u);
  assert.match(observedBody.messages[0].content, /"constraints":\{"excludedItems"/u);
  assert.match(observedBody.messages[0].content, /unit_builds_batch receives its season, patch, and request scope from the server/u);
  assert.match(observedBody.messages[0].content, /nextActionAffordance/u);
  assert.match(observedBody.messages[0].content, /recommendedAction=finish/u);
  assert.match(observedBody.messages[0].content, /mechanismLookup\.required=true/u);
  assert.match(observedBody.messages[0].content, /never guess apiName/iu);
});

test("react decision provider rejects model-invented tools", async () => {
  let calls = 0;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async () => {
      calls += 1;
      return ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                schemaVersion: "react-action.v1",
                type: "call_tool",
                tool: "shell",
                arguments: {},
                purposeCode: "other"
              })
            }
          }]
        };
      }
      });
    }
  });
  await assert.rejects(
    () => provider({ state: {}, toolCatalog: [{ name: "unit_details" }] }),
    /tool is not registered/u
  );
  assert.equal(calls, 2);
});

test("react decision provider retries malformed JSON with a compact repair instruction", async () => {
  const bodies = [];
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      const content = bodies.length === 1
        ? '{"schemaVersion":"react-action.v1","type":"finish"'
        : JSON.stringify({
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "当前证据不足，暂时无法可靠回答。",
          evidenceIds: [],
          reasonCode: "insufficient_evidence",
          narrative: null
        });
      return {
        ok: true,
        async json() { return { choices: [{ message: { content } }] }; }
      };
    }
  });

  const response = await provider({ state: {}, toolCatalog: [] });
  assert.equal(response.action.type, "finish");
  assert.equal(response.telemetry.attempts, 2);
  assert.equal(bodies[0].max_tokens, 1800);
  assert.equal(bodies[1].max_tokens, 700);
  assert.match(bodies[1].messages.at(-1).content, /narrative 设为 null/u);
  const repairedRequest = JSON.parse(bodies[1].messages[1].content);
  assert.match(repairedRequest.repair.instruction, /更精简/u);
});
