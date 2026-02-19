export class HttpError extends Error {
  statusCode: number;

  /**
   * Public-facing error message.
   * Keep this safe to return to clients.
   */
  override message: string;

  constructor(statusCode: number, publicMessage: string, opts?: { cause?: unknown }) {
    super(publicMessage);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.message = publicMessage;
    if (opts?.cause !== undefined) {
      // Node 16+ supports Error.cause; keep it on the instance for structured logs.
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}
