import { z } from 'zod';
const uuidSchema = z.string().uuid();
export const CustomerActivityActorTypeSchema = z.enum(['STAFF', 'CUSTOMER', 'SYSTEM']);
export const CustomerActivitySourceAppSchema = z.enum([
    'EMPLOYEE_REGISTER',
    'OFFICE_DASHBOARD',
    'CUSTOMER_KIOSK',
    'SYSTEM',
]);
export const CustomerActivityActionCategorySchema = z.enum([
    'CHECKIN',
    'CHECKOUT',
    'UPGRADE',
    'PURCHASE',
    'RESOURCE_CHANGE',
    'NOTE',
    'ADMIN',
]);
export const CustomerActivityActionTypeSchema = z.enum([
    'CHECKIN_STARTED',
    'CHECKIN_COMPLETED',
    'CHECKOUT_REQUEST_CREATED',
    'CHECKOUT_COMPLETED',
    'UPGRADE_STARTED',
    'UPGRADE_COMPLETED',
    'ORDER_PAID',
    'ADDON_PURCHASED',
    'ROOM_CHANGED',
    'LOCKER_CHANGED',
    'NOTE_ADDED',
    'PAST_DUE_WAIVED',
]);
export const CustomerActivityActorSchema = z
    .object({
    type: CustomerActivityActorTypeSchema,
    staffId: uuidSchema.nullable().optional(),
    staffName: z.string().min(1).max(255).nullable().optional(),
    deviceId: z.string().max(255).nullable().optional(),
    registerNumber: z.number().int().min(1).max(20).nullable().optional(),
})
    .superRefine((val, ctx) => {
    if (val.type === 'STAFF') {
        if (!val.staffId) {
            ctx.addIssue({ code: 'custom', message: 'staffId required for STAFF actor' });
        }
        if (!val.staffName) {
            ctx.addIssue({ code: 'custom', message: 'staffName required for STAFF actor' });
        }
    }
});
export const CustomerActivityResourceRefSchema = z.object({
    type: z.enum(['room', 'locker']),
    number: z.string().min(1).max(20),
    resourceId: uuidSchema.nullable().optional(),
});
const MoneyCentsSchema = z.number().int().min(0).max(2_000_000_000);
export const CustomerActivityMetadataSchemas = {
    CHECKIN_STARTED: z.object({
        laneId: z.string().min(1).max(50),
        laneSessionId: uuidSchema,
        mode: z.enum(['CHECKIN', 'RENEWAL']),
        startedFrom: z.enum(['SCAN', 'SEARCH', 'MANUAL_ENTRY']).nullable().optional(),
        proposedRentalType: z.enum(['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL']).nullable().optional(),
        deviceId: z.string().max(255).nullable().optional(),
        registerNumber: z.number().int().min(1).max(20).nullable().optional(),
    }),
    CHECKIN_COMPLETED: z.object({
        visitId: uuidSchema,
        checkinBlockId: uuidSchema,
        assignedResource: CustomerActivityResourceRefSchema,
        membershipPurchaseIntent: z.enum(['PURCHASE', 'RENEW']).nullable().optional(),
        membershipChoice: z.enum(['ONE_TIME', 'SIX_MONTH']).nullable().optional(),
        renewalHours: z.union([z.literal(2), z.literal(6)]).nullable().optional(),
        amountCents: MoneyCentsSchema,
        currency: z.enum(['USD']),
        paymentIntentId: uuidSchema.nullable().optional(),
        waitlistId: uuidSchema.nullable().optional(),
    }),
    CHECKOUT_REQUEST_CREATED: z.object({
        checkoutRequestId: uuidSchema,
        visitId: uuidSchema,
        resource: CustomerActivityResourceRefSchema,
        reason: z.string().max(200).nullable().optional(),
    }),
    CHECKOUT_COMPLETED: z.object({
        visitId: uuidSchema,
        checkoutRequestId: uuidSchema.nullable().optional(),
        resource: CustomerActivityResourceRefSchema,
        chargesCents: MoneyCentsSchema,
        paidCents: MoneyCentsSchema,
        tipCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
        paymentIntentId: uuidSchema.nullable().optional(),
        paymentMethod: z.enum(['CASH', 'CARD', 'SPLIT', 'OTHER']).nullable().optional(),
    }),
    UPGRADE_STARTED: z.object({
        visitId: uuidSchema,
        fromResource: CustomerActivityResourceRefSchema,
        target: z
            .object({
            toResource: CustomerActivityResourceRefSchema.nullable().optional(),
            toTier: z.string().min(1).max(50).nullable().optional(),
        })
            .refine((val) => !!val.toResource || !!val.toTier, {
            message: 'target.toResource or target.toTier required',
        }),
        upgradeHoldId: uuidSchema.nullable().optional(),
        waitlistId: uuidSchema.nullable().optional(),
        estimatedFeeCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    }),
    UPGRADE_COMPLETED: z.object({
        visitId: uuidSchema,
        fromResource: CustomerActivityResourceRefSchema,
        target: z
            .object({
            toResource: CustomerActivityResourceRefSchema.nullable().optional(),
            toTier: z.string().min(1).max(50).nullable().optional(),
        })
            .refine((val) => !!val.toResource || !!val.toTier, {
            message: 'target.toResource or target.toTier required',
        }),
        amountCents: MoneyCentsSchema,
        currency: z.enum(['USD']),
        paymentIntentId: uuidSchema.nullable().optional(),
    }),
    ORDER_PAID: z.object({
        orderId: uuidSchema,
        visitId: uuidSchema.nullable().optional(),
        totalCents: MoneyCentsSchema,
        currency: z.enum(['USD']),
        taxCents: MoneyCentsSchema.nullable().optional(),
        tipCents: MoneyCentsSchema.nullable().optional(),
        discountCents: MoneyCentsSchema.nullable().optional(),
        paymentIntentId: uuidSchema.nullable().optional(),
        paymentMethod: z.enum(['CASH', 'CARD', 'SPLIT', 'OTHER']).nullable().optional(),
        registerNumber: z.number().int().min(1).max(20).nullable().optional(),
        deviceId: z.string().max(255).nullable().optional(),
        lineItems: z
            .array(z.object({
            sku: z.string().max(80).nullable().optional(),
            name: z.string().min(1).max(120),
            category: z.string().max(80).nullable().optional(),
            quantity: z.number().int().min(1).max(999),
            unitPriceCents: MoneyCentsSchema.nullable().optional(),
            totalCents: MoneyCentsSchema,
        }))
            .max(50)
            .nullable()
            .optional(),
    }),
    ADDON_PURCHASED: z.object({
        visitId: uuidSchema,
        addOns: z
            .array(z.object({
            code: z.string().max(80).nullable().optional(),
            name: z.string().min(1).max(120),
            quantity: z.number().int().min(1).max(999),
            totalCents: MoneyCentsSchema,
        }))
            .min(1)
            .max(50),
        totalCents: MoneyCentsSchema,
        currency: z.enum(['USD']),
        paymentIntentId: uuidSchema.nullable().optional(),
    }),
    ROOM_CHANGED: z.object({
        visitId: uuidSchema,
        fromResource: CustomerActivityResourceRefSchema,
        toResource: CustomerActivityResourceRefSchema,
        reason: z
            .enum(['UPGRADE', 'MAINTENANCE', 'CUSTOMER_REQUEST', 'STAFF_CORRECTION', 'OTHER'])
            .nullable()
            .optional(),
    }),
    LOCKER_CHANGED: z.object({
        visitId: uuidSchema,
        fromResource: CustomerActivityResourceRefSchema,
        toResource: CustomerActivityResourceRefSchema,
        reason: z
            .enum(['UPGRADE', 'MAINTENANCE', 'CUSTOMER_REQUEST', 'STAFF_CORRECTION', 'OTHER'])
            .nullable()
            .optional(),
    }),
    NOTE_ADDED: z.object({
        noteId: uuidSchema,
        isImportant: z.boolean(),
        noteLength: z.number().int().min(0).max(10000).nullable().optional(),
        notePreview: z.string().max(140).nullable().optional(),
    }),
    PAST_DUE_WAIVED: z.object({
        previousPastDueCents: MoneyCentsSchema,
        newPastDueCents: MoneyCentsSchema,
        reason: z.string().max(200).nullable().optional(),
    }),
};
const ActivityMetadataSchema = z.union([
    CustomerActivityMetadataSchemas.CHECKIN_STARTED,
    CustomerActivityMetadataSchemas.CHECKIN_COMPLETED,
    CustomerActivityMetadataSchemas.CHECKOUT_REQUEST_CREATED,
    CustomerActivityMetadataSchemas.CHECKOUT_COMPLETED,
    CustomerActivityMetadataSchemas.UPGRADE_STARTED,
    CustomerActivityMetadataSchemas.UPGRADE_COMPLETED,
    CustomerActivityMetadataSchemas.ORDER_PAID,
    CustomerActivityMetadataSchemas.ADDON_PURCHASED,
    CustomerActivityMetadataSchemas.ROOM_CHANGED,
    CustomerActivityMetadataSchemas.LOCKER_CHANGED,
    CustomerActivityMetadataSchemas.NOTE_ADDED,
    CustomerActivityMetadataSchemas.PAST_DUE_WAIVED,
]);
export const CustomerActivityEventSchema = z.object({
    id: uuidSchema,
    occurredAt: z.string().datetime(),
    customerId: uuidSchema,
    actionType: CustomerActivityActionTypeSchema,
    actionCategory: CustomerActivityActionCategorySchema,
    sourceApp: CustomerActivitySourceAppSchema,
    actor: CustomerActivityActorSchema,
    summary: z.string().min(1).max(500),
    metadata: ActivityMetadataSchema,
    dedupeKey: z.string().max(200).nullable().optional(),
    customerName: z.string().max(255).optional(),
});
export const CustomerNotesListSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    cursor: z.string().optional(),
});
export const CreateCustomerNoteSchema = z.object({
    note: z.string().min(1).max(2000),
    isImportant: z.boolean().optional(),
    sourceApp: CustomerActivitySourceAppSchema.optional(),
});
//# sourceMappingURL=customerActivitySchemas.js.map