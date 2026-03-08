import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError, type ZodTypeAny } from 'zod';
import { HttpError } from '../errors/HttpError';

/**
 * Fastify error-handler + Zod validatorCompiler plugin.
 *
 * - validatorCompiler: routes declare `schema: { body: ZodSchema }` and
 *   Fastify validates automatically before the handler runs.
 * - errorHandler: catches `HttpError`, `ZodError`, and unknown errors
 *   globally so individual handlers don't need try/catch boilerplate.
 *
 * Response envelope follows the existing `ApiError` shape:
 *   { error: string, message: string, details?: unknown }
 */
export async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  // ── Zod ValidatorCompiler ──
  // Allows routes to attach Zod schemas via `schema: { body: MyZodSchema }`
  fastify.setValidatorCompiler(({ schema }) => {
    const zodSchema = schema as ZodTypeAny;
    return (data: unknown) => {
      const result = zodSchema.safeParse(data);
      if (result.success) return { value: result.data };
      return { error: result.error };
    };
  });
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

    // ── Fastify validation error (from validatorCompiler) ──
    if ('validation' in error && (error as FastifyError).statusCode === 400) {
      // The original ZodError is inside error.cause or we can extract from validation
      const zodErr = error.cause instanceof ZodError ? error.cause : null;
      return reply.status(400).send({
        error: 'Validation failed',
        message: 'Request validation failed',
        details: zodErr ? zodErr.errors : (error as FastifyError).validation,
      });
    }

    // ── ZodError (manual throws / validation failures) ──
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        message: 'Request validation failed',
        details: error.errors,
      });
    }

    // ── Legacy ad-hoc thrown objects with statusCode ──
    // NOTE: All 175 throw { statusCode } patterns have been migrated to
    // HttpError (caught above). This block is kept as a safety net during
    // the transition period but should never fire.
    const errObj = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof errObj.statusCode === 'number'
    ) {
      const statusCode = errObj.statusCode;
      const code = typeof errObj.code === 'string' ? errObj.code : undefined;
      const message = typeof errObj.message === 'string' ? errObj.message : 'Request failed';

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
