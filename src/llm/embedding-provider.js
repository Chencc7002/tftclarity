export class EmbeddingProviderUnavailableError extends Error {
  constructor(message = "Embedding provider is unavailable", options = {}) {
    super(message);
    this.name = "EmbeddingProviderUnavailableError";
    this.code = "embedding_provider_unavailable";
    this.recoverable = true;
    this.cause = options.cause;
  }
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
    if (!Array.isArray(value) || value.length !== input.length || value.some((vector) => !Array.isArray(vector))) {
      throw new TypeError("Embedding provider returned an invalid vector batch");
    }
    return value;
  }
}

export function createEmbeddingProvider(embed, options = {}) {
  return new FunctionEmbeddingProvider(embed, options);
}
