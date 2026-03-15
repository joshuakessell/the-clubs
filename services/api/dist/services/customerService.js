"use strict";
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
 *
 * Migrated to Drizzle ORM — uses db.execute(sql`...`) for reads and db.transaction() for writes.
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const identity_1 = require("../checkin/identity");
const customerActivityLog_1 = require("../activity/customerActivityLog");
const schema_1 = require("../db/schema");
const HttpError_1 = require("../errors/HttpError");
// ── Utility Functions ──
function normalizeScanText(raw) {
    const lf = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const lines = lf.split('\n').map((line) => line.replaceAll(/[ \t]+/g, ' ').trimEnd());
    return lines.join('\n').trim();
}
function splitFullName(name) {
    const parts = name.split(' ');
    return { firstName: parts[0] || name, lastName: parts.slice(1).join(' ') || '' };
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
    if (typeof value === 'string')
        return value; // Already an ISO string
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
    const noPunct = lowered.replaceAll(/[^a-z0-9 ]+/g, ' ');
    const collapsed = noPunct.replaceAll(/\s+/g, ' ').trim();
    if (!collapsed)
        return '';
    const tokens = collapsed.split(' ').filter(Boolean);
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
    while (tokens.length > 1 && suffixes.has(tokens.at(-1)))
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
    return { normalizedFull, firstToken: tokens[0], lastToken: tokens.at(-1) };
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
    if (input.firstToken.startsWith(stored.firstToken[0] ?? '') && stored.firstToken.startsWith(input.firstToken[0] ?? ''))
        score += 0.5;
    if (input.lastToken.startsWith(stored.lastToken[0] ?? '') && stored.lastToken.startsWith(input.lastToken[0] ?? ''))
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
    const iso = value.createdAt instanceof Date ? value.createdAt.toISOString() : String(value.createdAt);
    return Buffer.from(JSON.stringify({ createdAt: iso, id: value.id }), 'utf8').toString('base64');
}
const IdTypeValues = ['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER'];
function isIdType(v) { return IdTypeValues.includes(v); }
// ── Service Methods ──
async function searchCustomers(q, limit) {
    const like = `${q}%`;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, membership_number, dob FROM customers
     WHERE name ILIKE ${like} OR split_part(name, ' ', 2) ILIKE ${like}
     ORDER BY name LIMIT ${limit}`);
    return result.rows.map((r) => {
        const row = r;
        const { firstName, lastName } = splitFullName(row.name);
        const disambiguator = (row.membership_number?.slice(-4)) || row.id.slice(0, 8);
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
    const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important
     FROM customer_notes WHERE customer_id = ${customerId} AND deleted_at IS NULL
     AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR (created_at < ${cursor?.createdAt ?? null} OR (created_at = ${cursor?.createdAt ?? null} AND id < ${cursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid)))
     ORDER BY created_at DESC, id DESC LIMIT ${opts.limit}`);
    const notes = rows.rows.map((r) => ({
        id: r.id, customerId: r.customer_id,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        createdByStaffId: r.created_by_staff_id, createdByStaffName: r.created_by_staff_name,
        sourceApp: r.source_app, note: r.note, isImportant: r.is_important,
        cursor: buildNotesCursor({ createdAt: r.created_at, id: r.id }),
    }));
    const nextCursor = notes.length === opts.limit ? notes.at(-1).cursor : null;
    return { notes, nextCursor };
}
async function createCustomerNote(customerId, noteText, staff, opts) {
    const trimmed = noteText.trim();
    if (!trimmed)
        throw new HttpError_1.HttpError(400, 'note is required');
    return db_1.db.transaction(async (tx) => {
        const inserted = await tx
            .insert(schema_1.customerNotes)
            .values({
            customerId,
            createdByStaffId: staff.staffId,
            createdByStaffName: staff.staffName,
            sourceApp: opts.sourceApp ?? 'EMPLOYEE_REGISTER',
            note: trimmed,
            isImportant: opts.isImportant ?? false,
        })
            .returning({ id: schema_1.customerNotes.id, createdAt: schema_1.customerNotes.createdAt });
        const row = inserted[0];
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
        await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
            customerId, actionType: 'NOTE_ADDED', actionCategory: 'NOTE',
            sourceApp: opts.sourceApp ?? 'EMPLOYEE_REGISTER',
            actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.staffName,
            summary: `Note added: ${preview}`,
            metadata: { noteId: row.id, isImportant: opts.isImportant ?? false },
            dedupeKey: null,
        });
        return { id: row.id, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
    });
}
async function getCustomerProfile(customerId) {
    const normalizedId = customerId?.trim();
    if (!normalizedId)
        return null;
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId);
    const whereClause = looksLikeUuid ? (0, drizzle_orm_1.sql) `id = ${normalizedId}` : (0, drizzle_orm_1.sql) `membership_number = ${normalizedId}`;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number, membership_valid_until, id_number, id_type, id_type_other,
            id_expiration_date, primary_language, id_scan_hash, past_due_balance
     FROM customers WHERE ${whereClause} LIMIT 1`);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    const { firstName, lastName } = splitFullName(row.name);
    const idType = row.id_type && isIdType(row.id_type) ? row.id_type : null;
    let lastVisitAt = null;
    try {
        const lastVisitResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT cb.starts_at FROM checkin_blocks cb JOIN visits v ON v.id = cb.visit_id
       WHERE v.customer_id = ${row.id} ORDER BY cb.starts_at DESC LIMIT 1`);
        lastVisitAt = lastVisitResult.rows.length > 0 ? toIsoTimestamp(lastVisitResult.rows[0].starts_at) : null;
    }
    catch (err) {
        console.error('[getCustomerProfile] lastVisit query failed:', err);
        // Don't throw — lastVisitAt will just be null
    }
    const pastDueBalance = typeof row.past_due_balance === 'string' ? Number.parseInt(row.past_due_balance, 10) || 0 : (row.past_due_balance ?? 0);
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
        throw new HttpError_1.HttpError(400, 'Invalid scan input');
    const idScanHash = (0, identity_1.computeIdScanIdentityHash)({ firstName: input.firstName, lastName: input.lastName, fullName: input.fullName, dob: input.dob }) ||
        input.idScanHash || (0, identity_1.computeSha256Hex)(idScanValue);
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw new HttpError_1.HttpError(400, 'Invalid dob; expected YYYY-MM-DD');
    const idExpirationDate = input.idExpirationDate ? toDateOnly(input.idExpirationDate) : null;
    if (input.idExpirationDate && !idExpirationDate)
        throw new HttpError_1.HttpError(400, 'Invalid idExpirationDate; expected YYYY-MM-DD');
    const idType = input.idType ?? null;
    const idTypeOther = idType === 'OTHER' ? (input.idTypeOther?.trim() || null) : null;
    const idScanIssue = (0, identity_1.getIdScanIssue)({ dob, idExpirationDate });
    if (idScanIssue)
        throw new HttpError_1.HttpError(403, (0, identity_1.getIdScanIssueMessage)(idScanIssue), { code: idScanIssue });
    const name = (input.fullName?.trim() || `${input.firstName} ${input.lastName}`.trim()).slice(0, 255);
    if (!name)
        throw new HttpError_1.HttpError(400, 'Invalid name');
    // Check for existing customer
    const existing = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value FROM customers WHERE id_scan_hash = ${idScanHash} OR id_scan_value = ${idScanValue} LIMIT 1`);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.banned_until && row.banned_until > new Date())
            throw new HttpError_1.HttpError(403, 'Customer is banned');
        const needsScanUpdate = !row.id_scan_hash || !row.id_scan_value || row.id_scan_hash !== idScanHash || row.id_scan_value !== idScanValue;
        if (needsScanUpdate || input.idNumber || input.state || idType || idTypeOther) {
            await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE customers SET
         id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> ${idScanHash} THEN ${idScanHash} ELSE id_scan_hash END,
         id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> ${idScanValue} THEN ${idScanValue} ELSE id_scan_value END,
         id_expiration_date = COALESCE(id_expiration_date, ${idExpirationDate}::date),
         id_number = CASE WHEN ${input.idNumber || null}::text IS NOT NULL THEN ${input.idNumber || null} ELSE id_number END,
         id_state = CASE WHEN ${input.state || null}::text IS NOT NULL THEN ${input.state || null} ELSE id_state END,
         id_type = CASE WHEN ${idType}::text IS NOT NULL THEN ${idType} ELSE id_type END,
         id_type_other = CASE WHEN ${idType}::text IS NOT NULL THEN ${idTypeOther} ELSE id_type_other END,
         updated_at = NOW() WHERE id = ${row.id}`);
        }
        else if (idExpirationDate) {
            await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE customers SET id_expiration_date = ${idExpirationDate}::date, updated_at = NOW() WHERE id = ${row.id}`);
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
    const inserted = await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO customers (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_hash, id_scan_value, created_at, updated_at)
     VALUES (${name}, ${dob}::date, ${idExpirationDate}::date, ${input.idNumber || null}, ${input.state || null}, ${idType}, ${idTypeOther}, ${idScanHash}, ${idScanValue}, NOW(), NOW()) RETURNING id, name, dob, membership_number`);
    const row = inserted.rows[0];
    return {
        created: true,
        customer: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (typeof row.dob === 'string' ? row.dob.slice(0, 10) : null), membershipNumber: row.membership_number },
    };
}
async function matchIdentity(input) {
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw new HttpError_1.HttpError(400, 'Invalid dob; expected YYYY-MM-DD');
    const inputParts = splitNamePartsForMatch(`${input.firstName} ${input.lastName}`);
    if (!inputParts)
        throw new HttpError_1.HttpError(400, 'Invalid name');
    // Check by ID number first
    if (input.idNumber?.trim()) {
        const byIdNumber = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number FROM customers WHERE UPPER(id_number) = UPPER(${input.idNumber.trim()}) LIMIT 1`);
        if (byIdNumber.rows.length > 0) {
            const row = byIdNumber.rows[0];
            return {
                matchCount: 1, matchReason: 'ID_NUMBER',
                bestMatch: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob, membershipNumber: row.membership_number },
            };
        }
    }
    // Fuzzy match by name + DOB
    const res = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number, created_at FROM customers WHERE dob = ${dob}::date ORDER BY created_at ASC LIMIT 50`);
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
            dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (row.dob),
            membershipNumber: row.membership_number, score, createdAt: row.created_at,
        };
    })
        .filter(Boolean);
    matches.sort((a, b) => b.score - a.score || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const best = matches[0] ?? null;
    return {
        matchCount: matches.length,
        bestMatch: best ? { id: best.id, name: best.name, dob: best.dob, membershipNumber: best.membershipNumber } : null,
    };
}
async function createManual(input) {
    const dob = toDateOnly(input.dob);
    if (!dob)
        throw new HttpError_1.HttpError(400, 'Invalid dob; expected YYYY-MM-DD');
    const idExpirationDate = toDateOnly(input.idExpirationDate);
    if (!idExpirationDate)
        throw new HttpError_1.HttpError(400, 'Invalid idExpirationDate; expected YYYY-MM-DD');
    const idType = input.idType;
    const idTypeOther = idType === 'OTHER' ? input.idTypeOther?.trim() || null : null;
    const name = `${input.firstName} ${input.lastName}`.trim().slice(0, 255);
    if (!name)
        throw new HttpError_1.HttpError(400, 'Invalid name');
    const idScanValue = input.idNumber?.trim() || null;
    const idScanIssue = (0, identity_1.getIdScanIssue)({ dob, idExpirationDate });
    if (idScanIssue)
        throw new HttpError_1.HttpError(403, (0, identity_1.getIdScanIssueMessage)(idScanIssue), { code: idScanIssue });
    // Dedup: check ID number
    if (idScanValue) {
        const byIdNumber = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number FROM customers WHERE UPPER(id_number) = UPPER(${idScanValue}) LIMIT 1`);
        if (byIdNumber.rows.length > 0) {
            const row = byIdNumber.rows[0];
            return {
                created: false, existing: true, matchReason: 'ID_NUMBER',
                customer: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (typeof row.dob === 'string' ? row.dob.slice(0, 10) : null), membershipNumber: row.membership_number },
            };
        }
    }
    // Dedup: check name + DOB
    const byNameDob = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number FROM customers WHERE dob = ${dob}::date AND LOWER(name) = LOWER(${name}) LIMIT 1`);
    if (byNameDob.rows.length > 0) {
        const row = byNameDob.rows[0];
        return {
            created: false, existing: true, matchReason: 'NAME_DOB',
            customer: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (typeof row.dob === 'string' ? row.dob.slice(0, 10) : null), membershipNumber: row.membership_number },
        };
    }
    const inserted = await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO customers (name, dob, id_expiration_date, id_type, id_type_other, id_scan_value, id_number, created_at, updated_at)
     VALUES (${name}, ${dob}::date, ${idExpirationDate}::date, ${idType}, ${idTypeOther}, ${idScanValue}, ${idScanValue}, NOW(), NOW()) RETURNING id, name, dob, membership_number`);
    const row = inserted.rows[0];
    return {
        created: true,
        customer: { id: row.id, name: row.name, dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : (typeof row.dob === 'string' ? row.dob.slice(0, 10) : null), membershipNumber: row.membership_number },
    };
}
