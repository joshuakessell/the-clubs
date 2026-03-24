import type { FastifyInstance } from 'fastify';
import {
  type ResolveKeyInput,
  type CreateCheckoutRequestInput,
} from '../../checkout/schemas';
import { HttpError } from '../../errors/HttpError';
import {
  resolveCheckoutKeyLogic,
  createCheckoutRequestLogic,
} from '../../services/checkoutService';

export function registerCheckoutKioskRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkout/resolve-key - Resolve a key tag to checkout information
   */
  fastify.post<{ Body: ResolveKeyInput }>('/v1/checkout/resolve-key', {}, async (request, reply) => {
    try {
      const result = await resolveCheckoutKeyLogic(request.body.token);
      return reply.send(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      fastify.log.error({ error: errorMessage, stack: errorStack }, 'Failed to resolve checkout key');
      return reply.status(500).send({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'test' ? errorMessage : undefined,
      });
    }
  });

  /**
   * POST /v1/checkout/request - Create a checkout request
   */
  fastify.post<{ Body: CreateCheckoutRequestInput }>(
    '/v1/checkout/request',
    {},
    async (request, reply) => {
      try {
        const requestId = await createCheckoutRequestLogic(request.body, fastify.broadcaster);
        return reply.status(201).send({ requestId });
      } catch (error) {
        if (error instanceof HttpError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
