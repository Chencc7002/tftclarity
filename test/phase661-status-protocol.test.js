import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgentStatus,
  statusAfterExecution,
  statusAfterPlanning,
  validateAgentStatus
} from "../src/agent/status-protocol.js";

test("agent status protocol rejects unknown enums and cross-stage invariant violations", () => {
  assert.throws(() => createAgentStatus({
    understandingStatus: "understood",
    capabilityStatus: "maybe"
  }), /capabilityStatus/);
  assert.throws(() => createAgentStatus({
    understandingStatus: "missing_context",
    capabilityStatus: "supported"
  }), /supported capability requires understood input/);
  assert.throws(() => createAgentStatus({
    understandingStatus: "understood",
    capabilityStatus: "unsupported",
    planningStatus: "planned"
  }), /planned status requires supported capability/);
  assert.throws(() => createAgentStatus({
    understandingStatus: "understood",
    capabilityStatus: "supported",
    planningStatus: "planned",
    executionStatus: "failed",
    evidenceStatus: "sufficient"
  }), /sufficient evidence requires completed execution/);
});

test("understanding and capability remain independent for unsupported requests", () => {
  const status = statusAfterPlanning({
    domain: "tft",
    understandingStatus: "understood_and_supported"
  }, {
    status: "understood_but_unsupported"
  }, {
    plan: null,
    validation: { valid: false }
  });
  assert.deepEqual(status, {
    schemaVersion: "agent-status.v1",
    understandingStatus: "understood",
    capabilityStatus: "unsupported",
    planningStatus: "not_planned",
    executionStatus: "pending",
    evidenceStatus: "pending",
    finalOutcome: "degraded"
  });
  assert.equal(validateAgentStatus(status).valid, true);
});

test("answered outcome requires completed execution with sufficient evidence", () => {
  const planned = createAgentStatus({
    understandingStatus: "understood",
    capabilityStatus: "supported",
    planningStatus: "planned"
  });
  const answered = statusAfterExecution(planned, {
    status: "completed",
    evidenceValidation: { sufficient: true }
  });
  assert.equal(answered.finalOutcome, "answered");
  assert.throws(() => createAgentStatus({
    ...answered,
    evidenceStatus: "insufficient"
  }), /answered outcome requires/);
});
