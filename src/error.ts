type HTTPErrorOptions = {
  status: number;
  code?: string;
  message: string;
  cause?: unknown;
  body?: Record<string, unknown>;
  errors?: Array<{ message: string; path: string }>;
};

/**
 * Structured HTTP error with a status code and optional field-level errors.
 *
 * Throw this from any handler or middleware; the application error handler
 * can inspect `status`, `code`, `body`, and `errors` to build the response.
 */
export class HTTPError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly body?: Record<string, unknown>;
  public readonly errors?: Array<{ message: string; path: string }>;

  constructor(options: HTTPErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "HTTPError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.errors = options.errors;
  }

  public toJSON() {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      errors: this.errors,
      ...this.body,
    };
  }

  /** Creates an `HTTPError` from a status code, message, and optional error code. */
  public static status(status: number, message: string, code?: string) {
    return new HTTPError({ status, message, code });
  }
}
