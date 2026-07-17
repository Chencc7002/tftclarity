export class EmbeddingProviderUnavailableError extends Error {
  constructor(message = "Embedding provider is unavailable", options = {}) {
    super(message);
    this.name = "EmbeddingProviderUnavailableError";
    this.code = "embedding_provider_unavailable";
    this.recoverable = true;
    this.cause = options.cause;
  }
}

export const DEFAULT_EMBEDDING_TIMEOUT_MS = 8000;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function embeddingEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/\/+$/, "");
  if (!endpoint) return "";
  return /\/embeddings$/i.test(endpoint) ? endpoint : `${endpoint}/embeddings`;
}

function validateVectors(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new TypeError("Embedding provider returned an invalid vector batch size");
  }
  let dimensions = null;
  for (const vector of value) {
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((entry) => !Number.isFinite(Number(entry)))) {
      throw new TypeError("Embedding provider returned a non-numeric vector");
    }
    dimensions ??= vector.length;
    if (vector.length !== dimensions) throw new TypeError("Embedding provider returned vectors with inconsistent dimensions");
  }
  return value.map((vector) => vector.map(Number));
}

export class EmbeddingProvider {
  constructor(options = {}) {
    this.model = options.model ?? null;
    this.available = options.available !== false;
  }

  isAvailable() {
    return this.available;
  }

  async embed() {
    throw new EmbeddingProviderUnavailableError();
  }
}

export class FunctionEmbeddingProvider extends EmbeddingProvider {
  constructor(embed, options = {}) {
    super(options);
    if (typeof embed !== "function") throw new TypeError("FunctionEmbeddingProvider requires an embed function");
    this.embedFunction = embed;
  }

  async embed(texts, options = {}) {
    if (!this.isAvailable()) throw new EmbeddingProviderUnavailableError();
    const input = Array.isArray(texts) ? texts.map(String) : [String(texts ?? "")];
    const value = await this.embedFunction(input, options);
    return validateVectors(value, input.length);
  }
}

export class OpenAICompatibleEmbeddingProvider extends EmbeddingProvider {
  constructor(options = {}) {
    super({
      model: options.model,
      available: options.available !== false
        && Boolean(options.model)
        && Boolean(options.endpoint)
        && (Boolean(options.apiKey) || options.allowUnauthenticated === true)
    });
    this.endpoint = embeddingEndpoint(options.endpoint);
    this.apiKey = options.apiKey ?? "";
    this.allowUnauthenticated = options.allowUnauthenticated === true;
    this.dimensions = positiveInteger(options.dimensions, null);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_EMBEDDING_TIMEOUT_MS);
    this.batchSize = positiveInteger(options.batchSize, DEFAULT_EMBEDDING_BATCH_SIZE);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async embed(texts, options = {}) {
    if (!this.isAvailable() || typeof this.fetchImpl !== "function") {
      throw new EmbeddingProviderUnavailableError("OpenAI-compatible embedding provider is not configured");
    }
    const input = Array.isArray(texts) ? texts.map((value) => String(value ?? "")) : [String(texts ?? "")];
    if (input.length === 0) return [];
    const vectors = [];
    for (let offset = 0; offset < input.length; offset += this.batchSize) {
      const batch = input.slice(offset, offset + this.batchSize);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = { "content-type": "application/json" };
        if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
        const body = {
          model: this.model,
          input: batch,
          encoding_format: "float"
        };
        if (this.dimensions) body.dimensions = this.dimensions;
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!response?.ok) {
          throw new Error(`embedding request failed with HTTP ${response?.status ?? "unknown"}`);
        }
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? [...payload.data] : [];
        rows.sort((left, right) => Number(left?.index ?? 0) - Number(right?.index ?? 0));
        vectors.push(...validateVectors(rows.map((row) => row?.embedding), batch.length));
      } catch (error) {
        if (error instanceof TypeError && /Embedding provider returned/.test(error.message)) throw error;
        throw new EmbeddingProviderUnavailableError("Embedding provider request failed", { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    }
    return validateVectors(vectors, input.length);
  }
}

export function resolveEmbeddingProviderConfig(overrides = {}, env = process.env) {
  const mode = String(overrides.mode ?? env.TFT_AGENT_EMBEDDING_MODE ?? "off").trim().toLowerCase();
  const provider = String(overrides.provider ?? env.TFT_AGENT_EMBEDDING_PROVIDER ?? "openai_compatible").trim().toLowerCase();
  const endpoint = overrides.endpoint ?? env.TFT_AGENT_EMBEDDING_ENDPOINT ?? "";
  const model = overrides.model ?? env.TFT_AGENT_EMBEDDING_MODEL ?? "";
  const apiKey = overrides.apiKey ?? env.TFT_AGENT_EMBEDDING_API_KEY ?? "";
  const enabled = ["on", "enabled", "openai_compatible"].includes(mode);
  const allowUnauthenticated = overrides.allowUnauthenticated === true
    || String(env.TFT_AGENT_EMBEDDING_ALLOW_UNAUTHENTICATED ?? "").toLowerCase() === "true";
  return {
    enabled,
    mode,
    provider,
    endpoint,
    model,
    apiKey,
    dimensions: positiveInteger(overrides.dimensions ?? env.TFT_AGENT_EMBEDDING_DIMENSIONS, null),
    timeoutMs: positiveInteger(overrides.timeoutMs ?? env.TFT_AGENT_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS),
    batchSize: positiveInteger(overrides.batchSize ?? env.TFT_AGENT_EMBEDDING_BATCH_SIZE, DEFAULT_EMBEDDING_BATCH_SIZE),
    allowUnauthenticated,
    configured: enabled && Boolean(endpoint) && Boolean(model) && (Boolean(apiKey) || allowUnauthenticated)
  };
}

export function createEmbeddingProviderFromConfig(config = {}, options = {}) {
  if (!config.enabled || config.provider !== "openai_compatible") {
    return new EmbeddingProvider({ model: config.model, available: false });
  }
  return new OpenAICompatibleEmbeddingProvider({
    ...config,
    fetchImpl: options.fetchImpl ?? config.fetchImpl
  });
}

export function createEmbeddingProvider(embed, options = {}) {
  return new FunctionEmbeddingProvider(embed, options);
}
