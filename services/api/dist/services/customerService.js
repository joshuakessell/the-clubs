"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchCustomers = searchCustomers;
exports.listCustomerNotes = listCustomerNotes;
exports.createCustomerNote = createCustomerNote;
exports.getCustomerProfile = getCustomerProfile;
exports.createFromScan = createFromScan;
exports.matchIdentity = matchIdentity;
exports.createManual = createManual;
/**
 * Customer service — business logic for customer management.
 *
 * Extracted from routes/customers.ts. Zero HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const crypto_1 = __importDefault(require("crypto"));
const identity_1 = require("../checkin/identity");
const customerActivityLog_1 = require("../activity/customerActivityLog");
// ── Utility Functions ──
function normalizeScanText(raw) {
    const lf = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = lf.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
    return lines.join('\n').trim();
}
function computeSha256Hex(value) {
    return crypto_1.default.createHash('sha256').update(value).digest('hex');
}
function toDateOnly(dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob))
        return null;
    const d = new Date(`${dob}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()))
        return null;
    return dob;
}
function toDateOnlyString(value) {
    if (!value)
        return null;
    if (typeof value === 'string')
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    if (value instanceof Date)
        return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
    return null;
}
function toIsoTimestamp(value) {
    if (!value)
        return null;
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}
function toDobMonthDay(value) {
    if (!value)
        return null;
    if (typeof value === 'string') {
        const parts = value.split('-');
        if (parts.length >= 3) {
            const mm = parts[1];
            const dd = parts[2];
            if (mm && dd)
                return `${mm}/${dd}`;
        }
        return null;
    }
    if (value instanceof Date) {
        return `${String(value.getUTCMonth() + 1).padStart(2, '0')}/${String(value.getUTCDate()).padStart(2, '0')}`;
    }
    return null;
}
function normalizePersonNameForMatch(input) {
    const lowered = input.toLowerCase().trim();
    const noPunct = lowered.replace(/[^a-z0-9 ]+/g, ' ');
    const collapsed = noPunct.replace(/\s+/g, ' ').trim();
    if (!collapsed)
        return '';
    const tokens = collapsed.split(' ').filter(Boolean);
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
    while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1]))
        tokens.pop();
    return tokens.join(' ');
}
function splitNamePartsForMatch(input) {
    const normalizedFull = normalizePersonNameForMatch(input);
    if (!normalizedFull)
        return null;
    const tokens = normalizedFull.split(' ').filter(Boolean);
    if (tokens.length === 0)
        return null;
    return { normalizedFull, firstToken: tokens[0], lastToken: tokens[tokens.length - 1] };
}
function scoreNameSimilarity(input, stored) {
    let score = 0;
    if (input.normalizedFull === stored.normalizedFull)
        score += 3;
    const direct = input.firstToken === stored.firstToken && input.lastToken === stored.lastToken;
    const swapped = input.firstToken === stored.lastToken && input.lastToken === stored.firstToken;
    if (direct)
        score += 2;
    else if (swapped)
        score += 1;
    if (input.lastToken === stored.lastToken)
        score += 1;
    if (input.firstToken === stored.firstToken)
        score += 1;
    if (input.firstToken[0] && stored.firstToken[0] && input.firstToken[0] === stored.firstToken[0])
        score += 0.5;
    if (input.lastToken[0] && stored.lastToken[0] && input.lastToken[0] === stored.lastToken[0])
        score += 0.5;
    if (stored.firstToken.startsWith(input.firstToken) || input.firstToken.startsWith(stored.firstToken))
        score += 0.5;
    if (stored.lastToken.startsWith(input.lastToken) || input.lastToken.startsWith(stored.lastToken))
        score += 0.5;
    return score;
}
function parseNotesCursor(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (!parsed || typeof parsed !== 'object')
            return null;
        if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string')
            return null;
        const d = new Date(parsed.createdAt);
        if (!Number.isFinite(d.getTime()))
            return null;
        return { createdAt: d, id: parsed.id };
    }
    catch {
        return null;
    }
}
function buildNotesCursor(value) {
    return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }), 'utf8').toString('base64');
}
const IdTypeValues = ['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER'];
function isIdType(v) { return IdTypeValues.includes(v); }
// ── Service Methods ──
async function searchCustomers(q, limit) {
    const like = `${q}%`;
    const result = await (0, db_1.query)(`SELECT id, name, membership_number, dob FROM customers
     WHERE name ILIKE $1 OR split_part(name, ' ', 2) ILIKE $1
     ORDER BY name LIMIT $2`, [like, limit]);
    return result.rows.map((row) => {
        const nameParts = row.name.split(' ');
        const firstName = nameParts[0] || row.name;
        const lastName = nameParts.slice(1).join(' ') || '';
        const disambiguator = (row.membership_number && row.membership_number.slice(-4)) || row.id.slice(0, 8);
        return {
            id: row.id, name: row.name, firstName, lastName,
            membershipNumber: row.membership_number || undefined,
            dobMonthDay: toDobMonthDay(row.dob) ?? undefined,
            disambiguator,
        };
    });
}
async function listCustomerNotes(customerId, opts) {
    const cursor = parseNotesCursor(opts.cursor);
    const rows = await (0, db_1.query)(`SELECT id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important
     FROM customer_notes WHERE customer_id = $1 AND deleted_at IS NULL
     AND ($2::timestamptz IS NULL OR (created_at < $2 OR (created_at = $2 AND id < $3::uuid)))
     ORDER BY created_at DESC, id DESC LIMIT $4`, [customerId, cursor?.createdAt ?? null, cursor?.id ?? '00000000-0000-0000-0000-000000000000', opts.limit]);
    const notes = rows.rows.map((r) => ({
        id: r.id, customerId: r.customer_id, createdAt: r.created_at.toISOString(),
        createdByStaffId: r.created_by_staff_id, createdByStaffName: r.created_by_staff_name,
        sourceApp: r.source_app, note: r.note, isImportant: r.is_important,
        cursor: buildNotesCursor({ createdAt: r.created_at, id: r.id }),
    }));
    const nextCursor = notes.length === opts.limit ? notes[notes.length - 1].cursor : null;
    return { notes, nextCursor };
}
async function createCustomerNote(customerId, noteText, staff, opts) {
    const trimmed = noteText.trim();
    if (!trimmed)
        throw { statusCode: 400, message: 'note is required' };
    return (0, db_1.transaction)(async (client) => {
        const inserted = await client.query(`INSERT INTO customer_notes (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6) RETURNING id, created_at`, [customerId, staff.staffId, staff.staffName, opts.sourceApp ?? 'EMPLOYEE_REGISTER', trimmed, opts.isImportant ?? false]);
        const row = inserted.rows[0];
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
            customerId, actionType: 'NOTE_ADDED', actionCategory: 'NOTE',
            sourceApp: opts.sourceApp ?? 'EMPLOYEE_REGISTER',
            actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.staffName,
            summary: `Note added: ${preview}`,
            metadata: { noteId: row.id, isImportant: opts.isImportant ?? false },
            dedupeKey: null,
        });
        return { id: row.id, createdAt: row.created_at.toISOString() };
    });
}
async function getCustomerProfile(customerId) {
    const normalizedId = customerId?.trim();
    if (!normalizedId)
        return null;
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId);
    const result = await (0, db_1.query)(`SELECT id, name, dob, membership_number, membership_valid_until, id_number, id_type, id_type_other,
            id_expiration_date, primary_language, id_scan_hash, past_due_balance
     FROM customers WHERE ${looksLikeUuid ? 'id = $1' : 'membership_number = $1'} LIMIT 1`, [normalizedId]);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    const nameParts = row.name.split(' ');
    const firstName = nameParts[0] || row.name;
    const lastName = nameParts.slice(1).join(' ') || '';
    const idType = row.id_type && isIdType(row.id_type) ? row.id_type : null;
    const lastVisitResult = await (0, db_1.query)(`SELECT cb.starts_at FROM checkin_blocks cb JOIN visits v ON v.id = cb.visit_id
     WHERE v.customer_id = $1 ORDER BY cb.starts_at DESC LIMIT 1`, [row.id]);
    const lastVisitAt = lastVisitResult.rows.length > 0 ? toIsoTimestamp(lastVisitResult.rows[0].starts_at) : null;
    const pastDueBalance = typeof row.past_due_balance === 'string' ? parseInt(row.past_due_balance, 10) || 0 : (row.past_due_balance ?? 0);
    return {
        id: row.id, name: row.name, firstName, lastName,
        dob: toDateOnlyString(row.dob), dobMonthDay: toDobMonthDay(row.dob),
        membershipNumber: row.membership_number,
        membershipValidUntil: toDateOnlyString(row.membership_valid_until),
        idNumber: row.id_number, idType, idTypeOther: row.id_type_other,
        idExpirationDate: toDateOnlyString(row.id_expiration_date),
        primaryLanguage: row.primary_language === 'EN' || row.primary_language === 'ES' ? row.primary_language : null,
        lastVisitAt, pastDueBalance,
        hasEncryptedLookupMarker: Boolean(row.id_scan_hash),
    };
}
async function createFromScan(input) {
    const idScanValue = normalizeScanText(input.idScanValue || input.rawScanText || '');
    if (!idScanValue)
        throw { statusCode: 400, message: 'Invalid scan input' };
    const idScanHash = (0, identity_1.computeIdScanIdentityHash)({ firstName: input.firstName, lastName: input.lastName, fullName: input.fullName, dob: input.dob }) ||
        input.idScanHash || computeSha256Hex(idScanValue);
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw { statusCode: 400, message: 'Invalid dob; expected YYYY-MM-DD' };
    const idExpirationDate = input.idExpirationDate ? toDateOnly(input.idExpirationDate) : null;
    if (input.idExpirationDate && !idExpirationDate)
        throw { statusCode: 400, message: 'Invalid idExpirationDate; expected YYYY-MM-DD' };
    const idType = input.idType ?? null;
    const idTypeOther = idType === 'OTHER' ? (input.idTypeOther?.trim() || null) : null;
    const idScanIssue = (0, identity_1.getIdScanIssue)({ dob, idExpirationDate });
    if (idScanIssue)
        throw { statusCode: 403, message: (0, identity_1.getIdScanIssueMessage)(idScanIssue), code: idScanIssue };
    const name = (input.fullName?.trim() || `${input.firstName} ${input.lastName}`.trim()).slice(0, 255);
    if (!name)
        throw { statusCode: 400, message: 'Invalid name' };
    // Check for existing customer
    const existing = await (0, db_1.query)(`SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value FROM customers WHERE id_scan_hash = $1 OR id_scan_value = $2 LIMIT 1`, [idScanHash, idScanValue]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.banned_until && row.banned_until > new Date())
            throw { statusCode: 403, message: 'Customer is banned' };
        const needsScanUpdate = !row.id_scan_hash || !row.id_scan_value || row.id_scan_hash !== idScanHash || row.id_scan_value !== idScanValue;
        if (needsScanUpdate || input.idNumber || input.state || idType || idTypeOther) {
            await (0, db_1.query)(`UPDATE customers SET
         id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> $1 THEN $1 ELSE id_scan_hash END,
         id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> $2 THEN $2 ELSE id_scan_value END,
         id_expiration_date = COALESCE(id_expiration_date, $4::date),
         id_number = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_number END,
         id_state = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE id_state END,
         id_type = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE id_type END,
         id_type_other = CASE WHEN $7::text IS NOT NULL THEN $8 ELSE id_type_other END,
         updated_at = NOW() WHERE id = $3`, [idScanHash, idScanValue, row.id, idExpirationDate, input.idNumber || null, input.state || null, idType, idTypeOther]);
        }
        else if (idExpirationDate) {
            await (0, db_1.query)(`UPDATE customers SET id_expiration_date = $1::date, updated_at = NOW() WHERE id = $2`, [idExpirationDate, row.id]);
        }
        return {
            created: false,
            customer: {
                id: row.id, name: row.name,
                dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
                membershipNumber: row.membership_number,
            },
        };
    }
    const inserted = await (0, db_1.query)(`INSERT INTO customers (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_hash, id_scan_value, created_at, updated_at)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING id, name, dob, membership_number`, [name, dob, idExpirationDate, input.idNumber || null, input.state || null, idType, idTypeOther, idScanHash, idScanValue]);
    const row = inserted.rows[0];
    return {
        created: true,
        customer: { id: row.id, name: row.name, dob: row.dob ? row.dob.toISOString().slice(0, 10) : null, membershipNumber: row.membership_number },
    };
}
async function matchIdentity(input) {
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw { statusCode: 400, message: 'Invalid dob; expected YYYY-MM-DD' };
    const inputParts = splitNamePartsForMatch(`${input.firstName} ${input.lastName}`);
    if (!inputParts)
        throw { statusCode: 400, message: 'Invalid name' };
    // Check by ID number first
    if (input.idNumber?.trim()) {
        const byIdNumber = await (0, db_1.query)(`SELECT id, name, dob, membership_number FROM customers WHERE UPPER(id_number) = UPPER($1) LIMIT 1`, [input.idNumber.trim()]);
        if (byIdNumber.rows.length > 0) {
            const row = byIdNumber.rows[0];
            return {
                matchCount: 1, matchReason: 'ID_NUMBER',
                bestMatch: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob, membershipNumber: row.membership_number },
            };
        }
    }
    // Fuzzy match by name + DOB
    const res = await (0, db_1.query)(`SELECT id, name, dob, membership_number, created_at FROM customers WHERE dob = $1::date ORDER BY created_at ASC LIMIT 50`, [dob]);
    const matches = res.rows
        .map((row) => {
        const parts = splitNamePartsForMatch(row.name);
        if (!parts)
            return null;
        const score = scoreNameSimilarity(inputParts, parts) + (row.membership_number ? 0.5 : 0);
        if (score < 1.5)
            return null;
        return {
            id: row.id, name: row.name,
            dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
            membershipNumber: row.membership_number, score, createdAt: row.created_at,
        };
    })
        .filter(Boolean);
    matches.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
    const best = matches[0] ?? null;
    return {
        matchCount: matches.length,
        bestMatch: best ? { id: best.id, name: best.name, dob: best.dob, membershipNumber: best.membershipNumber } : null,
    };
}
async function createManual(input) {
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw { statusCode: 400, message: 'Invalid dob; expected YYYY-MM-DD' };
    const idExpirationDate = toDateOnly(input.idExpirationDate);
    if (!idExpirationDate)
        throw { statusCode: 400, message: 'Invalid idExpirationDate; expected YYYY-MM-DD' };
    const idType = input.idType;
    const idTypeOther = idType === 'OTHER' ? input.idTypeOther?.trim() || null : null;
    const name = `${input.firstName} ${input.lastName}`.trim().slice(0, 255);
    if (!name)
        throw { statusCode: 400, message: 'Invalid name' };
    const idScanValue = input.idNumber?.trim() || null;
    const idScanIssue = (0, identity_1.getIdScanIssue)({ dob, idExpirationDate });
    if (idScanIssue)
        throw { statusCode: 403, message: (0, identity_1.getIdScanIssueMessage)(idScanIssue), code: idScanIssue };
    // Dedup: check ID number
    if (idScanValue) {
        const byIdNumber = await (0, db_1.query)(`SELECT id, name, dob, membership_number FROM customers WHERE UPPER(id_number) = UPPER($1) LIMIT 1`, [idScanValue]);
        if (byIdNumber.rows.length > 0) {
            const row = byIdNumber.rows[0];
            return {
                created: false, existing: true, matchReason: 'ID_NUMBER',
                customer: { id: row.id, name: row.name, dob: row.dob ? row.dob.toISOString().slice(0, 10) : null, membershipNumber: row.membership_number },
            };
        }
    }
    // Dedup: check name + DOB
    const byNameDob = await (0, db_1.query)(`SELECT id, name, dob, membership_number FROM customers WHERE dob = $1::date AND LOWER(name) = LOWER($2) LIMIT 1`, [dob, name]);
    if (byNameDob.rows.length > 0) {
        const row = byNameDob.rows[0];
        return {
            created: false, existing: true, matchReason: 'NAME_DOB',
            customer: { id: row.id, name: row.name, dob: row.dob ? row.dob.toISOString().slice(0, 10) : null, membershipNumber: row.membership_number },
        };
    }
    const inserted = await (0, db_1.query)(`INSERT INTO customers (name, dob, id_expiration_date, id_type, id_type_other, id_scan_value, id_number, created_at, updated_at)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, NOW(), NOW()) RETURNING id, name, dob, membership_number`, [name, dob, idExpirationDate, idType, idTypeOther, idScanValue, idScanValue]);
    const row = inserted.rows[0];
    return {
        created: true,
        customer: { id: row.id, name: row.name, dob: row.dob ? row.dob.toISOString().slice(0, 10) : null, membershipNumber: row.membership_number },
    };
}
