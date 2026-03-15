"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRpId = getRpId;
exports.getRpOrigin = getRpOrigin;
exports.generateChallenge = generateChallenge;
exports.storeChallenge = storeChallenge;
exports.consumeChallenge = consumeChallenge;
exports.getStaffCredentials = getStaffCredentials;
exports.getCredentialByCredentialId = getCredentialByCredentialId;
exports.storeCredential = storeCredential;
exports.updateCredentialSignCount = updateCredentialSignCount;
exports.cleanupExpiredChallenges = cleanupExpiredChallenges;
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const crypto_1 = __importDefault(require("crypto"));
function parseTransports(value) {
    if (!value || value.length === 0)
        return undefined;
    // These values originate from browser APIs; we store them as text and rehydrate for SimpleWebAuthn.
    return value;
}
/**
 * Get the Relying Party (RP) ID from environment or default to localhost for dev.
 * In production, this should be your actual domain.
 */
function getRpId() {
    return process.env.WEBAUTHN_RP_ID || 'localhost';
}
/**
 * Get the Relying Party (RP) origin from environment or construct from request.
 */
function getRpOrigin(requestOrigin) {
    if (process.env.WEBAUTHN_RP_ORIGIN) {
        return process.env.WEBAUTHN_RP_ORIGIN;
    }
    // For development, use localhost
    if (requestOrigin) {
        try {
            const url = new URL(requestOrigin);
            return url.origin;
        }
        catch {
            // Fallback
        }
    }
    return `http://${getRpId()}:3000`;
}
/**
 * Generate a random challenge for WebAuthn.
 */
function generateChallenge() {
    return crypto_1.default.randomBytes(32).toString('base64url');
}
/**
 * Store a WebAuthn challenge with expiration.
 * Challenges expire after 2 minutes.
 */
async function storeChallenge(challenge, staffId, deviceId, type) {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 2); // 2 minute TTL
    await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO webauthn_challenges (challenge, staff_id, device_id, type, expires_at)
     VALUES (${challenge}, ${staffId}, ${deviceId}, ${type}, ${expiresAt})`);
}
/**
 * Retrieve and consume a WebAuthn challenge.
 * Returns the challenge data if valid, null if expired or not found.
 */
async function consumeChallenge(challenge) {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT staff_id, device_id, type
     FROM webauthn_challenges
     WHERE challenge = ${challenge}
     AND expires_at > NOW()
     FOR UPDATE SKIP LOCKED`);
    if (result.rows.length === 0) {
        return null;
    }
    const row = result.rows[0];
    // Delete the challenge after consuming it (single-use)
    await db_1.db.execute((0, drizzle_orm_1.sql) `DELETE FROM webauthn_challenges WHERE challenge = ${challenge}`);
    return {
        staffId: row.staff_id,
        deviceId: row.device_id,
        type: row.type,
    };
}
/**
 * Get all active WebAuthn credentials for a staff member.
 */
async function getStaffCredentials(staffId) {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT credential_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE staff_id = ${staffId}
     AND revoked_at IS NULL
     ORDER BY created_at DESC`);
    return result.rows.map((row) => ({
        credentialID: Buffer.from(row.credential_id, 'base64url'),
        credentialPublicKey: Buffer.from(row.public_key, 'base64'),
        counter: Number(row.sign_count),
        transports: parseTransports(row.transports),
    }));
}
/**
 * Get a credential by credential ID (for authentication).
 */
async function getCredentialByCredentialId(credentialId) {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT staff_id, public_key, sign_count, transports
     FROM staff_webauthn_credentials
     WHERE credential_id = ${credentialId}
     AND revoked_at IS NULL`);
    if (result.rows.length === 0) {
        return null;
    }
    const row = result.rows[0];
    return {
        staffId: row.staff_id,
        credential: {
            credentialID: Buffer.from(credentialId, 'base64url'),
            credentialPublicKey: Buffer.from(row.public_key, 'base64'),
            counter: Number(row.sign_count),
            transports: parseTransports(row.transports),
        },
    };
}
/**
 * Store a new WebAuthn credential after successful registration.
 */
async function storeCredential(staffId, deviceId, credentialId, publicKey, signCount, transports) {
    const publicKeyBase64 = publicKey.toString('base64');
    const transportsJson = transports ? JSON.stringify(transports) : null;
    await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO staff_webauthn_credentials 
     (staff_id, device_id, credential_id, public_key, sign_count, transports)
     VALUES (${staffId}, ${deviceId}, ${credentialId}, ${publicKeyBase64}, ${signCount}, ${transportsJson})`);
}
/**
 * Update credential sign count after successful authentication.
 */
async function updateCredentialSignCount(credentialId, newSignCount) {
    await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE staff_webauthn_credentials
     SET sign_count = ${newSignCount}, last_used_at = NOW()
     WHERE credential_id = ${credentialId}
     AND revoked_at IS NULL`);
}
/**
 * Clean up expired challenges (should be run periodically).
 */
async function cleanupExpiredChallenges() {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `DELETE FROM webauthn_challenges WHERE expires_at < NOW() RETURNING id`);
    return result.rows.length;
}
