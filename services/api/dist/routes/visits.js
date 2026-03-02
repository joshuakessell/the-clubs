"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitRoutes = visitRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const broadcast_1 = require("../inventory/broadcast");
const active_1 = require("./visits/active");
const visitService_1 = require("../services/visitService");
/**
 * Schema for creating an initial visit.
 */
const CreateVisitSchema = zod_1.z
    .object({
    customerId: zod_1.z.string().uuid(),
    rentalType: zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    roomId: zod_1.z.string().uuid().optional(),
    lockerId: zod_1.z.string().uuid().optional(),
})
    .superRefine((v, ctx) => {
    const hasRoom = Boolean(v.roomId);
    const hasLocker = Boolean(v.lockerId);
    if (hasRoom && hasLocker) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Provide either roomId or lockerId, not both',
            path: ['roomId'],
        });
        return;
    }
    const isLockerRental = v.rentalType === 'LOCKER' || v.rentalType === 'GYM_LOCKER';
    if (isLockerRental) {
        if (!hasLocker) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `lockerId is required for rentalType ${v.rentalType}`,
                path: ['lockerId'],
            });
        }
        if (hasRoom) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `roomId must not be provided for rentalType ${v.rentalType}`,
                path: ['roomId'],
            });
        }
    }
    else {
        if (!hasRoom) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `roomId is required for rentalType ${v.rentalType}`,
                path: ['roomId'],
            });
        }
        if (hasLocker) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `lockerId must not be provided for rentalType ${v.rentalType}`,
                path: ['lockerId'],
            });
        }
    }
});
/**
 * Schema for renewing a visit.
 */
const RenewVisitSchema = zod_1.z
    .object({
    rentalType: zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    roomId: zod_1.z.string().uuid().optional(),
    lockerId: zod_1.z.string().uuid().optional(),
    renewalHours: zod_1.z.union([zod_1.z.literal(2), zod_1.z.literal(6)]).optional(),
})
    .superRefine((v, ctx) => {
    const hasRoom = Boolean(v.roomId);
    const hasLocker = Boolean(v.lockerId);
    if (hasRoom && hasLocker) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Provide either roomId or lockerId, not both',
            path: ['roomId'],
        });
        return;
    }
    const isLockerRental = v.rentalType === 'LOCKER' || v.rentalType === 'GYM_LOCKER';
    if (isLockerRental) {
        if (!hasLocker) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `lockerId is required for rentalType ${v.rentalType}`,
                path: ['lockerId'],
            });
        }
        if (hasRoom) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `roomId must not be provided for rentalType ${v.rentalType}`,
                path: ['roomId'],
            });
        }
    }
    else {
        if (!hasRoom) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `roomId is required for rentalType ${v.rentalType}`,
                path: ['roomId'],
            });
        }
        if (hasLocker) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `lockerId must not be provided for rentalType ${v.rentalType}`,
                path: ['lockerId'],
            });
        }
    }
});
/**
 * Visit management routes.
 * Handles visit creation, renewal, and active visit search.
 */
async function visitRoutes(fastify) {
    /**
     * POST /v1/visits - Create an initial visit with initial block
     *
     * Creates a new visit and initial 6-hour block.
     */
    fastify.post('/v1/visits', async (request, reply) => {
        let body;
        try {
            body = CreateVisitSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, visitService_1.createVisit)({
                customerId: body.customerId,
                rentalType: body.rentalType,
                roomId: body.roomId,
                lockerId: body.lockerId,
            });
            // Broadcast inventory update AFTER commit for immediate UI refresh.
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create visit');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/visits/:visitId/renew - Create a renewal block for an existing visit
     *
     * Creates a renewal block that extends from the previous block's end time.
     * Enforces 14-hour maximum visit duration.
     */
    fastify.post('/v1/visits/:visitId/renew', async (request, reply) => {
        let body;
        try {
            body = RenewVisitSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, visitService_1.renewVisit)({
                visitId: request.params.visitId,
                rentalType: body.rentalType,
                roomId: body.roomId,
                lockerId: body.lockerId,
                renewalHours: body.renewalHours,
            });
            // Broadcast inventory update AFTER commit for immediate UI refresh.
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to renew visit');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    (0, active_1.registerVisitActiveRoutes)(fastify);
    fastify.post('/v1/visits/:visitId/final-extension', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireReauth],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { visitId } = request.params;
        const { rentalType, roomId, lockerId } = request.body;
        try {
            const result = await (0, visitService_1.createFinalExtension)({
                visitId,
                rentalType,
                roomId,
                lockerId,
                staffId: staff.staffId,
            });
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create final extension');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
