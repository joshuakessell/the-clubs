import type { FastifyInstance } from 'fastify';
import { query } from '../../db';
import { requireAdmin, requireAuth } from '../../auth/middleware';

export function registerAdminMetricsRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/metrics/summary - Get cleaning metrics summary
   *
   * Returns average dirty time and cleaning duration for a time range.
   * Excludes overridden/anomalous records.
   */
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
    };
  }>(
    '/v1/admin/metrics/summary',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const from = request.query.from
          ? new Date(request.query.from)
          : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
        const to = request.query.to ? new Date(request.query.to) : new Date();

        // Calculate average time rooms remain dirty (DIRTY -> CLEANING transition)
        // Find when room became DIRTY from audit_log (non-override) or previous cleaning event
        // Exclude anomalies: negative durations, < 30s, > 4h
        const dirtyTimeResult = await query<{
          avg_minutes: string | null;
          count: string;
        }>(
          `WITH dirty_to_cleaning AS (
          SELECT 
            ce.room_id,
            ce.started_at,
            GREATEST(
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM audit_log al 
                 WHERE al.entity_type = 'room' 
                   AND al.entity_id = ce.room_id 
                   AND al.new_value::jsonb->>'status' = 'DIRTY'
                   AND al.created_at < ce.started_at
                   AND al.action != 'OVERRIDE'),
                '1970-01-01'::timestamptz
              ),
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM cleaning_events ce2 
                 WHERE ce2.room_id = ce.room_id 
                   AND ce2.to_status = 'DIRTY'
                   AND ce2.created_at < ce.started_at
                   AND ce2.override_flag = false),
                '1970-01-01'::timestamptz
              )
            ) as became_dirty_at
          FROM cleaning_events ce
          WHERE ce.from_status = 'DIRTY'
            AND ce.to_status = 'CLEANING'
            AND ce.override_flag = false
            AND ce.started_at >= $1
            AND ce.started_at <= $2
        ),
        durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes
          FROM dirty_to_cleaning
          WHERE became_dirty_at > '1970-01-01'::timestamptz
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
          [from, to]
        );

        // Calculate average cleaning duration (CLEANING start -> CLEAN completion)
        // Match started_at from DIRTY->CLEANING with completed_at from CLEANING->CLEAN
        // Exclude anomalies: negative durations, < 30s, > 4h
        const cleaningDurationResult = await query<{
          avg_minutes: string | null;
          count: string;
        }>(
          `WITH durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes
          FROM cleaning_events ce
          WHERE ce.from_status = 'CLEANING'
            AND ce.to_status = 'CLEAN'
            AND ce.override_flag = false
            AND ce.started_at IS NOT NULL
            AND ce.completed_at IS NOT NULL
            AND ce.completed_at >= $1
            AND ce.completed_at <= $2
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
          [from, to]
        );

        // Count total rooms cleaned (CLEANING -> CLEAN transitions, excluding overrides)
        const totalCleanedResult = await query<{ count: string }>(
          `SELECT COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
           AND ce.completed_at >= $1
           AND ce.completed_at <= $2`,
          [from, to]
        );

        const avgDirtyTime = dirtyTimeResult.rows[0]?.avg_minutes
          ? parseFloat(dirtyTimeResult.rows[0].avg_minutes)
          : null;
        const dirtyTimeCount = parseInt(dirtyTimeResult.rows[0]?.count || '0', 10);

        const avgCleaningDuration = cleaningDurationResult.rows[0]?.avg_minutes
          ? parseFloat(cleaningDurationResult.rows[0].avg_minutes)
          : null;
        const cleaningDurationCount = parseInt(cleaningDurationResult.rows[0]?.count || '0', 10);
        const totalRoomsCleaned = parseInt(totalCleanedResult.rows[0]?.count || '0', 10);

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          averageDirtyTimeMinutes: avgDirtyTime,
          dirtyTimeSampleCount: dirtyTimeCount,
          averageCleaningDurationMinutes: avgCleaningDuration,
          cleaningDurationSampleCount: cleaningDurationCount,
          totalRoomsCleaned,
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch metrics summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/metrics/by-staff - Get cleaning metrics by staff member
   *
   * Returns average dirty time and cleaning duration filtered by staff and time range.
   */
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
      staffId?: string;
    };
  }>(
    '/v1/admin/metrics/by-staff',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const from = request.query.from
          ? new Date(request.query.from)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const to = request.query.to ? new Date(request.query.to) : new Date();
        const staffId = request.query.staffId;

        if (!staffId) {
          return reply.status(400).send({ error: 'staffId is required' });
        }

        // Average dirty time for this staff member (with anomaly exclusions)
        const dirtyTimeResult = await query<{
          avg_minutes: string | null;
          count: string;
        }>(
          `WITH dirty_to_cleaning AS (
          SELECT 
            ce.room_id,
            ce.started_at,
            GREATEST(
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM audit_log al 
                 WHERE al.entity_type = 'room' 
                   AND al.entity_id = ce.room_id 
                   AND al.new_value::jsonb->>'status' = 'DIRTY'
                   AND al.created_at < ce.started_at
                   AND al.action != 'OVERRIDE'),
                '1970-01-01'::timestamptz
              ),
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM cleaning_events ce2 
                 WHERE ce2.room_id = ce.room_id 
                   AND ce2.to_status = 'DIRTY'
                   AND ce2.created_at < ce.started_at
                   AND ce2.override_flag = false),
                '1970-01-01'::timestamptz
              )
            ) as became_dirty_at
          FROM cleaning_events ce
          WHERE ce.from_status = 'DIRTY'
            AND ce.to_status = 'CLEANING'
            AND ce.override_flag = false
            AND ce.staff_id = $1
            AND ce.started_at >= $2
            AND ce.started_at <= $3
        ),
        durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes
          FROM dirty_to_cleaning
          WHERE became_dirty_at > '1970-01-01'::timestamptz
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
          [staffId, from, to]
        );

        // Average cleaning duration for this staff member (with anomaly exclusions)
        const cleaningDurationResult = await query<{
          avg_minutes: string | null;
          count: string;
        }>(
          `WITH durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes
          FROM cleaning_events ce
          WHERE ce.from_status = 'CLEANING'
            AND ce.to_status = 'CLEAN'
            AND ce.override_flag = false
            AND ce.staff_id = $1
            AND ce.started_at IS NOT NULL
            AND ce.completed_at IS NOT NULL
            AND ce.completed_at >= $2
            AND ce.completed_at <= $3
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
          [staffId, from, to]
        );

        // Count total rooms cleaned by this staff member
        const totalCleanedResult = await query<{ count: string }>(
          `SELECT COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
           AND ce.staff_id = $1
           AND ce.completed_at >= $2
           AND ce.completed_at <= $3`,
          [staffId, from, to]
        );

        const avgDirtyTime = dirtyTimeResult.rows[0]?.avg_minutes
          ? parseFloat(dirtyTimeResult.rows[0].avg_minutes)
          : null;
        const dirtyTimeCount = parseInt(dirtyTimeResult.rows[0]?.count || '0', 10);

        const avgCleaningDuration = cleaningDurationResult.rows[0]?.avg_minutes
          ? parseFloat(cleaningDurationResult.rows[0].avg_minutes)
          : null;
        const cleaningDurationCount = parseInt(cleaningDurationResult.rows[0]?.count || '0', 10);
        const totalRoomsCleaned = parseInt(totalCleanedResult.rows[0]?.count || '0', 10);

        return reply.send({
          staffId,
          from: from.toISOString(),
          to: to.toISOString(),
          averageDirtyTimeMinutes: avgDirtyTime,
          dirtyTimeSampleCount: dirtyTimeCount,
          averageCleaningDurationMinutes: avgCleaningDuration,
          cleaningDurationSampleCount: cleaningDurationCount,
          totalRoomsCleaned,
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch metrics by staff');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
