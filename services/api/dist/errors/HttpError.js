"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
class HttpError extends Error {
    statusCode;
    /**
     * Public-facing error message.
     * Keep this safe to return to clients.
     */
    message;
    constructor(statusCode, publicMessage, opts) {
        super(publicMessage);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.message = publicMessage;
        if (opts?.cause !== undefined) {
            // Node 16+ supports Error.cause; keep it on the instance for structured logs.
            this.cause = opts.cause;
        }
    }
}
exports.HttpError = HttpError;
