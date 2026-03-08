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
 */
const db_1 = require("../db");
const auditLog_1 = require("../audit/auditLog");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function searchStaff(input) {
    let whereClause = '1=1';
    const params = [];
    let paramIndex = 1;
    if (input.search) {
        whereClause += ` AND (name ILIKE $${paramIndex} OR id::text = $${paramIndex})`;
        params.push(`%${input.search}%`);
        paramIndex++;
    }
    if (input.role) {
        whereClause += ` AND role = $${paramIndex}`;
        params.push(input.role);
        paramIndex++;
    }
    if (input.active !== undefined) {
        whereClause += ` AND active = $${paramIndex}`;
        params.push(input.active === 'true');
        paramIndex++;
    }
    const result = await (0, db_1.query)(`SELECT s.id, s.name, s.role, s.active, s.created_at, MAX(ss.created_at) as last_login FROM staff s LEFT JOIN staff_sessions ss ON s.id = ss.staff_id WHERE ${whereClause} GROUP BY s.id, s.name, s.role, s.active, s.created_at ORDER BY s.name`);
    return result.rows.map((row) => ({ id: row.id, name: row.name, role: row.role, active: row.active, createdAt: row.created_at.toISOString(), lastLogin: row.last_login?.toISOString() || null }));
}
async function createStaffMember(input, actorStaffId) {
    const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
    const pinHash = await hashPin(input.pin);
    const result = await (0, db_1.query)(`INSERT INTO staff (name, role, pin_hash, active) VALUES ($1, $2, $3, $4) RETURNING id`, [input.name, input.role, pinHash, input.active]);
    const staffId = result.rows[0].id;
    await (0, auditLog_1.insertAuditLogQuery)(db_1.query, { staffId: actorStaffId, action: 'STAFF_CREATED', entityType: 'staff', entityId: staffId, newValue: { name: input.name, role: input.role, active: input.active } });
    return { id: staffId, name: input.name, role: input.role, active: input.active };
}
async function updateStaffMember(staffId, input, actorStaffId) {
    const updates = [];
    const params = [];
    let paramIndex = 1;
    if (input.name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        params.push(input.name);
        paramIndex++;
    }
    if (input.role !== undefined) {
        updates.push(`role = $${paramIndex}`);
        params.push(input.role);
        paramIndex++;
    }
    if (input.active !== undefined) {
        updates.push(`active = $${paramIndex}`);
        params.push(input.active);
        paramIndex++;
    }
    if (updates.length === 0)
        throw new HttpError_1.HttpError(400, 'No fields to update');
    params.push(staffId);
    const result = await (0, db_1.query)(`UPDATE staff SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING id, name, role, active`, params);
    if (result.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Staff not found');
    const staff = result.rows[0];
    const action = input.active !== undefined ? (input.active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED') : 'STAFF_UPDATED';
    await (0, auditLog_1.insertAuditLogQuery)(db_1.query, { staffId: actorStaffId, action, entityType: 'staff', entityId: staff.id, newValue: input });
    return staff;
}
async function resetStaffPin(staffId, actorStaffId) {
    const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
    const pinHash = await hashPin('000000');
    const staffResult = await (0, db_1.query)(`UPDATE staff SET pin_hash = $1, force_pin_change = true, updated_at = NOW() WHERE id = $2 RETURNING id, name`, [pinHash, staffId]);
    if (staffResult.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Staff not found');
    await (0, auditLog_1.insertAuditLogQuery)(db_1.query, { staffId: actorStaffId, action: 'STAFF_PIN_RESET', entityType: 'staff', entityId: staffId });
    return { success: true, name: staffResult.rows[0].name };
}
