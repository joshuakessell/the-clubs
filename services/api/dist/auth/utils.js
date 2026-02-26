"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_EXPIRY_HOURS = void 0;
exports.hashQrToken = hashQrToken;
exports.hashPin = hashPin;
exports.verifyPin = verifyPin;
exports.generateSessionToken = generateSessionToken;
exports.hashSessionToken = hashSessionToken;
exports.getSessionExpiry = getSessionExpiry;
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
/**
 * Hash a QR token using SHA-256.
 */
function hashQrToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/**
 * Hash a PIN using bcrypt.
 */
async function hashPin(pin) {
    return bcrypt_1.default.hash(pin, 10);
}
/**
 * Verify a PIN against a hash.
 */
async function verifyPin(pin, hash) {
    return bcrypt_1.default.compare(pin, hash);
}
/**
 * Generate a random session token.
 */
function generateSessionToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}
/**
 * Hash a session token using SHA-256 for storage.
 * The raw token is returned to the client once; only the hash is persisted.
 */
function hashSessionToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/**
 * Session expiration time (24 hours).
 */
exports.SESSION_EXPIRY_HOURS = 24;
/**
 * Calculate session expiration timestamp.
 */
function getSessionExpiry() {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + exports.SESSION_EXPIRY_HOURS);
    return expiry;
}
