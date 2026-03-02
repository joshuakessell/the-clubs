"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarkFeePaidSchema = exports.CreateCheckoutRequestSchema = exports.ResolveKeySchema = void 0;
const zod_1 = require("zod");
exports.ResolveKeySchema = zod_1.z.object({
    token: zod_1.z.string().min(1),
    kioskDeviceId: zod_1.z.string().min(1),
});
exports.CreateCheckoutRequestSchema = zod_1.z.object({
    occupancyId: zod_1.z.string().uuid(), // checkin_block.id
    kioskDeviceId: zod_1.z.string().min(1),
    checklist: zod_1.z.object({
        key: zod_1.z.boolean().optional(),
        towel: zod_1.z.boolean().optional(),
        sheets: zod_1.z.boolean().optional(),
        remote: zod_1.z.boolean().optional(),
    }),
});
exports.MarkFeePaidSchema = zod_1.z.object({
    note: zod_1.z.string().optional(),
    paymentMethod: zod_1.z.enum(['CASH', 'CREDIT']).optional(),
    registerNumber: zod_1.z.number().int().min(1).max(3).optional(),
    tip: zod_1.z.number().int().nonnegative().optional(),
});
