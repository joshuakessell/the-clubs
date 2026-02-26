"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Errors = void 0;
exports.sendError = sendError;
/**
 * Send a standardized error response.
 *
 * Usage:
 *   return sendError(reply, 400, 'Validation failed', 'Name is required');
 *   return sendError(reply, 400, 'Validation failed', 'Invalid input', zodError.errors);
 */
function sendError(reply, statusCode, error, message, details) {
    const body = { error, message };
    if (details !== undefined) {
        body.details = details;
    }
    return reply.status(statusCode).send(body);
}
/**
 * Common error helpers following the standardized envelope.
 */
exports.Errors = {
    unauthorized: (reply, message = 'Authentication required') => sendError(reply, 401, 'Unauthorized', message),
    forbidden: (reply, message = 'Insufficient permissions') => sendError(reply, 403, 'Forbidden', message),
    notFound: (reply, entity = 'Resource') => sendError(reply, 404, 'Not found', `${entity} not found`),
    badRequest: (reply, message, details) => sendError(reply, 400, 'Bad request', message, details),
    conflict: (reply, message) => sendError(reply, 409, 'Conflict', message),
    internal: (reply, message = 'Internal server error') => sendError(reply, 500, 'Internal server error', message),
};
