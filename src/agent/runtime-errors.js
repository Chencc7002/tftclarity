export class RuntimeError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RuntimeError";
    this.code = options.code ?? "runtime_error";
    this.recoverable = Boolean(options.recoverable);
    this.details = options.details ?? null;
    this.publicRun = options.publicRun ?? null;
    this.run = options.run ?? null;
  }
}

export function runtimeError(code, message, options = {}) {
  return new RuntimeError(message, { ...options, code });
}
