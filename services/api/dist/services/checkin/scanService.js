"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCheckinScan = processCheckinScan;
/**
 * Check-in scan service — server-side scan normalization, classification,
 * parsing, and customer matching.
 *
 * Extracted from routes/checkin/scan.ts to separate HTTP concerns from
 * business logic. This module contains ZERO HTTP/Fastify concepts.
 *
 * Uses domain helpers from Phase 0:
 *   - domain/customerEnrichment.ts (enrichCustomerIdentity)
 *   - checkin/helpers.ts (maybeAttachScanIdentifiers)
 */
const identity_1 = require("../../checkin/identity");
const helpers_1 = require("../../checkin/helpers");
const utils_1 = require("../../checkin/utils");
const customerEnrichment_1 = require("../../domain/customerEnrichment");
const db_1 = require("../../db");
// ── Helpers ──
function normalizeIdNumberForMatch(value) {
    if (!value)
        return null;
    const normalized = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    return normalized || null;
}
function extractStoredIdNumberForMatch(value) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    if ((0, identity_1.isLikelyAamvaPdf417Text)(trimmed)) {
        const extracted = (0, identity_1.extractAamvaIdentity)((0, identity_1.normalizeScanText)(trimmed));
        return extracted.idNumber ?? null;
    }
    return trimmed;
}
function checkBanned(row) {
    const bannedUntil = (0, utils_1.toDate)(row.banned_until);
    if (bannedUntil && bannedUntil > new Date()) {
        throw {
            statusCode: 403,
            code: 'BANNED',
            message: `Customer is banned until ${bannedUntil.toISOString()}`,
        };
    }
}
function formatCustomer(row) {
    return {
        id: row.id,
        name: row.name,
        dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
        membershipNumber: row.membership_number,
    };
}
/** Attach scan identifiers + enrich identity fields in a single call. */
async function attachAndEnrich(client, matched, idScanHash, idScanValue, extracted) {
    await (0, helpers_1.maybeAttachScanIdentifiers)({
        client: client,
        customerId: matched.id,
        existingIdScanHash: matched.id_scan_hash,
        existingIdScanValue: matched.id_scan_value,
        idScanHash,
        idScanValue,
    });
    await (0, customerEnrichment_1.enrichCustomerIdentity)(client, matched.id, {
        idExpirationDate: extracted.idExpirationDate,
        idNumber: extracted.idNumber,
        idState: extracted.jurisdiction || extracted.issuer || null,
        idType: extracted.idType,
        idTypeOther: extracted.idTypeOther,
    });
}
function makeIdScanIssueError(idScanIssue, extras = {}) {
    return {
        result: 'ERROR',
        error: {
            code: idScanIssue,
            message: (0, identity_1.getIdScanIssueMessage)(idScanIssue),
        },
        ...extras,
    };
}
// ── Main Service ──
/**
 * Process a check-in scan.
 *
 * This is the pure business logic extracted from the `POST /v1/checkin/scan`
 * route handler. It runs inside a transaction and returns a typed result
 * object instead of directly writing to a Fastify reply.
 */
async function processCheckinScan(input) {
    const normalized = (0, identity_1.normalizeScanText)(input.rawScanText);
    if (!normalized) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SCAN', message: 'Empty scan input' },
        };
    }
    const isAamva = (0, identity_1.isLikelyAamvaPdf417Text)(normalized);
    if (input.selectedCustomerId && !isAamva) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    return (0, db_1.transaction)(async (client) => {
        if (isAamva) {
            return processAamvaScan(client, normalized, input.selectedCustomerId);
        }
        return processNonIdScan(client, normalized);
    });
}
// ── AAMVA (State ID) Processing ──
async function processAamvaScan(client, normalized, selectedCustomerId) {
    const extracted = (0, identity_1.extractAamvaIdentity)(normalized);
    const idScanIssue = (0, identity_1.getIdScanIssue)({
        dob: extracted.dob,
        idExpirationDate: extracted.idExpirationDate,
    });
    const idScanValue = normalized;
    const idScanHash = (0, identity_1.computeIdScanIdentityHash)({
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        fullName: extracted.fullName,
        dob: extracted.dob,
    }) ?? (0, identity_1.computeSha256Hex)(idScanValue);
    const scannedIdNumber = extracted.idNumber?.trim() || null;
    const scannedIdNumberNormalized = normalizeIdNumberForMatch(scannedIdNumber);
    const issuerForHash = (extracted.issuer || extracted.jurisdiction || '').trim();
    const idNumberHash = scannedIdNumber && issuerForHash
        ? (0, identity_1.computeSha256Hex)(`${issuerForHash}:${scannedIdNumber}`)
        : null;
    // ── 0) Employee-choice resolution ──
    if (selectedCustomerId) {
        return resolveSelectedCustomer(client, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue);
    }
    // ── 1) Match by id_scan_hash or id_scan_value ──
    const byHashOrValue = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id_scan_hash = $1 OR id_scan_value = $2
     LIMIT 2`, [idScanHash, idScanValue]);
    if (byHashOrValue.rows.length > 0) {
        const matched = byHashOrValue.rows.find((r) => r.id_scan_hash === idScanHash) ??
            byHashOrValue.rows[0];
        checkBanned(matched);
        await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);
        if (idScanIssue)
            return makeIdScanIssueError(idScanIssue);
        return {
            result: 'MATCHED',
            scanType: 'STATE_ID',
            normalizedRawScanText: idScanValue,
            idScanHash,
            customer: formatCustomer(matched),
            extracted,
            enriched: false,
        };
    }
    // ── 1b) Fallback match by stored idNumber/hash ──
    if (scannedIdNumber || idNumberHash) {
        const byIdNumber = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE id_scan_value = $1 OR id_scan_hash = $2
       LIMIT 2`, [scannedIdNumber, idNumberHash]);
        if (byIdNumber.rows.length > 0) {
            const matched = idNumberHash
                ? (byIdNumber.rows.find((r) => r.id_scan_hash === idNumberHash) ??
                    byIdNumber.rows[0])
                : byIdNumber.rows[0];
            checkBanned(matched);
            await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);
            if (idScanIssue)
                return makeIdScanIssueError(idScanIssue);
            return {
                result: 'MATCHED',
                scanType: 'STATE_ID',
                normalizedRawScanText: idScanValue,
                idScanHash,
                customer: formatCustomer(matched),
                extracted,
                enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
            };
        }
    }
    // ── 2) Fallback match by (name, DOB) ──
    if (extracted.firstName && extracted.lastName && extracted.dob) {
        const dobStr = extracted.dob;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) {
            // 2a) Exact token match
            const byNameDob = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE dob = $1::date
           AND lower(split_part(name, ' ', 1)) = lower($2)
           AND lower(regexp_replace(name, '^.*\\s', '')) = lower($3)
         LIMIT 2`, [dobStr, extracted.firstName, extracted.lastName]);
            if (byNameDob.rows.length > 0) {
                const matched = byNameDob.rows[0];
                checkBanned(matched);
                await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);
                if (idScanIssue)
                    return makeIdScanIssueError(idScanIssue);
                return {
                    result: 'MATCHED',
                    scanType: 'STATE_ID',
                    normalizedRawScanText: idScanValue,
                    idScanHash,
                    customer: formatCustomer(matched),
                    extracted,
                    enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
                };
            }
            // 2b) Fuzzy match: exact DOB filter in SQL, deterministic similarity in app code
            const fuzzyResult = await fuzzyMatchByDob(client, dobStr, extracted, scannedIdNumberNormalized, idNumberHash, idScanHash, idScanValue, idScanIssue);
            if (fuzzyResult)
                return fuzzyResult;
        }
    }
    // ── 3) No match ──
    if (idScanIssue) {
        return makeIdScanIssueError(idScanIssue, {
            scanType: 'STATE_ID',
            normalizedRawScanText: idScanValue,
            idScanHash,
            extracted,
        });
    }
    return {
        result: 'NO_MATCH',
        scanType: 'STATE_ID',
        normalizedRawScanText: idScanValue,
        idScanHash,
        extracted,
    };
}
// ── Employee-choice resolution (selected customer) ──
async function resolveSelectedCustomer(client, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue) {
    const selected = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id = $1
     LIMIT 1`, [selectedCustomerId]);
    if (selected.rows.length === 0) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    const chosen = selected.rows[0];
    // Require identity fields for selection
    if (!extracted.dob || !extracted.firstName || !extracted.lastName) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    // DOB must match
    const chosenDob = chosen.dob ? chosen.dob.toISOString().slice(0, 10) : null;
    if (chosenDob !== extracted.dob) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    // Name fuzzy validation
    const scannedParts = (0, identity_1.splitNamePartsForMatch)(`${extracted.firstName} ${extracted.lastName}`.trim());
    const storedParts = (0, identity_1.splitNamePartsForMatch)(chosen.name);
    if (!scannedParts || !storedParts) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    const fuzzy = (0, identity_1.scoreNameMatch)({
        scannedFirst: scannedParts.firstToken,
        scannedLast: scannedParts.lastToken,
        storedFirst: storedParts.firstToken,
        storedLast: storedParts.lastToken,
    });
    if (!(0, identity_1.passesFuzzyThresholds)(fuzzy)) {
        return {
            result: 'ERROR',
            error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
        };
    }
    checkBanned(chosen);
    // Attach scan identifiers
    await (0, helpers_1.maybeAttachScanIdentifiers)({
        client: client,
        customerId: chosen.id,
        existingIdScanHash: chosen.id_scan_hash,
        existingIdScanValue: chosen.id_scan_value,
        idScanHash,
        idScanValue,
    });
    // Employee-resolution uses a more targeted enrichment (preserves existing DOB)
    const identityUpdates = [];
    const identityValues = [];
    if (extracted.dob && !chosen.dob) {
        identityUpdates.push(`dob = $${identityValues.length + 1}::date`);
        identityValues.push(extracted.dob);
    }
    if (extracted.idExpirationDate) {
        identityUpdates.push(`id_expiration_date = $${identityValues.length + 1}::date`);
        identityValues.push(extracted.idExpirationDate);
    }
    if (extracted.idNumber) {
        identityUpdates.push(`id_number = $${identityValues.length + 1}`);
        identityValues.push(extracted.idNumber);
    }
    if (extracted.jurisdiction || extracted.issuer) {
        identityUpdates.push(`id_state = $${identityValues.length + 1}`);
        identityValues.push(extracted.jurisdiction || extracted.issuer || '');
    }
    if (extracted.idType) {
        identityUpdates.push(`id_type = $${identityValues.length + 1}`);
        identityValues.push(extracted.idType);
        identityUpdates.push(`id_type_other = $${identityValues.length + 1}`);
        identityValues.push(extracted.idTypeOther ?? null);
    }
    if (identityUpdates.length > 0) {
        identityValues.push(chosen.id);
        await client.query(`UPDATE customers
       SET ${identityUpdates.join(', ')},
           updated_at = NOW()
       WHERE id = $${identityValues.length}`, identityValues);
    }
    if (idScanIssue)
        return makeIdScanIssueError(idScanIssue);
    return {
        result: 'MATCHED',
        scanType: 'STATE_ID',
        normalizedRawScanText: idScanValue,
        idScanHash,
        customer: formatCustomer(chosen),
        extracted,
        enriched: Boolean(!chosen.id_scan_hash || !chosen.id_scan_value),
    };
}
// ── Fuzzy matching by DOB ──
async function fuzzyMatchByDob(client, dobStr, extracted, scannedIdNumberNormalized, idNumberHash, idScanHash, idScanValue, idScanIssue) {
    const scannedParts = (0, identity_1.splitNamePartsForMatch)(`${extracted.firstName} ${extracted.lastName}`.trim());
    if (!scannedParts)
        return null;
    const candidatesByDob = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value, created_at
     FROM customers
     WHERE dob = $1::date
     LIMIT 200`, [dobStr]);
    const scored = candidatesByDob.rows
        .map((row) => {
        const storedParts = (0, identity_1.splitNamePartsForMatch)(row.name);
        if (!storedParts)
            return null;
        const s = (0, identity_1.scoreNameMatch)({
            scannedFirst: scannedParts.firstToken,
            scannedLast: scannedParts.lastToken,
            storedFirst: storedParts.firstToken,
            storedLast: storedParts.lastToken,
        });
        const storedIdNumber = scannedIdNumberNormalized
            ? extractStoredIdNumberForMatch(row.id_scan_value)
            : null;
        const storedIdNumberNormalized = normalizeIdNumberForMatch(storedIdNumber);
        const idMatch = Boolean(scannedIdNumberNormalized &&
            storedIdNumberNormalized &&
            storedIdNumberNormalized === scannedIdNumberNormalized) || Boolean(idNumberHash && row.id_scan_hash === idNumberHash);
        if (!idMatch && !(0, identity_1.passesFuzzyThresholds)(s))
            return null;
        const matchScore = s.score + (idMatch ? 1 : 0);
        return { row, score: s, idMatch, matchScore };
    })
        .filter((x) => Boolean(x))
        .sort((a, b) => b.matchScore - a.matchScore ||
        a.row.created_at.getTime() - b.row.created_at.getTime());
    if (scored.length === 1) {
        const matched = scored[0].row;
        checkBanned(matched);
        await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);
        if (idScanIssue)
            return makeIdScanIssueError(idScanIssue);
        return {
            result: 'MATCHED',
            scanType: 'STATE_ID',
            normalizedRawScanText: idScanValue,
            idScanHash,
            customer: formatCustomer(matched),
            extracted,
            enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
        };
    }
    if (scored.length > 1) {
        return {
            result: 'CANDIDATES',
            scanType: 'STATE_ID',
            normalizedRawScanText: idScanValue,
            idScanHash,
            extracted,
            candidates: scored.slice(0, 10).map((s) => ({
                id: s.row.id,
                name: s.row.name,
                dob: s.row.dob ? s.row.dob.toISOString().slice(0, 10) : null,
                membershipNumber: s.row.membership_number,
                matchScore: s.matchScore,
            })),
        };
    }
    return null; // No fuzzy match found
}
// ── Non-ID scan processing ──
async function processNonIdScan(client, normalized) {
    // Try membership number
    const membershipCandidate = (0, identity_1.parseMembershipNumber)(normalized) || normalized;
    const byMembership = await client.query(`SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE membership_number = $1
     LIMIT 1`, [membershipCandidate]);
    if (byMembership.rows.length > 0) {
        const matched = byMembership.rows[0];
        checkBanned(matched);
        return {
            result: 'MATCHED',
            scanType: 'MEMBERSHIP',
            normalizedRawScanText: normalized,
            membershipNumber: matched.membership_number,
            customer: formatCustomer(matched),
        };
    }
    // Try passport number (short alphanumeric, 5-20 chars)
    const trimmedInput = normalized.trim();
    const isLikelyPassport = /^[A-Z0-9]{5,20}$/i.test(trimmedInput) && !/^\d{11,}$/.test(trimmedInput);
    if (isLikelyPassport) {
        const byPassport = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE UPPER(id_number) = UPPER($1)
       LIMIT 1`, [trimmedInput]);
        if (byPassport.rows.length > 0) {
            const matched = byPassport.rows[0];
            checkBanned(matched);
            return {
                result: 'MATCHED',
                scanType: 'PASSPORT',
                normalizedRawScanText: normalized,
                customer: formatCustomer(matched),
            };
        }
        return {
            result: 'NO_MATCH',
            scanType: 'PASSPORT',
            normalizedRawScanText: normalized,
            passportNumber: trimmedInput,
        };
    }
    return {
        result: 'NO_MATCH',
        scanType: 'MEMBERSHIP',
        normalizedRawScanText: normalized,
        membershipCandidate,
    };
}
