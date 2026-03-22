/**
 * Customer service — business logic for customer management.
 * Fully migrated to Drizzle ORM.
 */
import { db } from '../db';
import { sql, eq, and, or, ilike, isNull, desc, asc, lt } from 'drizzle-orm';
import { customers, customerNotes, checkinBlocks, visits } from '../db/schema/schema';
import { insertCustomerActivityEventDrizzle, type CustomerActivitySourceApp } from '../activity/customerActivityLog';
import { HttpError } from '../errors/HttpError';
import {
  computeIdScanIdentityHash,
  computeSha256Hex,
  getIdScanIssue,
  getIdScanIssueMessage,
} from '../checkin/identity';

export interface StaffContext {
  staffId: string;
  staffName: string;
}

type DobField = string | Date | null;

interface CustomerRow {
  id: string;
  name: string;
  membershipNumber: string | null;
  dob: DobField;
}

type DateOrStringField = string | Date | null;

interface CustomerProfileRow {
  id: string;
  name: string;
  dob: DobField;
  membership_number: string | null;
  membership_valid_until: DateOrStringField;
  id_number: string | null;
  id_type: string | null;
  id_type_other: string | null;
  id_expiration_date: DateOrStringField;
  primary_language: string | null;
  id_scan_hash: string | null;
  past_due_balance: number | string | null;
}

function normalizeScanText(raw: string): string {
  const lf = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = lf.split('\n').map((line) => line.replaceAll(/[ \t]+/g, ' ').trimEnd());
  return lines.join('\n').trim();
}

function splitFullName(name: string) {
  const parts = name.split(' ');
  return { firstName: parts[0] || name, lastName: parts.slice(1).join(' ') || '' };
}

function toDateOnly(dob: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return dob;
}

function toDateOnlyString(value: DateOrStringField | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  return null;
}

function extractDob(dob: Date | string | null | undefined): string | null {
  if (dob instanceof Date) return dob.toISOString().slice(0, 10);
  if (typeof dob === 'string') return dob.slice(0, 10);
  return null;
}

function toIsoTimestamp(value: DateOrStringField | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function toDobMonthDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parts = value.split('-');
    if (parts.length >= 3) { const mm = parts[1]; const dd = parts[2]; if (mm && dd) return `${mm}/${dd}`; }
    return null;
  }
  if (value instanceof Date) {
    return `${String(value.getUTCMonth() + 1).padStart(2, '0')}/${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

type NormalizedNameParts = { normalizedFull: string; firstToken: string; lastToken: string };

function normalizePersonNameForMatch(input: string): string {
  const lowered = input.toLowerCase().trim();
  const noPunct = lowered.replaceAll(/[^a-z0-9 ]+/g, ' ');
  const collapsed = noPunct.replaceAll(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const tokens = collapsed.split(' ').filter(Boolean);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  while (tokens.length > 1) {
    const last = tokens.at(-1);
    if (last && suffixes.has(last)) tokens.pop();
    else break;
  }
  return tokens.join(' ');
}

function splitNamePartsForMatch(input: string): NormalizedNameParts | null {
  const normalizedFull = normalizePersonNameForMatch(input);
  if (!normalizedFull) return null;
  const tokens = normalizedFull.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const firstToken = tokens[0];
  const lastToken = tokens.at(-1);
  if (!firstToken || !lastToken) return null;
  return { normalizedFull, firstToken, lastToken };
}

function scoreNameSimilarity(input: NormalizedNameParts, stored: NormalizedNameParts): number {
  let score = 0;
  if (input.normalizedFull === stored.normalizedFull) score += 3;
  const direct = input.firstToken === stored.firstToken && input.lastToken === stored.lastToken;
  const swapped = input.firstToken === stored.lastToken && input.lastToken === stored.firstToken;
  if (direct) score += 2; else if (swapped) score += 1;
  if (input.lastToken === stored.lastToken) score += 1;
  if (input.firstToken === stored.firstToken) score += 1;
  if (input.firstToken.startsWith(stored.firstToken[0] ?? '') && stored.firstToken.startsWith(input.firstToken[0] ?? '')) score += 0.5;
  if (input.lastToken.startsWith(stored.lastToken[0] ?? '') && stored.lastToken.startsWith(input.lastToken[0] ?? '')) score += 0.5;
  if (stored.firstToken.startsWith(input.firstToken) || input.firstToken.startsWith(stored.firstToken)) score += 0.5;
  if (stored.lastToken.startsWith(input.lastToken) || input.lastToken.startsWith(stored.lastToken)) score += 0.5;
  return score;
}

type NotesCursor = { createdAt: string; id: string };

function parseNotesCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as NotesCursor;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    const d = new Date(parsed.createdAt);
    if (!Number.isFinite(d.getTime())) return null;
    return { createdAt: d, id: parsed.id };
  } catch { return null; }
}

function buildNotesCursor(value: { createdAt: Date | string; id: string }): string {
  const iso = value.createdAt instanceof Date ? value.createdAt.toISOString() : String(value.createdAt);
  return Buffer.from(JSON.stringify({ createdAt: iso, id: value.id }), 'utf8').toString('base64');
}

const IdTypeValues = ['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER'] as const;
type IdType = (typeof IdTypeValues)[number];
function isIdType(v: string): v is IdType { return (IdTypeValues as readonly string[]).includes(v); }

export async function searchCustomers(q: string, limit: number) {
  const like = `${q}%`;

  const result = await db
    .select({
      id: customers.id,
      name: customers.name,
      membershipNumber: customers.membershipNumber,
      dob: customers.dob,
    })
    .from(customers)
    .where(
      or(
        ilike(customers.name, like),
        ilike(sql`split_part(${customers.name}, ' ', 2)`, like)
      )
    )
    .limit(limit);

  return result.map((row) => {
    const { firstName, lastName } = splitFullName(row.name);
    const disambiguator = (row.membershipNumber?.slice(-4)) || row.id.slice(0, 8);
    return {
      id: row.id,
      name: row.name,
      firstName,
      lastName,
      membershipNumber: row.membershipNumber || undefined,
      dobMonthDay: toDobMonthDay(row.dob) ?? undefined,
      disambiguator,
    };
  });
}

export async function listCustomerNotes(
  customerId: string,
  opts: { limit: number; cursor?: string }
) {
  const cursor = parseNotesCursor(opts.cursor);

  let whereCondition;

  if (cursor) {
    whereCondition = and(
      eq(customerNotes.customerId, customerId),
      isNull(customerNotes.deletedAt),
      or(
        lt(customerNotes.createdAt, cursor.createdAt),
        and(
          eq(customerNotes.createdAt, cursor.createdAt),
          lt(customerNotes.id, cursor.id)
        )
      )
    );
  } else {
    whereCondition = and(
      eq(customerNotes.customerId, customerId),
      isNull(customerNotes.deletedAt)
    );
  }

  const rows = await db
    .select({
      id: customerNotes.id,
      customerId: customerNotes.customerId,
      createdAt: customerNotes.createdAt,
      createdByStaffId: customerNotes.createdByStaffId,
      createdByStaffName: customerNotes.createdByStaffName,
      sourceApp: customerNotes.sourceApp,
      note: customerNotes.note,
      isImportant: customerNotes.isImportant,
    })
    .from(customerNotes)
    .where(whereCondition)
    .orderBy(desc(customerNotes.createdAt), desc(customerNotes.id))
    .limit(opts.limit);

  const notes = rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    createdByStaffId: r.createdByStaffId,
    createdByStaffName: r.createdByStaffName,
    sourceApp: r.sourceApp,
    note: r.note,
    isImportant: r.isImportant,
    cursor: buildNotesCursor({ createdAt: r.createdAt, id: r.id }),
  }));

  const nextCursor = notes.length === opts.limit ? notes.at(-1)?.cursor ?? null : null;
  return { notes, nextCursor };
}

export async function createCustomerNote(
  customerId: string,
  noteText: string,
  staff: StaffContext,
  opts: { isImportant?: boolean; sourceApp?: CustomerActivitySourceApp }
) {
  const trimmed = noteText.trim();
  if (!trimmed) throw new HttpError(400, 'note is required');

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(customerNotes)
      .values({
        customerId,
        createdByStaffId: staff.staffId,
        createdByStaffName: staff.staffName,
        sourceApp: opts.sourceApp ?? 'EMPLOYEE_REGISTER',
        note: trimmed,
        isImportant: opts.isImportant ?? false,
      })
      .returning({ id: customerNotes.id, createdAt: customerNotes.createdAt });
    const row = inserted[0];

    const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
    await insertCustomerActivityEventDrizzle(tx, {
      customerId,
      actionType: 'NOTE_ADDED',
      actionCategory: 'NOTE',
      sourceApp: opts.sourceApp ?? 'EMPLOYEE_REGISTER',
      actorType: 'STAFF',
      actorStaffId: staff.staffId,
      actorStaffName: staff.staffName,
      summary: `Note added: ${preview}`,
      metadata: { noteId: row.id, isImportant: opts.isImportant ?? false },
      dedupeKey: null,
    });

    return {
      id: row.id,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  });
}

export async function getCustomerProfile(customerId: string) {
  const normalizedId = customerId?.trim();
  if (!normalizedId) return null;

  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId);

  let customerResult;
  if (looksLikeUuid) {
    customerResult = await db
      .select({
        id: customers.id,
        name: customers.name,
        dob: customers.dob,
        membershipNumber: customers.membershipNumber,
        membershipValidUntil: customers.membershipValidUntil,
        idNumber: customers.idNumber,
        idType: customers.idType,
        idTypeOther: customers.idTypeOther,
        idExpirationDate: customers.idExpirationDate,
        primaryLanguage: customers.primaryLanguage,
        idScanHash: customers.idScanHash,
        pastDueBalance: customers.pastDueBalance,
      })
      .from(customers)
      .where(eq(customers.id, normalizedId))
      .limit(1);
  } else {
    customerResult = await db
      .select({
        id: customers.id,
        name: customers.name,
        dob: customers.dob,
        membershipNumber: customers.membershipNumber,
        membershipValidUntil: customers.membershipValidUntil,
        idNumber: customers.idNumber,
        idType: customers.idType,
        idTypeOther: customers.idTypeOther,
        idExpirationDate: customers.idExpirationDate,
        primaryLanguage: customers.primaryLanguage,
        idScanHash: customers.idScanHash,
        pastDueBalance: customers.pastDueBalance,
      })
      .from(customers)
      .where(eq(customers.membershipNumber, normalizedId))
      .limit(1);
  }

  if (customerResult.length === 0) return null;
  const [row] = customerResult;
  if (!row) return null;

  const { firstName, lastName } = splitFullName(row.name);
  const idType = row.idType && isIdType(row.idType) ? row.idType : null;

  let lastVisitAt: string | null = null;
  try {
    const lastVisitResult = await db
      .select({ startsAt: checkinBlocks.startsAt })
      .from(checkinBlocks)
      .innerJoin(visits, eq(visits.id, checkinBlocks.visitId))
      .where(eq(visits.customerId, row.id))
      .orderBy(desc(checkinBlocks.startsAt))
      .limit(1);

    if (lastVisitResult.length > 0) {
      const [lastVisit] = lastVisitResult;
      lastVisitAt = lastVisit ? toIsoTimestamp(lastVisit.startsAt) : null;
    }
  } catch (err) {
    console.error('[getCustomerProfile] lastVisit query failed:', err);
  }

  const pastDueBalance =
    typeof row.pastDueBalance === 'string'
      ? Number.parseInt(row.pastDueBalance, 10) || 0
      : row.pastDueBalance ?? 0;

  return {
    id: row.id,
    name: row.name,
    firstName,
    lastName,
    dob: toDateOnlyString(row.dob),
    dobMonthDay: toDobMonthDay(row.dob),
    membershipNumber: row.membershipNumber,
    membershipValidUntil: toDateOnlyString(row.membershipValidUntil),
    idNumber: row.idNumber,
    idType,
    idTypeOther: row.idTypeOther,
    idExpirationDate: toDateOnlyString(row.idExpirationDate),
    primaryLanguage:
      row.primaryLanguage === 'EN' || row.primaryLanguage === 'ES' ? row.primaryLanguage : null,
    lastVisitAt,
    pastDueBalance,
    hasEncryptedLookupMarker: Boolean(row.idScanHash),
  };
}

async function updateExistingCustomerFromScan(
  row: { id: string; idScanHash: string | null; idScanValue: string | null },
  idScanHash: string,
  idScanValue: string,
  idExpirationDate: string | null,
  input: CreateFromScanInput,
  idType: string | null,
  idTypeOther: string | null
) {
  const needsScanUpdate =
    !row.idScanHash ||
    !row.idScanValue ||
    row.idScanHash !== idScanHash ||
    row.idScanValue !== idScanValue;

  let updateIdExpirationDate: any;
  if (!row.idScanHash && idExpirationDate) {
    updateIdExpirationDate = sql`${idExpirationDate}::date`;
  } else if (row.idScanHash) {
    updateIdExpirationDate = undefined;
  } else {
    updateIdExpirationDate = null;
  }

  if (needsScanUpdate || input.idNumber || input.state || idType || idTypeOther) {
    await db
      .update(customers)
      .set({
        idScanHash:
          !row.idScanHash || row.idScanHash !== idScanHash ? idScanHash : row.idScanHash,
        idScanValue:
          !row.idScanValue || row.idScanValue !== idScanValue ? idScanValue : row.idScanValue,
        idExpirationDate: updateIdExpirationDate,
        idNumber: input.idNumber ?? undefined,
        idState: input.state ?? undefined,
        idType: idType ?? undefined,
        idTypeOther: idTypeOther ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, row.id));
  } else if (idExpirationDate) {
    await db
      .update(customers)
      .set({
        idExpirationDate: sql`${idExpirationDate}::date`,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, row.id));
  }
}

async function mirrorToSquareAsync(localId: string, firstName: string, lastName: string, dob: string | null, referenceId: string | null) {
  try {
    const { createSquareCustomer } = await import('./squareSyncService');
    const squareId = await createSquareCustomer({ firstName, lastName, dob, referenceId });
    if (squareId) {
      await db.update(customers).set({ squareCustomerId: squareId, updatedAt: new Date() }).where(eq(customers.id, localId));
    }
  } catch (error) {
    console.error(`[mirrorToSquareAsync] Failed to mirror customer ${localId} to Square:`, error);
  }
}

export interface CreateFromScanInput {
  idScanValue?: string;
  idScanHash?: string;
  rawScanText?: string;
  firstName: string;
  lastName: string;
  dob: string;
  idExpirationDate?: string;
  idNumber?: string;
  state?: string;
  idType?: string;
  idTypeOther?: string;
  fullName?: string;
}

export async function createFromScan(input: CreateFromScanInput) {
  const idScanValue = normalizeScanText(input.idScanValue || input.rawScanText || '');
  if (!idScanValue) throw new HttpError(400, 'Invalid scan input');

  const idScanHash =
    computeIdScanIdentityHash({
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: input.fullName,
      dob: input.dob,
    }) || input.idScanHash || computeSha256Hex(idScanValue);

  const dob = toDateOnly(input.dob);
  if (!dob) throw new HttpError(400, 'Invalid dob; expected YYYY-MM-DD');
  const idExpirationDate = input.idExpirationDate ? toDateOnly(input.idExpirationDate) : null;
  if (input.idExpirationDate && !idExpirationDate) throw new HttpError(400, 'Invalid idExpirationDate; expected YYYY-MM-DD');

  const idType = input.idType ?? null;
  const idTypeOther = idType === 'OTHER' ? (input.idTypeOther?.trim() || null) : null;

  const idScanIssue = getIdScanIssue({ dob, idExpirationDate });
  if (idScanIssue) throw new HttpError(403, getIdScanIssueMessage(idScanIssue), { code: idScanIssue });

  const name = (input.fullName?.trim() || `${input.firstName} ${input.lastName}`.trim()).slice(0, 255);
  if (!name) throw new HttpError(400, 'Invalid name');

  const existing = await db
    .select({
      id: customers.id,
      name: customers.name,
      dob: customers.dob,
      membershipNumber: customers.membershipNumber,
      bannedUntil: customers.bannedUntil,
      idScanHash: customers.idScanHash,
      idScanValue: customers.idScanValue,
    })
    .from(customers)
    .where(
      or(eq(customers.idScanHash, idScanHash), eq(customers.idScanValue, idScanValue))
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.bannedUntil && row.bannedUntil > new Date()) throw new HttpError(403, 'Customer is banned');

    await updateExistingCustomerFromScan(
      { id: row.id, idScanHash: row.idScanHash, idScanValue: row.idScanValue },
      idScanHash,
      idScanValue,
      idExpirationDate,
      input,
      idType,
      idTypeOther
    );

    return {
      created: false,
      customer: {
        id: row.id,
        name: row.name,
        dob: extractDob(row.dob),
        membershipNumber: row.membershipNumber,
      },
    };
  }

  const inserted = await db
    .insert(customers)
    .values({
      name,
      dob,
      idExpirationDate,
      idNumber: input.idNumber ?? null,
      idState: input.state ?? null,
      idType,
      idTypeOther,
      idScanHash,
      idScanValue,
    })
    .returning({ id: customers.id, name: customers.name, dob: customers.dob, membershipNumber: customers.membershipNumber });

  const row = inserted[0];
  if (!row) throw new HttpError(500, 'Failed to insert customer');

  // Mirror asynchronously to Square
  void mirrorToSquareAsync(row.id, input.firstName, input.lastName, extractDob(row.dob), input.idNumber ?? null);

  return {
    created: true,
    customer: {
      id: row.id,
      name: row.name,
      dob: extractDob(row.dob),
      membershipNumber: row.membershipNumber,
    },
  };
}

export async function matchIdentity(input: {
  firstName: string;
  lastName: string;
  dob: string;
  idNumber?: string;
}) {
  const dob = toDateOnly(input.dob);
  if (!dob) throw new HttpError(400, 'Invalid dob; expected YYYY-MM-DD');

  const inputParts = splitNamePartsForMatch(`${input.firstName} ${input.lastName}`);
  if (!inputParts) throw new HttpError(400, 'Invalid name');

  if (input.idNumber?.trim()) {
    const byIdNumber = await db
      .select({
        id: customers.id,
        name: customers.name,
        dob: customers.dob,
        membershipNumber: customers.membershipNumber,
      })
      .from(customers)
      .where(eq(sql`UPPER(${customers.idNumber})`, input.idNumber.trim().toUpperCase()))
      .limit(1);

    if (byIdNumber.length > 0) {
      const [row] = byIdNumber;
      if (row) {
        return {
          matchCount: 1,
          matchReason: 'ID_NUMBER' as const,
          bestMatch: {
            id: row.id,
            name: row.name,
            dob: extractDob(row.dob),
            membershipNumber: row.membershipNumber,
          },
        };
      }
    }
  }

  const res = await db
    .select({
      id: customers.id,
      name: customers.name,
      dob: customers.dob,
      membershipNumber: customers.membershipNumber,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(eq(customers.dob, dob))
    .orderBy(asc(customers.createdAt))
    .limit(50);

  const matches = res
    .map((row) => {
      const parts = splitNamePartsForMatch(row.name);
      if (!parts) return null;
      const score =
        scoreNameSimilarity(inputParts, parts) + (row.membershipNumber ? 0.5 : 0);
      if (score < 1.5) return null;
      return {
        id: row.id,
        name: row.name,
        dob: extractDob(row.dob),
        membershipNumber: row.membershipNumber,
        score,
        createdAt: row.createdAt,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    dob: string | null;
    membershipNumber: string | null;
    score: number;
    createdAt: Date;
  }>;

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const best = matches[0] ?? null;
  return {
    matchCount: matches.length,
    bestMatch: best
      ? {
          id: best.id,
          name: best.name,
          dob: best.dob,
          membershipNumber: best.membershipNumber,
        }
      : null,
  };
}

export async function createManual(input: {
  firstName: string;
  lastName: string;
  dob: string;
  idExpirationDate: string;
  idType: string;
  idTypeOther?: string;
  idNumber?: string;
}) {
  const dob = toDateOnly(input.dob);
  if (!dob) throw new HttpError(400, 'Invalid dob; expected YYYY-MM-DD');
  const idExpirationDate = toDateOnly(input.idExpirationDate);
  if (!idExpirationDate) throw new HttpError(400, 'Invalid idExpirationDate; expected YYYY-MM-DD');

  const idType = input.idType;
  const idTypeOther = idType === 'OTHER' ? input.idTypeOther?.trim() || null : null;
  const name = `${input.firstName} ${input.lastName}`.trim().slice(0, 255);
  if (!name) throw new HttpError(400, 'Invalid name');
  const idScanValue = input.idNumber?.trim() || null;

  const idScanIssue = getIdScanIssue({ dob, idExpirationDate });
  if (idScanIssue) throw new HttpError(403, getIdScanIssueMessage(idScanIssue), { code: idScanIssue });

  if (idScanValue) {
    const byIdNumber = await db
      .select({
        id: customers.id,
        name: customers.name,
        dob: customers.dob,
        membershipNumber: customers.membershipNumber,
      })
      .from(customers)
      .where(eq(sql`UPPER(${customers.idNumber})`, idScanValue.toUpperCase()))
      .limit(1);

    if (byIdNumber.length > 0) {
      const [row] = byIdNumber;
      if (row) {
        return {
          created: false,
          existing: true,
          matchReason: 'ID_NUMBER' as const,
          customer: {
            id: row.id,
            name: row.name,
            dob: extractDob(row.dob),
            membershipNumber: row.membershipNumber,
          },
        };
      }
    }
  }

  const byNameDob = await db
    .select({
      id: customers.id,
      name: customers.name,
      dob: customers.dob,
      membershipNumber: customers.membershipNumber,
    })
    .from(customers)
    .where(and(eq(customers.dob, dob), eq(sql`LOWER(${customers.name})`, name.toLowerCase())))
    .limit(1);

  if (byNameDob.length > 0) {
    const [row] = byNameDob;
    if (row) {
      return {
        created: false,
        existing: true,
        matchReason: 'NAME_DOB' as const,
        customer: {
          id: row.id,
          name: row.name,
          dob: extractDob(row.dob),
          membershipNumber: row.membershipNumber,
        },
      };
    }
  }

  const inserted = await db
    .insert(customers)
    .values({
      name,
      dob,
      idExpirationDate,
      idType,
      idTypeOther,
      idScanValue,
      idNumber: idScanValue,
    })
    .returning({ id: customers.id, name: customers.name, dob: customers.dob, membershipNumber: customers.membershipNumber });

  const row = inserted[0];
  if (!row) throw new HttpError(500, 'Failed to create customer');

  // Mirror asynchronously to Square
  void mirrorToSquareAsync(row.id, input.firstName, input.lastName, extractDob(row.dob), idScanValue);

  return {
    created: true,
    customer: {
      id: row.id,
      name: row.name,
      dob: extractDob(row.dob),
      membershipNumber: row.membershipNumber,
    },
  };
}
