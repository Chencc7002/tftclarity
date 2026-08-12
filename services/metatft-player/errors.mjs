class PlayerMatchError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "PlayerMatchError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

function toPublicError(error) {
  if (error instanceof PlayerMatchError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details
      }
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "Player match provider failed unexpectedly.",
      retryable: false,
      details: null
    }
  };
}

export { PlayerMatchError, toPublicError };
