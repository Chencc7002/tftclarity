import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolExecutor,
  ToolRegistry,
  createStructuredToolDefinitions,
  createTftToolHandlers,
  getOfficialPatchFacts,
  matchTaskCapabilities,
  createTaskFrame
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";

test("official patch facts expose the numeric-only 18.1 revision chain", () => {
  const facts = getOfficialPatchFacts({ patch: "18.1", locale: "zh-CN" });

  assert.equal(facts.schemaVersion, "official-patch-facts.v1");
  assert.equal(facts.status, "found");
  assert.equal(facts.numericOnly, true);
  assert.equal(facts.publishedAt, "2026-08-25T18:00:00.000Z");
  assert.equal(facts.updatedAt, "2026-08-31");
  assert.deepEqual(facts.summary, {
    revisionCount: 1,
    changeCount: 15,
    buffs: 7,
    nerfs: 8
  });
  assert.deepEqual(
    facts.revisions.map(({ id, parentId, publishedAt }) => ({ id, parentId, publishedAt })),
    [{ id: "18.1-balance-2026-08-31", parentId: null, publishedAt: "2026-08-31" }]
  );
  const amumu = facts.revisions[0].changes.find((change) => change.id.endsWith("amumu-heal"));
  assert.deepEqual(amumu.entityApiNames, ["DA_Amumu18"]);
  assert.equal(amumu.stat, "max_health_healing");
  assert.equal(amumu.before, "2.2%");
  assert.equal(amumu.after, "2.5%");
  assert.match(facts.source.sourceUrl, /teamfighttactics\.leagueoflegends\.com/u);
});

test("patch_facts is a registered read-only tool with current-patch fallback", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const bundle = createTftToolHandlers({
    registry,
    seasonContext: { currentPatch: "18.1" },
    locale: "zh-CN"
  });
  const definition = registry.get("patch_facts");

  assert.ok(definition);
  assert.equal(definition.source, "riot_patch_notes");
  assert.equal(definition.evidenceType, "official_patch_facts");
  assert.equal(definition.readOnly, true);
  assert.ok(bundle.availableToolNames.includes("patch_facts"));

  const result = await new ToolExecutor({ registry }).execute("patch_facts", {}, {
    handler: bundle.handlers.patch_facts
  });
  assert.equal(result.status, "completed");
  assert.equal(result.value.patch, "18.1");
  assert.equal(result.value.summary.changeCount, 15);
  assert.equal(result.metadata.source, "riot_patch_notes");
  assert.equal(result.metadata.evidenceType, "official_patch_facts");
  assert.equal(result.metadata.updatedAt, "2026-08-31");

  await assert.rejects(
    () => new ToolExecutor({ registry }).execute("patch_facts", { patch: "current" }, {
      handler: bundle.handlers.patch_facts
    }),
    (error) => /Invalid input for patch_facts/u.test(String(error?.cause?.message))
  );
});

test("patch summary TaskFrames deterministically select patch_facts", () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = createTaskFrame({
    domain: "tft",
    action: "summarize",
    concepts: [{
      rawText: "18.1",
      expectedType: "patch",
      resolvedId: "18.1",
      confidence: 1
    }],
    constraints: { patch: "18.1", locale: "zh-CN" },
    goal: "summarize_patch_changes",
    expectedOutput: ["summary", "patch_facts", "evidence"],
    capabilityRequirements: ["official_patch_facts"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const match = matchTaskCapabilities(frame, registry);

  assert.equal(match.status, "understood_and_supported");
  assert.equal(match.mode, "single_tool");
  assert.equal(match.selected[0].tool, "patch_facts");
});

test("ReAct Agent retrieves patch facts before answering a patch question", async () => {
  const runtime = createSmallWindowRuntime({
    reactDecisionProvider: async (request) => {
      const evidence = request.state.evidence.find((entry) => entry.toolName === "patch_facts");
      if (!evidence) {
        assert.ok(request.toolCatalog.some((tool) => tool.name === "patch_facts"));
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "patch_facts",
          arguments: { patch: "18.1", locale: "zh-CN" },
          purposeCode: "retrieve_supporting_knowledge"
        };
      }
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "18.1 热补丁于 2026-08-31 更新，共 15 项数值调整：7 项增强、8 项削弱；例如阿木木最大生命值治疗由 2.2% 提高到 2.5%。",
        evidenceIds: [evidence.evidenceId],
        reasonCode: "sufficient_evidence"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "总结一下 18.1 热补丁的数值变化和时间",
    conversationId: "patch-facts-agent-test"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.terminationReason, "completed");
  assert.match(payload.answer, /2026-08-31/u);
  assert.match(payload.answer, /15 项数值调整/u);
  assert.deepEqual(payload.evidence.map((entry) => entry.toolName), ["patch_facts"]);
  assert.equal(payload.evidence[0].value.revisions[0].changes.length, 15);
});
