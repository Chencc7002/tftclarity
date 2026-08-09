import { createHash, randomUUID } from "node:crypto";
import { validateToolEvidence } from "../agent/tool-evidence-validator.js";

export const EVIDENCE_LEDGER_SCHEMA_VERSION = "evidence-ledger.v1";

function contentFingerprint(toolResult) {
  return createHash("sha256")
    .update(JSON.stringify({
      toolName: toolResult.toolName,
      value: toolResult.value,
      metadata: toolResult.metadata
    }))
    .digest("hex");
}

function containsFacts(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object") return true;
  if (
    value.itemContentionPlan
    && typeof value.itemContentionPlan === "object"
    && ["available", "no_contention", "insufficient_build_data"].includes(
      value.itemContentionPlan.status
    )
  ) return true;
  if (Array.isArray(value.results)) return value.results.length > 0;
  if (Array.isArray(value.items)) return value.items.length > 0;
  if (Array.isArray(value.hits)) return value.hits.length > 0;
  return Object.keys(value).length > 0;
}

export class EvidenceLedger {
  constructor(options = {}) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.validate = options.validate ?? validateToolEvidence;
    this.entries = [];
    this.byId = new Map();
    this.fingerprints = new Set();
  }

  add(input = {}) {
    const validation = this.validate(input);
    if (!validation.valid || !containsFacts(input.toolResult?.value)) {
      return {
        added: false,
        validation,
        reason: validation.valid ? "empty_evidence" : "invalid_evidence",
        entry: null
      };
    }
    const fingerprint = contentFingerprint(input.toolResult);
    if (this.fingerprints.has(fingerprint)) {
      return { added: false, validation, reason: "duplicate_evidence", entry: null };
    }
    const entry = Object.freeze({
      evidenceId: String(this.createId()),
      toolCallId: String(input.toolResult.toolCallId),
      toolName: String(input.toolResult.toolName),
      type: String(input.toolResult.metadata?.evidenceType ?? "unspecified"),
      source: String(input.toolResult.metadata?.source ?? "unknown"),
      updatedAt: input.toolResult.metadata?.updatedAt ?? null,
      value: structuredClone(input.toolResult.value),
      metadata: structuredClone(input.toolResult.metadata ?? {}),
      fingerprint,
      validatedAt: new Date(this.now()).toISOString()
    });
    this.entries.push(entry);
    this.byId.set(entry.evidenceId, entry);
    this.fingerprints.add(fingerprint);
    return { added: true, validation, reason: null, entry };
  }

  addHistorical(input = {}) {
    if (
      !input.evidenceId
      || !input.toolCallId
      || !input.toolName
      || !input.type
      || !input.source
      || input.temporalStatus !== "historical"
      || !containsFacts(input.value)
    ) {
      return { added: false, reason: "invalid_historical_evidence", entry: null };
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      source: input.source,
      toolName: input.toolName,
      value: input.value,
      metadata: input.metadata
    })).digest("hex");
    if (this.fingerprints.has(fingerprint) || this.byId.has(String(input.evidenceId))) {
      return { added: false, reason: "duplicate_evidence", entry: null };
    }
    const entry = Object.freeze({
      evidenceId: String(input.evidenceId),
      toolCallId: String(input.toolCallId),
      toolName: String(input.toolName),
      type: String(input.type),
      source: String(input.source),
      updatedAt: input.updatedAt ?? null,
      temporalStatus: "historical",
      value: structuredClone(input.value),
      metadata: structuredClone(input.metadata ?? {}),
      fingerprint,
      validatedAt: new Date(this.now()).toISOString()
    });
    this.entries.push(entry);
    this.byId.set(entry.evidenceId, entry);
    this.fingerprints.add(fingerprint);
    return { added: true, reason: null, entry };
  }

  get(evidenceId) {
    return this.byId.get(String(evidenceId)) ?? null;
  }

  has(evidenceId) {
    return this.byId.has(String(evidenceId));
  }

  resolve(evidenceIds = []) {
    return evidenceIds.map((id) => this.get(id)).filter(Boolean);
  }

  snapshot() {
    return {
      schemaVersion: EVIDENCE_LEDGER_SCHEMA_VERSION,
      entries: this.entries.map((entry) => structuredClone(entry))
    };
  }
}
