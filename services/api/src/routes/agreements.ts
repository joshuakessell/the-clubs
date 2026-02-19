import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';

interface AgreementRow {
  id: string;
  version: string;
  title: string;
  body_text: string | null;
}

/**
 * Agreement routes.
 */
export async function agreementsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/agreements/active
   *
   * Return the currently active agreement (used by customer kiosk).
   */
  fastify.get('/v1/agreements/active', async (_request, reply) => {
    try {
      const result = await query<AgreementRow>(
        `SELECT id, version, title, body_text
         FROM agreements
         WHERE active = true
         ORDER BY created_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'No active agreement found' });
      }

      const agreement = result.rows[0]!;
      const bodyText =
        agreement.body_text && agreement.body_text.trim().length > 0
          ? agreement.body_text
          : AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;

      return reply.send({
        id: agreement.id,
        version: agreement.version,
        title: agreement.title,
        bodyText,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to load active agreement');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load active agreement',
      });
    }
  });
}
