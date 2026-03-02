import { z } from 'zod';
/**
 * Zod schema for RoomStatus enum validation.
 */
export declare const RoomStatusSchema: z.ZodNativeEnum<{
    readonly DIRTY: "DIRTY";
    readonly CLEANING: "CLEANING";
    readonly CLEAN: "CLEAN";
    readonly OCCUPIED: "OCCUPIED";
    readonly OUT_OF_SERVICE: "OUT_OF_SERVICE";
}>;
/**
 * Zod schema for RoomType enum validation.
 */
export declare const RoomTypeSchema: z.ZodNativeEnum<{
    readonly STANDARD: "STANDARD";
    readonly DOUBLE: "DOUBLE";
    readonly SPECIAL: "SPECIAL";
    readonly LOCKER: "LOCKER";
}>;
/**
 * Zod schema for Room entity.
 */
export declare const RoomSchema: z.ZodObject<{
    id: z.ZodString;
    number: z.ZodString;
    type: z.ZodNativeEnum<{
        readonly STANDARD: "STANDARD";
        readonly DOUBLE: "DOUBLE";
        readonly SPECIAL: "SPECIAL";
        readonly LOCKER: "LOCKER";
    }>;
    status: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
        readonly OUT_OF_SERVICE: "OUT_OF_SERVICE";
    }>;
    floor: z.ZodNumber;
    lastStatusChange: z.ZodDate;
    assignedToCustomerId: z.ZodOptional<z.ZodString>;
    overrideFlag: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    number: string;
    type: "STANDARD" | "DOUBLE" | "SPECIAL" | "LOCKER";
    status: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    id: string;
    floor: number;
    lastStatusChange: Date;
    overrideFlag: boolean;
    assignedToCustomerId?: string | undefined;
}, {
    number: string;
    type: "STANDARD" | "DOUBLE" | "SPECIAL" | "LOCKER";
    status: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    id: string;
    floor: number;
    lastStatusChange: Date;
    overrideFlag: boolean;
    assignedToCustomerId?: string | undefined;
}>;
/**
 * Zod schema for creating/updating room status.
 */
export declare const RoomStatusUpdateSchema: z.ZodObject<{
    roomId: z.ZodString;
    newStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
        readonly OUT_OF_SERVICE: "OUT_OF_SERVICE";
    }>;
    override: z.ZodDefault<z.ZodBoolean>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    roomId: string;
    newStatus: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    override: boolean;
    reason?: string | undefined;
}, {
    roomId: string;
    newStatus: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    reason?: string | undefined;
    override?: boolean | undefined;
}>;
/**
 * Zod schema for inventory summary.
 */
export declare const InventorySummarySchema: z.ZodObject<{
    clean: z.ZodNumber;
    cleaning: z.ZodNumber;
    dirty: z.ZodNumber;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    dirty: number;
    clean: number;
    cleaning: number;
    total: number;
}, {
    dirty: number;
    clean: number;
    cleaning: number;
    total: number;
}>;
/**
 * Zod schema for batch room status update (cleaning station).
 */
export declare const BatchStatusUpdateSchema: z.ZodObject<{
    roomIds: z.ZodArray<z.ZodString, "many">;
    newStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
        readonly OUT_OF_SERVICE: "OUT_OF_SERVICE";
    }>;
    override: z.ZodDefault<z.ZodBoolean>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    newStatus: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    override: boolean;
    roomIds: string[];
    reason?: string | undefined;
}, {
    newStatus: "DIRTY" | "CLEANING" | "CLEAN" | "OCCUPIED" | "OUT_OF_SERVICE";
    roomIds: string[];
    reason?: string | undefined;
    override?: boolean | undefined;
}>;
export declare const CustomerIdTypeSchema: z.ZodEnum<["STATE_ID", "DRIVERS_LICENSE", "PASSPORT", "OTHER"]>;
/**
 * Zod schema for ID scan payload (PDF417 barcode from driver's license/ID card).
 * Supports both raw barcode string and parsed fields.
 */
export declare const IdScanPayloadSchema: z.ZodEffects<z.ZodObject<{
    raw: z.ZodOptional<z.ZodString>;
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    fullName: z.ZodOptional<z.ZodString>;
    dob: z.ZodOptional<z.ZodString>;
    idExpirationDate: z.ZodOptional<z.ZodString>;
    idNumber: z.ZodOptional<z.ZodString>;
    issuer: z.ZodOptional<z.ZodString>;
    jurisdiction: z.ZodOptional<z.ZodString>;
    idType: z.ZodOptional<z.ZodEnum<["STATE_ID", "DRIVERS_LICENSE", "PASSPORT", "OTHER"]>>;
    idTypeOther: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    raw?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    fullName?: string | undefined;
    dob?: string | undefined;
    idExpirationDate?: string | undefined;
    idNumber?: string | undefined;
    issuer?: string | undefined;
    jurisdiction?: string | undefined;
    idType?: "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined;
    idTypeOther?: string | undefined;
}, {
    raw?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    fullName?: string | undefined;
    dob?: string | undefined;
    idExpirationDate?: string | undefined;
    idNumber?: string | undefined;
    issuer?: string | undefined;
    jurisdiction?: string | undefined;
    idType?: "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined;
    idTypeOther?: string | undefined;
}>, {
    raw?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    fullName?: string | undefined;
    dob?: string | undefined;
    idExpirationDate?: string | undefined;
    idNumber?: string | undefined;
    issuer?: string | undefined;
    jurisdiction?: string | undefined;
    idType?: "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined;
    idTypeOther?: string | undefined;
}, {
    raw?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    fullName?: string | undefined;
    dob?: string | undefined;
    idExpirationDate?: string | undefined;
    idNumber?: string | undefined;
    issuer?: string | undefined;
    jurisdiction?: string | undefined;
    idType?: "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined;
    idTypeOther?: string | undefined;
}>;
export type RoomInput = z.infer<typeof RoomSchema>;
export type RoomStatusUpdateInput = z.infer<typeof RoomStatusUpdateSchema>;
export type InventorySummaryInput = z.infer<typeof InventorySummarySchema>;
export type BatchStatusUpdateInput = z.infer<typeof BatchStatusUpdateSchema>;
export type IdScanPayload = z.infer<typeof IdScanPayloadSchema>;
//# sourceMappingURL=schemas.d.ts.map