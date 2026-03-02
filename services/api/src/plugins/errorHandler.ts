import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { HttpError } from '../errors/HttpError';

/**
 * Fastify error-handler plugin.
 *
 * Catches `HttpError`, `ZodError`, and unknown errors globally so that
 * individual route handlers don't need per-handler try/catch boilerplate.
 *
 * Response envelope follows the existing `ApiError` shape from `src/errors/index.ts`:
 *   { error: string, message: string, details?: unknown }
 */
export async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // ── HttpError (domain / service layer throws) ──
    if (error instanceof HttpError) {
      request.log.warn(
        { err: error, statusCode: error.statusCode, code: error.code },
        error.message
      );
      return reply.status(error.statusCode).send({
        error: error.code ?? error.message,
        message: error.message,
      });
    }

    // ── ZodError (validation failures) ──
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        message: 'Request validation failed',
        details: error.errors,
      });
    }

    // ── Ad-hoc thrown objects with statusCode (legacy pattern) ──
    // Many existing handlers throw `{ statusCode, message, code? }`.
    // Catch them here during the migration period so we don't break anything.
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as any).statusCode === 'number'
    ) {
      const statusCode = (error as any).statusCode as number;
      const code = (error as any).code as string | undefined;
      const message = (error as any).message as string || 'Request failed';

      if (statusCode >= 500) {
        request.log.error(error, message);
      } else {
        request.log.warn({ statusCode, code }, message);
      }

      return reply.status(statusCode).send({
        error: code ?? message,
        message,
      });
    }

    // ── Unknown / unexpected errors ──
    request.log.error(error, 'Unhandled error');
    return reply.status(500).send({
      error: 'Internal server error',
      message: 'An unexpected error occurred',
    });
  });
}
