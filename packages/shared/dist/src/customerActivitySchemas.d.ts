import { z } from 'zod';
export declare const CustomerActivityActorTypeSchema: z.ZodEnum<["STAFF", "CUSTOMER", "SYSTEM"]>;
export declare const CustomerActivitySourceAppSchema: z.ZodEnum<["EMPLOYEE_REGISTER", "OFFICE_DASHBOARD", "CUSTOMER_KIOSK", "SYSTEM"]>;
export declare const CustomerActivityActionCategorySchema: z.ZodEnum<["CHECKIN", "CHECKOUT", "UPGRADE", "PURCHASE", "RESOURCE_CHANGE", "NOTE", "ADMIN"]>;
export declare const CustomerActivityActionTypeSchema: z.ZodEnum<["CHECKIN_STARTED", "CHECKIN_COMPLETED", "CHECKOUT_REQUEST_CREATED", "CHECKOUT_COMPLETED", "UPGRADE_STARTED", "UPGRADE_COMPLETED", "ORDER_PAID", "ADDON_PURCHASED", "ROOM_CHANGED", "LOCKER_CHANGED", "NOTE_ADDED", "PAST_DUE_WAIVED"]>;
export declare const CustomerActivityActorSchema: z.ZodEffects<z.ZodObject<{
    type: z.ZodEnum<["STAFF", "CUSTOMER", "SYSTEM"]>;
    staffId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    staffName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    type: "SYSTEM" | "STAFF" | "CUSTOMER";
    staffId?: string | null | undefined;
    staffName?: string | null | undefined;
    deviceId?: string | null | undefined;
    registerNumber?: number | null | undefined;
}, {
    type: "SYSTEM" | "STAFF" | "CUSTOMER";
    staffId?: string | null | undefined;
    staffName?: string | null | undefined;
    deviceId?: string | null | undefined;
    registerNumber?: number | null | undefined;
}>, {
    type: "SYSTEM" | "STAFF" | "CUSTOMER";
    staffId?: string | null | undefined;
    staffName?: string | null | undefined;
    deviceId?: string | null | undefined;
    registerNumber?: number | null | undefined;
}, {
    type: "SYSTEM" | "STAFF" | "CUSTOMER";
    staffId?: string | null | undefined;
    staffName?: string | null | undefined;
    deviceId?: string | null | undefined;
    registerNumber?: number | null | undefined;
}>;
export declare const CustomerActivityResourceRefSchema: z.ZodObject<{
    type: z.ZodEnum<["room", "locker"]>;
    number: z.ZodString;
    resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    number: string;
    type: "room" | "locker";
    resourceId?: string | null | undefined;
}, {
    number: string;
    type: "room" | "locker";
    resourceId?: string | null | undefined;
}>;
export declare const CustomerActivityMetadataSchemas: {
    readonly CHECKIN_STARTED: z.ZodObject<{
        laneId: z.ZodString;
        laneSessionId: z.ZodString;
        mode: z.ZodEnum<["CHECKIN", "RENEWAL"]>;
        startedFrom: z.ZodOptional<z.ZodNullable<z.ZodEnum<["SCAN", "SEARCH", "MANUAL_ENTRY"]>>>;
        proposedRentalType: z.ZodOptional<z.ZodNullable<z.ZodEnum<["LOCKER", "STANDARD", "DOUBLE", "SPECIAL"]>>>;
        deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    }, {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    }>;
    readonly CHECKIN_COMPLETED: z.ZodObject<{
        visitId: z.ZodString;
        checkinBlockId: z.ZodString;
        assignedResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        membershipPurchaseIntent: z.ZodOptional<z.ZodNullable<z.ZodEnum<["PURCHASE", "RENEW"]>>>;
        membershipChoice: z.ZodOptional<z.ZodNullable<z.ZodEnum<["ONE_TIME", "SIX_MONTH"]>>>;
        renewalHours: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodLiteral<2>, z.ZodLiteral<6>]>>>;
        amount: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        waitlistId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    }, {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    }>;
    readonly CHECKOUT_REQUEST_CREATED: z.ZodObject<{
        checkoutRequestId: z.ZodString;
        visitId: z.ZodString;
        resource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    }, {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    }>;
    readonly CHECKOUT_COMPLETED: z.ZodObject<{
        visitId: z.ZodString;
        checkoutRequestId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        resource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        charges: z.ZodNumber;
        paid: z.ZodNumber;
        tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentMethod: z.ZodOptional<z.ZodNullable<z.ZodEnum<["CASH", "CARD", "SPLIT", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    }, {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    }>;
    readonly UPGRADE_STARTED: z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        target: z.ZodEffects<z.ZodObject<{
            toResource: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                type: z.ZodEnum<["room", "locker"]>;
                number: z.ZodString;
                resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }>>>;
            toTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>;
        upgradeHoldId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        waitlistId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        estimatedFee: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    }>;
    readonly UPGRADE_COMPLETED: z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        target: z.ZodEffects<z.ZodObject<{
            toResource: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                type: z.ZodEnum<["room", "locker"]>;
                number: z.ZodString;
                resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }>>>;
            toTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>;
        amount: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    }, {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    }>;
    readonly ORDER_PAID: z.ZodObject<{
        orderId: z.ZodString;
        visitId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        total: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        tax: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        discount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentMethod: z.ZodOptional<z.ZodNullable<z.ZodEnum<["CASH", "CARD", "SPLIT", "OTHER"]>>>;
        registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lineItems: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
            sku: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            name: z.ZodString;
            category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            quantity: z.ZodNumber;
            unitPrice: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }, {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    }, {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    }>;
    readonly ADDON_PURCHASED: z.ZodObject<{
        visitId: z.ZodString;
        addOns: z.ZodArray<z.ZodObject<{
            code: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            name: z.ZodString;
            quantity: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }, {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }>, "many">;
        total: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    }, {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    }>;
    readonly ROOM_CHANGED: z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        toResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodEnum<["UPGRADE", "MAINTENANCE", "CUSTOMER_REQUEST", "STAFF_CORRECTION", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }>;
    readonly LOCKER_CHANGED: z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        toResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodEnum<["UPGRADE", "MAINTENANCE", "CUSTOMER_REQUEST", "STAFF_CORRECTION", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }>;
    readonly NOTE_ADDED: z.ZodObject<{
        noteId: z.ZodString;
        isImportant: z.ZodBoolean;
        noteLength: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        notePreview: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    }, {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    }>;
    readonly PAST_DUE_WAIVED: z.ZodObject<{
        previousPastDue: z.ZodNumber;
        newPastDue: z.ZodNumber;
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    }, {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    }>;
};
export declare const CustomerActivityEventSchema: z.ZodObject<{
    id: z.ZodString;
    occurredAt: z.ZodString;
    customerId: z.ZodString;
    actionType: z.ZodEnum<["CHECKIN_STARTED", "CHECKIN_COMPLETED", "CHECKOUT_REQUEST_CREATED", "CHECKOUT_COMPLETED", "UPGRADE_STARTED", "UPGRADE_COMPLETED", "ORDER_PAID", "ADDON_PURCHASED", "ROOM_CHANGED", "LOCKER_CHANGED", "NOTE_ADDED", "PAST_DUE_WAIVED"]>;
    actionCategory: z.ZodEnum<["CHECKIN", "CHECKOUT", "UPGRADE", "PURCHASE", "RESOURCE_CHANGE", "NOTE", "ADMIN"]>;
    sourceApp: z.ZodEnum<["EMPLOYEE_REGISTER", "OFFICE_DASHBOARD", "CUSTOMER_KIOSK", "SYSTEM"]>;
    actor: z.ZodEffects<z.ZodObject<{
        type: z.ZodEnum<["STAFF", "CUSTOMER", "SYSTEM"]>;
        staffId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        staffName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    }, {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    }>, {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    }, {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    }>;
    summary: z.ZodString;
    metadata: z.ZodUnion<[z.ZodObject<{
        laneId: z.ZodString;
        laneSessionId: z.ZodString;
        mode: z.ZodEnum<["CHECKIN", "RENEWAL"]>;
        startedFrom: z.ZodOptional<z.ZodNullable<z.ZodEnum<["SCAN", "SEARCH", "MANUAL_ENTRY"]>>>;
        proposedRentalType: z.ZodOptional<z.ZodNullable<z.ZodEnum<["LOCKER", "STANDARD", "DOUBLE", "SPECIAL"]>>>;
        deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    }, {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        checkinBlockId: z.ZodString;
        assignedResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        membershipPurchaseIntent: z.ZodOptional<z.ZodNullable<z.ZodEnum<["PURCHASE", "RENEW"]>>>;
        membershipChoice: z.ZodOptional<z.ZodNullable<z.ZodEnum<["ONE_TIME", "SIX_MONTH"]>>>;
        renewalHours: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodLiteral<2>, z.ZodLiteral<6>]>>>;
        amount: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        waitlistId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    }, {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    }>, z.ZodObject<{
        checkoutRequestId: z.ZodString;
        visitId: z.ZodString;
        resource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    }, {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        checkoutRequestId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        resource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        charges: z.ZodNumber;
        paid: z.ZodNumber;
        tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentMethod: z.ZodOptional<z.ZodNullable<z.ZodEnum<["CASH", "CARD", "SPLIT", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    }, {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        target: z.ZodEffects<z.ZodObject<{
            toResource: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                type: z.ZodEnum<["room", "locker"]>;
                number: z.ZodString;
                resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }>>>;
            toTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>;
        upgradeHoldId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        waitlistId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        estimatedFee: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        target: z.ZodEffects<z.ZodObject<{
            toResource: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                type: z.ZodEnum<["room", "locker"]>;
                number: z.ZodString;
                resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }, {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            }>>>;
            toTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }, {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        }>;
        amount: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    }, {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    }>, z.ZodObject<{
        orderId: z.ZodString;
        visitId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        total: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        tax: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        discount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentMethod: z.ZodOptional<z.ZodNullable<z.ZodEnum<["CASH", "CARD", "SPLIT", "OTHER"]>>>;
        registerNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        deviceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lineItems: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
            sku: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            name: z.ZodString;
            category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            quantity: z.ZodNumber;
            unitPrice: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }, {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    }, {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        addOns: z.ZodArray<z.ZodObject<{
            code: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            name: z.ZodString;
            quantity: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }, {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }>, "many">;
        total: z.ZodNumber;
        currency: z.ZodEnum<["USD"]>;
        paymentIntentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    }, {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        toResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodEnum<["UPGRADE", "MAINTENANCE", "CUSTOMER_REQUEST", "STAFF_CORRECTION", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }>, z.ZodObject<{
        visitId: z.ZodString;
        fromResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        toResource: z.ZodObject<{
            type: z.ZodEnum<["room", "locker"]>;
            number: z.ZodString;
            resourceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }, {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodEnum<["UPGRADE", "MAINTENANCE", "CUSTOMER_REQUEST", "STAFF_CORRECTION", "OTHER"]>>>;
    }, "strip", z.ZodTypeAny, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }, {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    }>, z.ZodObject<{
        noteId: z.ZodString;
        isImportant: z.ZodBoolean;
        noteLength: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        notePreview: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    }, {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    }>, z.ZodObject<{
        previousPastDue: z.ZodNumber;
        newPastDue: z.ZodNumber;
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    }, {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    }>]>;
    dedupeKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    customerName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    occurredAt: string;
    customerId: string;
    actionType: "CHECKIN_STARTED" | "CHECKIN_COMPLETED" | "CHECKOUT_COMPLETED" | "NOTE_ADDED" | "PAST_DUE_WAIVED" | "CHECKOUT_REQUEST_CREATED" | "UPGRADE_STARTED" | "UPGRADE_COMPLETED" | "ORDER_PAID" | "ADDON_PURCHASED" | "ROOM_CHANGED" | "LOCKER_CHANGED";
    actionCategory: "CHECKIN" | "CHECKOUT" | "ADMIN" | "UPGRADE" | "PURCHASE" | "RESOURCE_CHANGE" | "NOTE";
    sourceApp: "EMPLOYEE_REGISTER" | "OFFICE_DASHBOARD" | "CUSTOMER_KIOSK" | "SYSTEM";
    actor: {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    };
    summary: string;
    metadata: {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    } | {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    } | {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    } | {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    } | {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    } | {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    } | {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    } | {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    } | {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    };
    dedupeKey?: string | null | undefined;
    customerName?: string | undefined;
}, {
    id: string;
    occurredAt: string;
    customerId: string;
    actionType: "CHECKIN_STARTED" | "CHECKIN_COMPLETED" | "CHECKOUT_COMPLETED" | "NOTE_ADDED" | "PAST_DUE_WAIVED" | "CHECKOUT_REQUEST_CREATED" | "UPGRADE_STARTED" | "UPGRADE_COMPLETED" | "ORDER_PAID" | "ADDON_PURCHASED" | "ROOM_CHANGED" | "LOCKER_CHANGED";
    actionCategory: "CHECKIN" | "CHECKOUT" | "ADMIN" | "UPGRADE" | "PURCHASE" | "RESOURCE_CHANGE" | "NOTE";
    sourceApp: "EMPLOYEE_REGISTER" | "OFFICE_DASHBOARD" | "CUSTOMER_KIOSK" | "SYSTEM";
    actor: {
        type: "SYSTEM" | "STAFF" | "CUSTOMER";
        staffId?: string | null | undefined;
        staffName?: string | null | undefined;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
    };
    summary: string;
    metadata: {
        laneId: string;
        mode: "CHECKIN" | "RENEWAL";
        laneSessionId: string;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        startedFrom?: "SCAN" | "SEARCH" | "MANUAL_ENTRY" | null | undefined;
        proposedRentalType?: "LOCKER" | "STANDARD" | "DOUBLE" | "SPECIAL" | null | undefined;
    } | {
        visitId: string;
        checkinBlockId: string;
        assignedResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        amount: number;
        currency: "USD";
        membershipPurchaseIntent?: "PURCHASE" | "RENEW" | null | undefined;
        membershipChoice?: "ONE_TIME" | "SIX_MONTH" | null | undefined;
        renewalHours?: 2 | 6 | null | undefined;
        paymentIntentId?: string | null | undefined;
        waitlistId?: string | null | undefined;
    } | {
        visitId: string;
        checkoutRequestId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: string | null | undefined;
    } | {
        visitId: string;
        resource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        charges: number;
        paid: number;
        paymentIntentId?: string | null | undefined;
        checkoutRequestId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        waitlistId?: string | null | undefined;
        upgradeHoldId?: string | null | undefined;
        estimatedFee?: number | null | undefined;
    } | {
        visitId: string;
        amount: number;
        currency: "USD";
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        target: {
            toResource?: {
                number: string;
                type: "room" | "locker";
                resourceId?: string | null | undefined;
            } | null | undefined;
            toTier?: string | null | undefined;
        };
        paymentIntentId?: string | null | undefined;
    } | {
        currency: "USD";
        orderId: string;
        total: number;
        deviceId?: string | null | undefined;
        registerNumber?: number | null | undefined;
        visitId?: string | null | undefined;
        paymentIntentId?: string | null | undefined;
        tip?: number | null | undefined;
        paymentMethod?: "CASH" | "CARD" | "SPLIT" | "OTHER" | null | undefined;
        tax?: number | null | undefined;
        discount?: number | null | undefined;
        lineItems?: {
            total: number;
            name: string;
            quantity: number;
            sku?: string | null | undefined;
            category?: string | null | undefined;
            unitPrice?: number | null | undefined;
        }[] | null | undefined;
    } | {
        visitId: string;
        currency: "USD";
        total: number;
        addOns: {
            total: number;
            name: string;
            quantity: number;
            code?: string | null | undefined;
        }[];
        paymentIntentId?: string | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    } | {
        visitId: string;
        fromResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        toResource: {
            number: string;
            type: "room" | "locker";
            resourceId?: string | null | undefined;
        };
        reason?: "UPGRADE" | "OTHER" | "MAINTENANCE" | "CUSTOMER_REQUEST" | "STAFF_CORRECTION" | null | undefined;
    } | {
        noteId: string;
        isImportant: boolean;
        noteLength?: number | null | undefined;
        notePreview?: string | null | undefined;
    } | {
        previousPastDue: number;
        newPastDue: number;
        reason?: string | null | undefined;
    };
    dedupeKey?: string | null | undefined;
    customerName?: string | undefined;
}>;
export declare const CustomerNotesListSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    cursor?: string | undefined;
}, {
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export declare const CreateCustomerNoteSchema: z.ZodObject<{
    note: z.ZodString;
    isImportant: z.ZodOptional<z.ZodBoolean>;
    sourceApp: z.ZodOptional<z.ZodEnum<["EMPLOYEE_REGISTER", "OFFICE_DASHBOARD", "CUSTOMER_KIOSK", "SYSTEM"]>>;
}, "strip", z.ZodTypeAny, {
    note: string;
    isImportant?: boolean | undefined;
    sourceApp?: "EMPLOYEE_REGISTER" | "OFFICE_DASHBOARD" | "CUSTOMER_KIOSK" | "SYSTEM" | undefined;
}, {
    note: string;
    isImportant?: boolean | undefined;
    sourceApp?: "EMPLOYEE_REGISTER" | "OFFICE_DASHBOARD" | "CUSTOMER_KIOSK" | "SYSTEM" | undefined;
}>;
export type CustomerActivityEvent = z.infer<typeof CustomerActivityEventSchema>;
export type CustomerNotesList = z.infer<typeof CustomerNotesListSchema>;
export type CreateCustomerNote = z.infer<typeof CreateCustomerNoteSchema>;
//# sourceMappingURL=customerActivitySchemas.d.ts.map