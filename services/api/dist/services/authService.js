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
exports.listActiveStaff = listActiveStaff;
exports.loginWithPin = loginWithPin;
exports.changeStaffPin = changeStaffPin;
exports.logoutSession = logoutSession;
exports.reauthWithPin = reauthWithPin;
exports.getReauthWebauthnOptions = getReauthWebauthnOptions;
exports.verifyReauthWebauthn = verifyReauthWebauthn;
const db_1 = require("../db");
const schema_1 = require("../db/schema/schema");
const drizzle_orm_1 = require("drizzle-orm");
const utils_1 = require("../auth/utils");
const auditLog_1 = require("../audit/auditLog");
async function listActiveStaff(isDemoMode) {
    const drizzleDb = (0, db_1.getDb)();
    return drizzleDb.query.staff.findMany({
        where: (staff, { eq, and, isNotNull }) => and(eq(staff.active, true), isDemoMode ? undefined : isNotNull(staff.pinHash)),
        columns: { id: true, name: true, role: true },
        orderBy: (staff, { asc }) => [asc(staff.name)],
    });
}
async function loginWithPin(staffLookup, pin, deviceId, deviceType, isDemoMode) {
    const drizzleDb = (0, db_1.getDb)();
    return drizzleDb.transaction(async (tx) => {
        const staffRow = await tx.query.staff.findFirst({
            where: (staff, { or, eq, ilike, and, sql }) => and(or(sql `${staff.id}::text = ${staffLookup}`, ilike(staff.name, staffLookup)), eq(staff.active, true), isDemoMode ? undefined : sql `${staff.pinHash} IS NOT NULL`)
        });
        if (!staffRow)
            return null;
        if (!isDemoMode) {
            if (!staffRow.pinHash || !(await (0, utils_1.verifyPin)(pin, staffRow.pinHash))) {
                return null;
            }
        }
        const sessionToken = (0, utils_1.generateSessionToken)();
        const expiresAt = (0, utils_1.getSessionExpiry)();
        const tokenHash = (0, utils_1.hashSessionToken)(sessionToken);
        const [session] = await tx.insert(schema_1.staffSessions).values({
            staffId: staffRow.id,
            deviceId,
            deviceType: deviceType || 'tablet',
            sessionToken: tokenHash,
            expiresAt: expiresAt.toISOString(),
        }).returning({ id: schema_1.staffSessions.id });
        if (!session)
            throw new Error("Failed to create session");
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId: staffRow.id,
            action: 'STAFF_LOGIN_PIN',
            entityType: 'staff_session',
            entityId: session.id,
        });
        try {
            const activeRegister = await tx.query.registerSessions.findFirst({
                where: (s, { eq, and, isNull }) => and(eq(s.employeeId, staffRow.id), isNull(s.signedOutAt))
            });
            if (!activeRegister) {
                const now = new Date();
                const activeTimeclock = await tx.query.timeclockSessions.findFirst({
                    where: (t, { eq, and, isNull }) => and(eq(t.employeeId, staffRow.id), isNull(t.clockOutAt))
                });
                let shiftId = null;
                try {
                    const shift = await tx.query.employeeShifts.findFirst({
                        where: (s, { eq, and, ne, sql }) => and(eq(s.employeeId, staffRow.id), ne(s.status, 'CANCELED'), sql `((starts_at <= ${now.toISOString()}::timestamptz AND ends_at >= ${now.toISOString()}::timestamptz) OR (starts_at > ${now.toISOString()}::timestamptz AND starts_at <= ${now.toISOString()}::timestamptz + INTERVAL '60 minutes'))`),
                        orderBy: (s, { sql, asc }) => [asc(sql `ABS(EXTRACT(EPOCH FROM (starts_at - ${now.toISOString()}::timestamptz)))`)]
                    });
                    shiftId = shift?.id ?? null;
                }
                catch { }
                if (!activeTimeclock) {
                    await tx.insert(schema_1.timeclockSessions).values({
                        employeeId: staffRow.id,
                        shiftId,
                        clockInAt: now.toISOString(),
                        source: 'OFFICE_DASHBOARD',
                    });
                }
                else if (shiftId && !activeTimeclock.shiftId) {
                    await tx.update(schema_1.timeclockSessions)
                        .set({ shiftId })
                        .where((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.id, activeTimeclock.id));
                }
            }
        }
        catch { }
        return {
            staffId: staffRow.id,
            name: staffRow.name,
            role: staffRow.role,
            sessionToken,
            mustChangePin: staffRow.forcePinChange,
            sessionId: session.id,
        };
    });
}
async function changeStaffPin(staffId, currentPin, newPin) {
    const drizzleDb = (0, db_1.getDb)();
    await drizzleDb.transaction(async (tx) => {
        const staffRow = await tx.query.staff.findFirst({
            where: (staff, { eq, and }) => and(eq(staff.id, staffId), eq(staff.active, true))
        });
        if (!staffRow)
            throw new Error("Unauthorized");
        if (!staffRow.forcePinChange) {
            if (!currentPin)
                throw new Error("Current PIN is required");
            if (!staffRow.pinHash || !(await (0, utils_1.verifyPin)(currentPin, staffRow.pinHash))) {
                throw new Error("Current PIN is incorrect");
            }
            if (newPin === currentPin) {
                throw new Error("New PIN must be different from current PIN");
            }
        }
        const { hashPin } = await Promise.resolve().then(() => __importStar(require('../auth/utils')));
        const newPinHash = await hashPin(newPin);
        await tx.update(schema_1.staff)
            .set({ pinHash: newPinHash, forcePinChange: false, updatedAt: new Date().toISOString() })
            .where((0, drizzle_orm_1.eq)(schema_1.staff.id, staffId));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId,
            action: 'STAFF_PIN_RESET',
            entityType: 'staff',
            entityId: staffId,
            metadata: { selfChange: true, forced: staffRow.forcePinChange },
        });
    });
}
async function logoutSession(tokenHash) {
    const drizzleDb = (0, db_1.getDb)();
    await drizzleDb.transaction(async (tx) => {
        const session = await tx.query.staffSessions.findFirst({
            where: (s, { eq, and, isNull }) => and(eq(s.sessionToken, tokenHash), isNull(s.revokedAt))
        });
        if (!session)
            return;
        await tx.update(schema_1.staffSessions)
            .set({ revokedAt: new Date().toISOString() })
            .where((0, drizzle_orm_1.eq)(schema_1.staffSessions.id, session.id));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId: session.staffId,
            action: 'STAFF_LOGOUT',
            entityType: 'staff_session',
            entityId: session.id,
        });
        try {
            const otherRegister = await tx.query.registerSessions.findFirst({
                where: (s, { eq, and, isNull }) => and(eq(s.employeeId, session.staffId), isNull(s.signedOutAt))
            });
            const otherStaffSession = await tx.query.staffSessions.findFirst({
                where: (s, { eq, and, isNull, gt }) => and(eq(s.staffId, session.staffId), isNull(s.revokedAt), gt(s.expiresAt, new Date().toISOString()))
            });
            if (!otherRegister && !otherStaffSession) {
                await tx.update(schema_1.timeclockSessions)
                    .set({ clockOutAt: new Date().toISOString() })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.employeeId, session.staffId), (0, drizzle_orm_1.isNull)(schema_1.timeclockSessions.clockOutAt)));
            }
        }
        catch { }
    });
}
async function reauthWithPin(staffId, pin, tokenHash) {
    const drizzleDb = (0, db_1.getDb)();
    return drizzleDb.transaction(async (tx) => {
        const staffRow = await tx.query.staff.findFirst({
            where: (staff, { eq, and }) => and(eq(staff.id, staffId), eq(staff.active, true))
        });
        if (!staffRow?.pinHash || !(await (0, utils_1.verifyPin)(pin, staffRow.pinHash))) {
            throw new Error("Invalid credentials");
        }
        const session = await tx.query.staffSessions.findFirst({
            where: (s, { eq, and, isNull }) => and(eq(s.sessionToken, tokenHash), isNull(s.revokedAt))
        });
        if (!session)
            throw new Error("Session not found");
        const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
        await tx.update(schema_1.staffSessions)
            .set({ reauthOkUntil: reauthOkUntil.toISOString() })
            .where((0, drizzle_orm_1.eq)(schema_1.staffSessions.id, session.id));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId,
            action: 'STAFF_REAUTH_PIN',
            entityType: 'staff_session',
            entityId: session.id,
        });
        return reauthOkUntil;
    });
}
async function getReauthWebauthnOptions(staffId, deviceId) {
    const { generateAuthenticationOptions } = await Promise.resolve().then(() => __importStar(require('@simplewebauthn/server')));
    const { getRpId, generateChallenge, storeChallenge, getStaffCredentials } = await Promise.resolve().then(() => __importStar(require('../auth/webauthn.js')));
    const rpId = getRpId();
    const credentials = await getStaffCredentials(staffId);
    if (credentials.length === 0) {
        throw new Error("No passkeys registered for this staff member");
    }
    const challenge = generateChallenge();
    await storeChallenge(challenge, staffId, deviceId, 'reauth');
    return generateAuthenticationOptions({
        rpID: rpId,
        timeout: 120000,
        allowCredentials: credentials.map((cred) => ({
            id: cred.credentialID,
            type: 'public-key',
            transports: cred.transports,
        })),
        userVerification: 'required',
    });
}
async function verifyReauthWebauthn(staffId, deviceId, tokenHash, origin, credentialResponse) {
    const { verifyAuthenticationResponse } = await Promise.resolve().then(() => __importStar(require('@simplewebauthn/server')));
    const { getRpId, getRpOrigin, consumeChallenge, getCredentialByCredentialId, updateCredentialSignCount } = await Promise.resolve().then(() => __importStar(require('../auth/webauthn.js')));
    const rpId = getRpId();
    const rpOrigin = getRpOrigin(origin);
    const drizzleDb = (0, db_1.getDb)();
    return drizzleDb.transaction(async (tx) => {
        const challengeRow = await tx.query.webauthnChallenges.findFirst({
            where: (c, { eq, and, gt }) => and(eq(c.staffId, staffId), eq(c.deviceId, deviceId), eq(c.type, 'reauth'), gt(c.expiresAt, new Date().toISOString())),
            orderBy: (c, { desc }) => [desc(c.createdAt)]
        });
        if (!challengeRow)
            throw new Error("Invalid or expired challenge");
        await consumeChallenge(challengeRow.challenge);
        const credentialId = credentialResponse.id || credentialResponse.rawId || '';
        const credentialData = await getCredentialByCredentialId(credentialId);
        if (!credentialData)
            throw new Error("Credential not found");
        const verification = await verifyAuthenticationResponse({
            response: credentialResponse,
            expectedChallenge: challengeRow.challenge,
            expectedOrigin: rpOrigin,
            expectedRPID: rpId,
            authenticator: credentialData.credential,
            requireUserVerification: true,
        });
        if (!verification.verified)
            throw new Error("Authentication verification failed");
        if (verification.authenticationInfo) {
            await updateCredentialSignCount(credentialId, verification.authenticationInfo.newCounter);
        }
        const session = await tx.query.staffSessions.findFirst({
            where: (s, { eq, and, isNull }) => and(eq(s.sessionToken, tokenHash), isNull(s.revokedAt))
        });
        if (!session)
            throw new Error("Session not found");
        const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
        await tx.update(schema_1.staffSessions)
            .set({ reauthOkUntil: reauthOkUntil.toISOString() })
            .where((0, drizzle_orm_1.eq)(schema_1.staffSessions.id, session.id));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
            staffId,
            action: 'STAFF_REAUTH_WEBAUTHN',
            entityType: 'staff_session',
            entityId: session.id,
        });
        return reauthOkUntil;
    });
}
