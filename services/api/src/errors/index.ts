import type { FastifyReply } from 'fastify';

/**
 * Standardized error response shape (F-11).
 *
 * All API error responses should use this envelope:
 *   { error: "<CODE>", message: "<human readable>", details?: unknown }
 */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Send a standardized error response.
 *
 * Usage:
 *   return sendError(reply, 400, 'Validation failed', 'Name is required');
 *   return sendError(reply, 400, 'Validation failed', 'Invalid input', zodError.errors);
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
  details?: unknown
): FastifyReply {
  const body: ApiError = { error, message };
  if (details !== undefined) {
    body.details = details;
  }
  return reply.status(statusCode).send(body);
}

/**
 * Common error helpers following the standardized envelope.
 */
export const Errors = {
  unauthorized: (reply: FastifyReply, message = 'Authentication required') =>
    sendError(reply, 401, 'Unauthorized', message),

  forbidden: (reply: FastifyReply, message = 'Insufficient permissions') =>
    sendError(reply, 403, 'Forbidden', message),

  notFound: (reply: FastifyReply, entity = 'Resource') =>
    sendError(reply, 404, 'Not found', `${entity} not found`),

  badRequest: (reply: FastifyReply, message: string, details?: unknown) =>
    sendError(reply, 400, 'Bad request', message, details),

  conflict: (reply: FastifyReply, message: string) =>
    sendError(reply, 409, 'Conflict', message),

  internal: (reply: FastifyReply, message = 'Internal server error') =>
    sendError(reply, 500, 'Internal server error', message),
} as const;
