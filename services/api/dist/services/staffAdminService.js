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
exports.searchStaff = searchStaff;
exports.createStaffMember = createStaffMember;
exports.updateStaffMember = updateStaffMember;
exports.resetStaffPin = resetStaffPin;
/**
 * Staff admin service — CRUD for staff accounts and PIN management.
 *
 * Extracted from routes/admin/staff.ts. No HTTP/Fastify concepts.
 * Migrated to Drizzle ORM typed queries.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const auditLog_1 = require("../audit/auditLog");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function searchStaff(input) {
    const conditions = [];
    if (input.search) {
        conditions.push((0, drizzle_orm_1.sql) `(${schema_1.staff.name} ILIKE ${'%' + input.search + '%'} OR ${schema_1.staff.id}::text = ${input.search})`);
    }
    if (input.role) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.staff.role, input.role));
    }
    if (input.active !== undefined) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.staff.active, input.active === 'true'));
    }
    const rows = await db_1.db
        .select({
        id: schema_1.staff.id,
        name: schema_1.staff.name,
        role: schema_1.staff.role,
        active: schema_1.staff.active,
        forcePinChange: schema_1.staff.forcePinChange,
        createdAt: schema_1.staff.createdAt,
        lastLogin: (0, drizzle_orm_1.max)(schema_1.staffSessions.createdAt),
    })
        .from(schema_1.staff)
        .leftJoin(schema_1.staffSessions, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.staffSessions.staffId))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .groupBy(schema_1.staff.id, schema_1.staff.name, schema_1.staff.role, schema_1.staff.active, schema_1.staff.forcePinChange, schema_1.staff.createdAt)
        .orderBy((0, drizzle_orm_1.asc)(schema_1.staff.name));
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        active: row.active,
        forcePinChange: row.forcePinChange,
        createdAt: row.createdAt,
        lastLogin: row.lastLogin || null,
    }));
}
async function createStaffMember(input, actorStaffId) {
    const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
    const pinHash = await hashPin(input.pin);
    return db_1.db.transaction(async (tx) => {
        const [inserted] = await tx
            .insert(schema_1.staff)
            .values({
            name: input.name,
            role: input.role,
            pinHash,
            active: input.active,
        })
            .returning({ id: schema_1.staff.id });
        const staffId = inserted.id;
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId: actorStaffId,
            action: 'STAFF_CREATED',
            entityType: 'staff',
            entityId: staffId,
            newValue: { name: input.name, role: input.role, active: input.active },
        });
        return { id: staffId, name: input.name, role: input.role, active: input.active };
    });
}
async function updateStaffMember(staffId, input, actorStaffId) {
    const updates = { updatedAt: (0, drizzle_orm_1.sql) `NOW()` };
    if (input.name !== undefined)
        updates.name = input.name;
    if (input.role !== undefined)
        updates.role = input.role;
    if (input.active !== undefined)
        updates.active = input.active;
    if (input.forcePinChange !== undefined)
        updates.forcePinChange = input.forcePinChange;
    if (Object.keys(updates).length <= 1)
        throw new HttpError_1.HttpError(400, 'No fields to update');
    return db_1.db.transaction(async (tx) => {
        const [updated] = await tx
            .update(schema_1.staff)
            .set(updates)
            .where((0, drizzle_orm_1.eq)(schema_1.staff.id, staffId))
            .returning({
            id: schema_1.staff.id,
            name: schema_1.staff.name,
            role: schema_1.staff.role,
            active: schema_1.staff.active,
        });
        if (!updated)
            throw new HttpError_1.HttpError(404, 'Staff not found');
        let action;
        if (input.active === undefined) {
            action = 'STAFF_UPDATED';
        }
        else if (input.active) {
            action = 'STAFF_ACTIVATED';
        }
        else {
            action = 'STAFF_DEACTIVATED';
        }
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId: actorStaffId,
            action,
            entityType: 'staff',
            entityId: updated.id,
            newValue: input,
        });
        return updated;
    });
}
async function resetStaffPin(staffId, actorStaffId) {
    const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
    const pinHash = await hashPin('000000');
    return db_1.db.transaction(async (tx) => {
        const [updated] = await tx
            .update(schema_1.staff)
            .set({ pinHash, forcePinChange: true, updatedAt: (0, drizzle_orm_1.sql) `NOW()` })
            .where((0, drizzle_orm_1.eq)(schema_1.staff.id, staffId))
            .returning({ id: schema_1.staff.id, name: schema_1.staff.name });
        if (!updated)
            throw new HttpError_1.HttpError(404, 'Staff not found');
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId: actorStaffId,
            action: 'STAFF_PIN_RESET',
            entityType: 'staff',
            entityId: staffId,
        });
        return { success: true, name: updated.name };
    });
}
