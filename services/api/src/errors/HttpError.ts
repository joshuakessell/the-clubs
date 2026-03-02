export class HttpError extends Error {
  statusCode: number;

  /**
   * Machine-readable error code for clients (e.g., 'BANNED', 'DEVICE_DISABLED').
   * Optional — when omitted, the error handler uses the message.
   */
  code?: string;

  /**
   * Public-facing error message.
   * Keep this safe to return to clients.
   */
  override message: string;

  constructor(statusCode: number, publicMessage: string, opts?: { cause?: unknown; code?: string }) {
    super(publicMessage);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.message = publicMessage;
    this.code = opts?.code;
    if (opts?.cause !== undefined) {
      // Node 16+ supports Error.cause; keep it on the instance for structured logs.
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}
