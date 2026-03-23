import type { FastifyPluginAsync } from 'fastify';

export const telemetryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/crash',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            stack: { type: 'string', nullable: true },
            componentStack: { type: 'string', nullable: true },
            url: { type: 'string', nullable: true },
            userAgent: { type: 'string', nullable: true }
          },
          required: ['message']
        }
      },
    },
    async (request, reply) => {
      const { message, stack, componentStack, url, userAgent } = request.body as {
        message: string;
        stack?: string;
        componentStack?: string;
        url?: string;
        userAgent?: string;
      };

      // Ensure the Pino logger natively receives the React front-end crash details 
      // as a native `Error` payload so the CloudWatch transport streams it properly
      const err = new Error(message);
      if (stack) err.stack = stack;
      
      fastify.log.error({
        err,
        componentStack,
        url,
        userAgent,
        type: 'REACT_RENDERER_CRASH',
      }, 'Frontend React Application Crash interceped via Telemetry API');

      return reply.status(202).send({ status: 'logged' });
    }
  );
};
