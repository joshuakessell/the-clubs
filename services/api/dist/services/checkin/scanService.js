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
 *
 * Migrated to Drizzle ORM — uses db.transaction() + tx.execute(sql).
 */
const identity_1 = require("../../checkin/identity");
const helpers_1 = require("../../checkin/helpers");
const utils_1 = require("../../checkin/utils");
const customerEnrichment_1 = require("../../domain/customerEnrichment");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable/PoolClient interface
 * expected by external helpers (maybeAttachScanIdentifiers, enrichCustomerIdentity).
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const parts = queryText.split(/\$\d+/);
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            for (let i = 0; i < parts.length; i++) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
                if (i < values.length) {
                    built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
                }
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
// ── Helpers ──
function normalizeIdNumberForMatch(value) {
    if (!value)
        return null;
    const normalized = value.replaceAll(/[^a-z0-9]/gi, '').toUpperCase();
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
const HttpError_1 = require("../../errors/HttpError");
function checkBanned(row) {
    const bannedUntil = (0, utils_1.toDate)(row.banned_until);
    if (bannedUntil && bannedUntil > new Date()) {
        throw new HttpError_1.HttpError(403, `Customer is banned until ${bannedUntil.toISOString()}`, { code: 'BANNED' });
    }
}
function formatCustomer(row) {
    return {
        id: row.id,
        name: row.name,
        dob: row.dob ? new Date(row.dob).toISOString().slice(0, 10) : null,
        membershipNumber: row.membership_number,
    };
}
/** Attach scan identifiers + enrich identity fields in a single call. */
async function attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted) {
    await (0, helpers_1.maybeAttachScanIdentifiers)({
        client: toQueryable(tx),
        customerId: matched.id,
        existingIdScanHash: matched.id_scan_hash,
        existingIdScanValue: matched.id_scan_value,
        idScanHash,
        idScanValue,
    });
    await (0, customerEnrichment_1.enrichCustomerIdentity)(toQueryable(tx), matched.id, {
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
    return db_1.db.transaction(async (tx) => {
        if (isAamva) {
            return processAamvaScan(tx, normalized, input.selectedCustomerId);
        }
        return processNonIdScan(tx, normalized);
    });
}
// ── AAMVA (State ID) Processing ──
async function processAamvaScan(tx, normalized, selectedCustomerId) {
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
        return resolveSelectedCustomer(tx, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue);
    }
    // ── 1) Match by id_scan_hash or id_scan_value ──
    const byHashOrValue = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id_scan_hash = ${idScanHash} OR id_scan_value = ${idScanValue}
     LIMIT 2`);
    const hashRows = byHashOrValue.rows;
    if (hashRows.length > 0) {
        const matched = hashRows.find((r) => r.id_scan_hash === idScanHash) ??
            hashRows[0];
        checkBanned(matched);
        await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);
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
        const byIdNumber = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE id_scan_value = ${scannedIdNumber} OR id_scan_hash = ${idNumberHash}
       LIMIT 2`);
        const idRows = byIdNumber.rows;
        if (idRows.length > 0) {
            const matched = idNumberHash
                ? (idRows.find((r) => r.id_scan_hash === idNumberHash) ??
                    idRows[0])
                : idRows[0];
            checkBanned(matched);
            await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);
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
            const byNameDob = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE dob = ${dobStr}::date
           AND lower(split_part(name, ' ', 1)) = lower(${extracted.firstName})
           AND lower(regexp_replace(name, ${drizzle_orm_1.sql.raw("'^.*\\\\s'")} , '')) = lower(${extracted.lastName})
         LIMIT 2`);
            const nameRows = byNameDob.rows;
            if (nameRows.length > 0) {
                const matched = nameRows[0];
                checkBanned(matched);
                await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);
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
            const fuzzyResult = await fuzzyMatchByDob(tx, dobStr, extracted, scannedIdNumberNormalized, idNumberHash, idScanHash, idScanValue, idScanIssue);
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
async function resolveSelectedCustomer(tx, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue) {
    const selected = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id = ${selectedCustomerId}
     LIMIT 1`);
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
    const chosenDob = chosen.dob ? new Date(chosen.dob).toISOString().slice(0, 10) : null;
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
        client: toQueryable(tx),
        customerId: chosen.id,
        existingIdScanHash: chosen.id_scan_hash,
        existingIdScanValue: chosen.id_scan_value,
        idScanHash,
        idScanValue,
    });
    // Employee-resolution uses a more targeted enrichment (preserves existing DOB)
    // Dynamic SQL: build SET clause conditionally
    const setClauses = [];
    const values = [];
    let paramIdx = 1;
    if (extracted.dob && !chosen.dob) {
        setClauses.push(`dob = $${paramIdx}::date`);
        values.push(extracted.dob);
        paramIdx++;
    }
    if (extracted.idExpirationDate) {
        setClauses.push(`id_expiration_date = $${paramIdx}::date`);
        values.push(extracted.idExpirationDate);
        paramIdx++;
    }
    if (extracted.idNumber) {
        setClauses.push(`id_number = $${paramIdx}`);
        values.push(extracted.idNumber);
        paramIdx++;
    }
    if (extracted.jurisdiction || extracted.issuer) {
        setClauses.push(`id_state = $${paramIdx}`);
        values.push(extracted.jurisdiction || extracted.issuer || '');
        paramIdx++;
    }
    if (extracted.idType) {
        setClauses.push(`id_type = $${paramIdx}`);
        values.push(extracted.idType);
        paramIdx++;
        setClauses.push(`id_type_other = $${paramIdx}`);
        values.push(extracted.idTypeOther ?? null);
        paramIdx++;
    }
    if (setClauses.length > 0) {
        values.push(chosen.id);
        const queryText = `UPDATE customers SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx}`;
        await toQueryable(tx).query(queryText, values);
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
async function fuzzyMatchByDob(tx, dobStr, extracted, scannedIdNumberNormalized, idNumberHash, idScanHash, idScanValue, idScanIssue) {
    const scannedParts = (0, identity_1.splitNamePartsForMatch)(`${extracted.firstName} ${extracted.lastName}`.trim());
    if (!scannedParts)
        return null;
    const candidatesByDob = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value, created_at
     FROM customers
     WHERE dob = ${dobStr}::date
     LIMIT 200`);
    const candidateRows = candidatesByDob.rows;
    const scored = candidateRows
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
        new Date(a.row.created_at).getTime() - new Date(b.row.created_at).getTime());
    if (scored.length === 1) {
        const matched = scored[0].row;
        checkBanned(matched);
        await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);
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
                dob: s.row.dob ? new Date(s.row.dob).toISOString().slice(0, 10) : null,
                membershipNumber: s.row.membership_number,
                matchScore: s.matchScore,
            })),
        };
    }
    return null; // No fuzzy match found
}
// ── Non-ID scan processing ──
async function processNonIdScan(tx, normalized) {
    // Try membership number
    const membershipCandidate = (0, identity_1.parseMembershipNumber)(normalized) || normalized;
    const byMembership = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE membership_number = ${membershipCandidate}
     LIMIT 1`);
    const membershipRows = byMembership.rows;
    if (membershipRows.length > 0) {
        const matched = membershipRows[0];
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
        const byPassport = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE UPPER(id_number) = UPPER(${trimmedInput})
       LIMIT 1`);
        const passportRows = byPassport.rows;
        if (passportRows.length > 0) {
            const matched = passportRows[0];
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
