"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminStaffRoutes = registerAdminStaffRoutes;
const zod_1 = require("zod");
const db_1 = require("../../db");
const middleware_1 = require("../../auth/middleware");
const auditLog_1 = require("../../audit/auditLog");
function registerAdminStaffRoutes(fastify) {
    /**
     * GET /v1/admin/staff - Get list of staff members
     *
     * Returns all staff members (active and inactive) with last login info.
     */
    fastify.get('/v1/admin/staff', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            let whereClause = '1=1';
            const params = [];
            let paramIndex = 1;
            if (request.query.search) {
                whereClause += ` AND (name ILIKE $${paramIndex} OR id::text = $${paramIndex})`;
                params.push(`%${request.query.search}%`);
                paramIndex++;
            }
            if (request.query.role) {
                whereClause += ` AND role = $${paramIndex}`;
                params.push(request.query.role);
                paramIndex++;
            }
            if (request.query.active !== undefined) {
                whereClause += ` AND active = $${paramIndex}`;
                params.push(request.query.active === 'true');
                paramIndex++;
            }
            const result = await (0, db_1.query)(`SELECT 
          s.id,
          s.name,
          s.role,
          s.active,
          s.created_at,
          MAX(ss.created_at) as last_login
         FROM staff s
         LEFT JOIN staff_sessions ss ON s.id = ss.staff_id
         WHERE ${whereClause}
         GROUP BY s.id, s.name, s.role, s.active, s.created_at
         ORDER BY s.name`);
            return reply.send({
                staff: result.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    role: row.role,
                    active: row.active,
                    createdAt: row.created_at.toISOString(),
                    lastLogin: row.last_login?.toISOString() || null,
                })),
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch staff list');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/staff - Create a new staff member
     */
    fastify.post('/v1/admin/staff', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const CreateStaffSchema = zod_1.z.object({
            name: zod_1.z.string().min(1),
            role: zod_1.z.enum(['STAFF', 'ADMIN']),
            pin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
            active: zod_1.z.boolean().optional().default(true),
        });
        let body;
        try {
            body = CreateStaffSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const { hashPin } = await Promise.resolve().then(() => __importStar(require('../../auth/utils')));
            const pinHash = await hashPin(body.pin);
            const result = await (0, db_1.query)(`INSERT INTO staff (name, role, pin_hash, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`, [body.name, body.role, pinHash, body.active]);
            const staffId = result.rows[0].id;
            // Log audit action
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action: 'STAFF_CREATED',
                entityType: 'staff',
                entityId: staffId,
                newValue: { name: body.name, role: body.role, active: body.active },
            });
            return reply.status(201).send({
                id: staffId,
                name: body.name,
                role: body.role,
                active: body.active,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to create staff');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * PATCH /v1/admin/staff/:id - Update a staff member
     */
    fastify.patch('/v1/admin/staff/:id', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const UpdateStaffSchema = zod_1.z.object({
            name: zod_1.z.string().min(1).optional(),
            role: zod_1.z.enum(['STAFF', 'ADMIN']).optional(),
            active: zod_1.z.boolean().optional(),
        });
        let body;
        try {
            body = UpdateStaffSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const updates = [];
            const params = [];
            let paramIndex = 1;
            if (body.name !== undefined) {
                updates.push(`name = $${paramIndex}`);
                params.push(body.name);
                paramIndex++;
            }
            if (body.role !== undefined) {
                updates.push(`role = $${paramIndex}`);
                params.push(body.role);
                paramIndex++;
            }
            if (body.active !== undefined) {
                updates.push(`active = $${paramIndex}`);
                params.push(body.active);
                paramIndex++;
            }
            if (updates.length === 0) {
                return reply.status(400).send({ error: 'No fields to update' });
            }
            params.push(request.params.id);
            const result = await (0, db_1.query)(`UPDATE staff
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, name, role, active`, params);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found' });
            }
            const staff = result.rows[0];
            // Log audit action
            const action = body.active !== undefined
                ? body.active
                    ? 'STAFF_ACTIVATED'
                    : 'STAFF_DEACTIVATED'
                : 'STAFF_UPDATED';
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action,
                entityType: 'staff',
                entityId: staff.id,
                newValue: body,
            });
            return reply.send(staff);
        }
        catch (error) {
            request.log.error(error, 'Failed to update staff');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/staff/:id/pin-reset - Reset a staff member's PIN
     *
     * Requires re-authentication for security.
     */
    fastify.post('/v1/admin/staff/:id/pin-reset', {
        preHandler: [middleware_1.requireReauthForAdmin],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const PinResetSchema = zod_1.z.object({
            newPin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
        });
        let body;
        try {
            body = PinResetSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const { hashPin } = await Promise.resolve().then(() => __importStar(require('../../auth/utils')));
            const pinHash = await hashPin(body.newPin);
            const result = await (0, db_1.query)(`UPDATE staff
         SET pin_hash = $1, force_pin_change = true, updated_at = NOW()
         WHERE id = $2
         RETURNING id`, [pinHash, request.params.id]);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Staff not found' });
            }
            // Log audit action
            await (0, auditLog_1.insertAuditLogQuery)(db_1.query, {
                staffId: request.staff.staffId,
                action: 'STAFF_PIN_RESET',
                entityType: 'staff',
                entityId: request.params.id,
            });
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to reset PIN');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
