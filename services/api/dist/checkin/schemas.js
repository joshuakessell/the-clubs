"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompleteMembershipPurchaseSchema = exports.MembershipChoiceSchema = exports.HighlightOptionSchema = exports.AddOnsSchema = exports.MembershipPurchaseIntentSchema = exports.PastDueBypassSchema = exports.CheckinScanBodySchema = exports.StartLaneSessionBodySchema = void 0;
const zod_1 = require("zod");
exports.StartLaneSessionBodySchema = zod_1.z
    .object({
    customerId: zod_1.z.string().uuid().optional(),
    idScanValue: zod_1.z.string().min(1).optional(),
    membershipScanValue: zod_1.z.string().optional(),
    visitId: zod_1.z.string().uuid().optional(),
    renewalHours: zod_1.z.union([zod_1.z.literal(2), zod_1.z.literal(6)]).optional(),
})
    .refine((val) => !!val.customerId || !!val.idScanValue, {
    message: 'customerId or idScanValue is required',
});
exports.CheckinScanBodySchema = zod_1.z.object({
    laneId: zod_1.z.string().min(1),
    rawScanText: zod_1.z.string().min(1),
    selectedCustomerId: zod_1.z.string().uuid().optional(),
});
exports.PastDueBypassSchema = zod_1.z.object({
    managerId: zod_1.z.string().uuid(),
    managerPin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});
exports.MembershipPurchaseIntentSchema = zod_1.z.object({
    intent: zod_1.z.enum(['PURCHASE', 'RENEW', 'NONE']),
    sessionId: zod_1.z.string().uuid().optional(),
});
exports.AddOnsSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid().optional(),
    items: zod_1.z
        .array(zod_1.z.object({
        label: zod_1.z.string().min(1),
        quantity: zod_1.z.number().int().min(1),
        unitPrice: zod_1.z.number().min(0),
    }))
        .min(1),
});
exports.HighlightOptionSchema = zod_1.z.object({
    step: zod_1.z.enum(['MEMBERSHIP', 'WAITLIST_BACKUP']),
    option: zod_1.z.string().min(1).nullable(),
    sessionId: zod_1.z.string().uuid().optional(),
});
exports.MembershipChoiceSchema = zod_1.z.object({
    choice: zod_1.z.enum(['ONE_TIME', 'SIX_MONTH', 'NONE']),
    sessionId: zod_1.z.string().uuid().optional(),
});
exports.CompleteMembershipPurchaseSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid().optional(),
    membershipNumber: zod_1.z.string().min(1),
});
