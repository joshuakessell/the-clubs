"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleRoutes = scheduleRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../auth/middleware");
const IsoDateTimeSchema = zod_1.z.string().datetime();
/**
 * Adapter for dynamic SQL — schedule.ts builds optional WHERE clauses
 * with positional params.
 */
function toQueryable() {
    return {
        async query(queryText, params) {
            const parts = queryText.split(/\$\d+/);
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            for (let i = 0; i < parts.length; i++) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
                if (i < values.length) {
                    built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
                }
            }
            const result = await db_1.db.execute(built);
            return { rows: result.rows };
        },
    };
}
async function scheduleRoutes(fastify) {
    fastify.get('/v1/schedule/shifts', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        const from = request.query.from ? IsoDateTimeSchema.parse(request.query.from) : undefined;
        const to = request.query.to ? IsoDateTimeSchema.parse(request.query.to) : undefined;
        const params = [];
        let i = 0;
        let queryText = `
      SELECT
        es.id,
        es.employee_id,
        es.starts_at,
        es.ends_at,
        es.shift_code,
        es.status,
        es.notes,
        s.name as employee_name
      FROM employee_shifts es
      JOIN staff s ON s.id = es.employee_id
      WHERE es.status <> 'CANCELED'
    `;
        if (from) {
            i++;
            queryText += ` AND es.starts_at >= $${i}`;
            params.push(from);
        }
        if (to) {
            i++;
            queryText += ` AND es.ends_at <= $${i}`;
            params.push(to);
        }
        queryText += ` ORDER BY es.starts_at ASC`;
        const qClient = toQueryable();
        const shifts = await qClient.query(queryText, params);
        return reply.send(shifts.rows.map((shift) => ({
            id: shift.id,
            employeeId: shift.employee_id,
            employeeName: shift.employee_name,
            shiftCode: shift.shift_code,
            scheduledStart: shift.starts_at.toISOString(),
            scheduledEnd: shift.ends_at.toISOString(),
            status: shift.status,
            notes: shift.notes,
        })));
    });
}
