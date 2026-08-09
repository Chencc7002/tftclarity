function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

export function canonicalToolCallFingerprint(tool, argumentsValue = {}) {
  return `${String(tool)}:${JSON.stringify(canonicalValue(argumentsValue))}`;
}

export class DuplicateCallGuard {
  constructor() {
    this.fingerprints = new Set();
    this.semanticSearchCalls = [];
  }

  get size() {
    return this.fingerprints.size;
  }

  check(tool, argumentsValue = {}) {
    const fingerprint = canonicalToolCallFingerprint(tool, argumentsValue);
    return {
      duplicate: this.fingerprints.has(fingerprint),
      fingerprint
    };
  }

  checkPolicy(tool, argumentsValue = {}) {
    if (String(tool) !== "semantic_search") return { allowed: true, code: null };
    if (this.semanticSearchCalls.length >= 2) {
      return { allowed: false, code: "semantic_search_call_limit" };
    }
    const first = this.semanticSearchCalls[0];
    if (!first) return { allowed: true, code: null };
    const patch = argumentsValue?.patch ?? null;
    const documentTypes = JSON.stringify(
      [...(argumentsValue?.documentTypes ?? [])].map(String).sort()
    );
    if (patch === first.patch && documentTypes === first.documentTypes) {
      return { allowed: false, code: "semantic_search_scope_unchanged" };
    }
    return { allowed: true, code: null };
  }

  record(tool, argumentsValue = {}) {
    const check = this.check(tool, argumentsValue);
    this.fingerprints.add(check.fingerprint);
    if (String(tool) === "semantic_search") {
      this.semanticSearchCalls.push({
        patch: argumentsValue?.patch ?? null,
        documentTypes: JSON.stringify(
          [...(argumentsValue?.documentTypes ?? [])].map(String).sort()
        )
      });
    }
    return check;
  }
}
