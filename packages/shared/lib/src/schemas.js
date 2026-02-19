import { z } from 'zod';
import { RoomStatus, RoomType } from './enums.js';
/**
 * Zod schema for RoomStatus enum validation.
 */
export const RoomStatusSchema = z.nativeEnum(RoomStatus);
/**
 * Zod schema for RoomType enum validation.
 */
export const RoomTypeSchema = z.nativeEnum(RoomType);
/**
 * Zod schema for Room entity.
 */
export const RoomSchema = z.object({
    id: z.string().uuid(),
    number: z.string().min(1),
    type: RoomTypeSchema,
    status: RoomStatusSchema,
    floor: z.number().int().positive(),
    lastStatusChange: z.coerce.date(),
    assignedToCustomerId: z.string().uuid().optional(),
    overrideFlag: z.boolean(),
});
/**
 * Zod schema for creating/updating room status.
 */
export const RoomStatusUpdateSchema = z.object({
    roomId: z.string().uuid(),
    newStatus: RoomStatusSchema,
    override: z.boolean().default(false),
    reason: z.string().optional(),
});
/**
 * Zod schema for inventory summary.
 */
export const InventorySummarySchema = z.object({
    clean: z.number().int().nonnegative(),
    cleaning: z.number().int().nonnegative(),
    dirty: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
/**
 * Zod schema for batch room status update (cleaning station).
 */
export const BatchStatusUpdateSchema = z.object({
    roomIds: z.array(z.string().uuid()).min(1),
    newStatus: RoomStatusSchema,
    override: z.boolean().default(false),
    reason: z.string().optional(),
});
export const CustomerIdTypeSchema = z.enum(['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']);
/**
 * Zod schema for ID scan payload (PDF417 barcode from driver's license/ID card).
 * Supports both raw barcode string and parsed fields.
 */
export const IdScanPayloadSchema = z
    .object({
    raw: z.string().optional(), // Raw PDF417 barcode string (recommended if available)
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    fullName: z.string().optional(), // Full name if first/last not available separately
    dob: z.string().optional(), // Date of birth in ISO YYYY-MM-DD format
    idExpirationDate: z.string().optional(), // ID expiration date in ISO YYYY-MM-DD format
    idNumber: z.string().optional(), // ID number/license number
    issuer: z.string().optional(), // Issuing jurisdiction/state
    jurisdiction: z.string().optional(), // Alternative field name for issuer
    idType: CustomerIdTypeSchema.optional(),
    idTypeOther: z.string().optional(),
})
    .refine((data) => {
    // At least one identifier must be present
    return !!(data.raw || data.fullName || (data.firstName && data.lastName) || data.idNumber);
}, {
    message: 'At least one identifier (raw, fullName, firstName+lastName, or idNumber) must be provided',
});
//# sourceMappingURL=schemas.js.map