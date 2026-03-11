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
import {
  computeIdScanIdentityHash,
  computeSha256Hex,
  extractAamvaIdentity,
  getIdScanIssue,
  getIdScanIssueMessage,
  isLikelyAamvaPdf417Text,
  normalizeScanText,
  parseMembershipNumber,
  passesFuzzyThresholds,
  scoreNameMatch,
  splitNamePartsForMatch,
  type IdScanIssue,
} from '../../checkin/identity';
import { maybeAttachScanIdentifiers } from '../../checkin/helpers';
import { toDate } from '../../checkin/utils';
import { enrichCustomerIdentity } from '../../domain/customerEnrichment';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { type DrizzleTx } from '../../db';



/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable/PoolClient interface
 * expected by external helpers (maybeAttachScanIdentifiers, enrichCustomerIdentity).
 */
function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await (tx as any).execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

// ── Types ──

interface CustomerIdentityRow {
  id: string;
  name: string;
  dob: Date | null;
  id_expiration_date: Date | null;
  membership_number: string | null;
  banned_until: Date | null;
  id_scan_hash: string | null;
  id_scan_value: string | null;
}

type CustomerIdentityCandidateRow = CustomerIdentityRow & { created_at: Date };

/** Result envelope — preserves the exact HTTP contract. */
export type ScanResult =
  | ScanResultMatched
  | ScanResultNoMatch
  | ScanResultCandidates
  | ScanResultError;

interface ScanResultMatched {
  result: 'MATCHED';
  scanType: 'STATE_ID' | 'MEMBERSHIP' | 'PASSPORT';
  normalizedRawScanText: string;
  idScanHash?: string;
  membershipNumber?: string | null;
  customer: {
    id: string;
    name: string;
    dob: string | null;
    membershipNumber: string | null;
  };
  extracted?: Record<string, unknown>;
  enriched?: boolean;
}

interface ScanResultNoMatch {
  result: 'NO_MATCH';
  scanType: 'STATE_ID' | 'MEMBERSHIP' | 'PASSPORT';
  normalizedRawScanText: string;
  idScanHash?: string;
  extracted?: Record<string, unknown>;
  membershipCandidate?: string;
  passportNumber?: string;
}

interface ScanResultCandidates {
  result: 'CANDIDATES';
  scanType: 'STATE_ID';
  normalizedRawScanText: string;
  idScanHash: string;
  extracted: Record<string, unknown>;
  candidates: Array<{
    id: string;
    name: string;
    dob: string | null;
    membershipNumber: string | null;
    matchScore: number;
  }>;
}

interface ScanResultError {
  result: 'ERROR';
  scanType?: 'STATE_ID';
  normalizedRawScanText?: string;
  idScanHash?: string;
  extracted?: Record<string, unknown>;
  error: { code: string; message: string };
}

export interface ProcessCheckinScanInput {
  rawScanText: string;
  selectedCustomerId?: string;
}

// ── Helpers ──

function normalizeIdNumberForMatch(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replaceAll(/[^a-z0-9]/gi, '').toUpperCase();
  return normalized || null;
}

function extractStoredIdNumberForMatch(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isLikelyAamvaPdf417Text(trimmed)) {
    const extracted = extractAamvaIdentity(normalizeScanText(trimmed));
    return extracted.idNumber ?? null;
  }
  return trimmed;
}

import { HttpError } from '../../errors/HttpError';

function checkBanned(row: CustomerIdentityRow): void {
  const bannedUntil = toDate(row.banned_until);
  if (bannedUntil && bannedUntil > new Date()) {
    throw new HttpError(403, `Customer is banned until ${bannedUntil.toISOString()}`, { code: 'BANNED' });
  }
}

function formatCustomer(row: CustomerIdentityRow) {
  return {
    id: row.id,
    name: row.name,
    dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
    membershipNumber: row.membership_number,
  };
}

/** Attach scan identifiers + enrich identity fields in a single call. */
async function attachAndEnrich(
  tx: DrizzleTx,
  matched: CustomerIdentityRow,
  idScanHash: string,
  idScanValue: string,
  extracted: {
    idExpirationDate?: string | null;
    idNumber?: string | null;
    jurisdiction?: string | null;
    issuer?: string | null;
    idType?: string | null;
    idTypeOther?: string | null;
  }
): Promise<void> {
  await maybeAttachScanIdentifiers({
    client: toQueryable(tx) as any,
    customerId: matched.id,
    existingIdScanHash: matched.id_scan_hash,
    existingIdScanValue: matched.id_scan_value,
    idScanHash,
    idScanValue,
  });

  await enrichCustomerIdentity(toQueryable(tx), matched.id, {
    idExpirationDate: extracted.idExpirationDate,
    idNumber: extracted.idNumber,
    idState: extracted.jurisdiction || extracted.issuer || null,
    idType: extracted.idType,
    idTypeOther: extracted.idTypeOther,
  });
}

function makeIdScanIssueError(
  idScanIssue: IdScanIssue,
  extras: Partial<ScanResultError> = {}
): ScanResultError {
  return {
    result: 'ERROR',
    error: {
      code: idScanIssue,
      message: getIdScanIssueMessage(idScanIssue),
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
export async function processCheckinScan(
  input: ProcessCheckinScanInput
): Promise<ScanResult> {
  const normalized = normalizeScanText(input.rawScanText);
  if (!normalized) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SCAN', message: 'Empty scan input' },
    };
  }

  const isAamva = isLikelyAamvaPdf417Text(normalized);
  if (input.selectedCustomerId && !isAamva) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
    };
  }

  return db.transaction(async (tx) => {
    if (isAamva) {
      return processAamvaScan(tx, normalized, input.selectedCustomerId);
    }
    return processNonIdScan(tx, normalized);
  });
}

// ── AAMVA (State ID) Processing ──

async function processAamvaScan(
  tx: DrizzleTx,
  normalized: string,
  selectedCustomerId?: string
): Promise<ScanResult> {
  const extracted = extractAamvaIdentity(normalized);
  const idScanIssue = getIdScanIssue({
    dob: extracted.dob,
    idExpirationDate: extracted.idExpirationDate,
  });
  const idScanValue = normalized;
  const idScanHash =
    computeIdScanIdentityHash({
      firstName: extracted.firstName,
      lastName: extracted.lastName,
      fullName: extracted.fullName,
      dob: extracted.dob,
    }) ?? computeSha256Hex(idScanValue);
  const scannedIdNumber = extracted.idNumber?.trim() || null;
  const scannedIdNumberNormalized = normalizeIdNumberForMatch(scannedIdNumber);
  const issuerForHash = (extracted.issuer || extracted.jurisdiction || '').trim();
  const idNumberHash =
    scannedIdNumber && issuerForHash
      ? computeSha256Hex(`${issuerForHash}:${scannedIdNumber}`)
      : null;

  // ── 0) Employee-choice resolution ──
  if (selectedCustomerId) {
    return resolveSelectedCustomer(
      tx, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue
    );
  }

  // ── 1) Match by id_scan_hash or id_scan_value ──
  const byHashOrValue = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id_scan_hash = ${idScanHash} OR id_scan_value = ${idScanValue}
     LIMIT 2`
  );
  const hashRows = byHashOrValue.rows as unknown as CustomerIdentityRow[];

  if (hashRows.length > 0) {
    const matched =
      hashRows.find((r) => r.id_scan_hash === idScanHash) ??
      hashRows[0]!;

    checkBanned(matched);
    await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);

    if (idScanIssue) return makeIdScanIssueError(idScanIssue);

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
    const byIdNumber = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE id_scan_value = ${scannedIdNumber} OR id_scan_hash = ${idNumberHash}
       LIMIT 2`
    );
    const idRows = byIdNumber.rows as unknown as CustomerIdentityRow[];

    if (idRows.length > 0) {
      const matched = idNumberHash
        ? (idRows.find((r) => r.id_scan_hash === idNumberHash) ??
          idRows[0]!)
        : idRows[0]!;

      checkBanned(matched);
      await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);

      if (idScanIssue) return makeIdScanIssueError(idScanIssue);

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
      const byNameDob = await tx.execute<Record<string, unknown>>(
        sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE dob = ${dobStr}::date
           AND lower(split_part(name, ' ', 1)) = lower(${extracted.firstName})
           AND lower(regexp_replace(name, ${sql.raw("'^.*\\\\s'")} , '')) = lower(${extracted.lastName})
         LIMIT 2`
      );
      const nameRows = byNameDob.rows as unknown as CustomerIdentityRow[];

      if (nameRows.length > 0) {
        const matched = nameRows[0]!;
        checkBanned(matched);
        await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);

        if (idScanIssue) return makeIdScanIssueError(idScanIssue);

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
      const fuzzyResult = await fuzzyMatchByDob(
        tx, dobStr, extracted, scannedIdNumberNormalized, idNumberHash,
        idScanHash, idScanValue, idScanIssue
      );
      if (fuzzyResult) return fuzzyResult;
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

async function resolveSelectedCustomer(
  tx: DrizzleTx,
  selectedCustomerId: string,
  extracted: ReturnType<typeof extractAamvaIdentity>,
  idScanHash: string,
  idScanValue: string,
  idScanIssue: IdScanIssue | undefined,
): Promise<ScanResult> {
  const selected = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id = ${selectedCustomerId}
     LIMIT 1`
  );

  if (selected.rows.length === 0) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
    };
  }
  const chosen = selected.rows[0] as unknown as CustomerIdentityRow;

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
  const scannedParts = splitNamePartsForMatch(
    `${extracted.firstName} ${extracted.lastName}`.trim()
  );
  const storedParts = splitNamePartsForMatch(chosen.name);
  if (!scannedParts || !storedParts) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
    };
  }

  const fuzzy = scoreNameMatch({
    scannedFirst: scannedParts.firstToken,
    scannedLast: scannedParts.lastToken,
    storedFirst: storedParts.firstToken,
    storedLast: storedParts.lastToken,
  });
  if (!passesFuzzyThresholds(fuzzy)) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
    };
  }

  checkBanned(chosen);

  // Attach scan identifiers
  await maybeAttachScanIdentifiers({
    client: toQueryable(tx) as any,
    customerId: chosen.id,
    existingIdScanHash: chosen.id_scan_hash,
    existingIdScanValue: chosen.id_scan_value,
    idScanHash,
    idScanValue,
  });

  // Employee-resolution uses a more targeted enrichment (preserves existing DOB)
  // Dynamic SQL: build SET clause conditionally
  const setClauses: string[] = [];
  const values: unknown[] = [];
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

  if (idScanIssue) return makeIdScanIssueError(idScanIssue);

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

async function fuzzyMatchByDob(
  tx: DrizzleTx,
  dobStr: string,
  extracted: ReturnType<typeof extractAamvaIdentity>,
  scannedIdNumberNormalized: string | null,
  idNumberHash: string | null,
  idScanHash: string,
  idScanValue: string,
  idScanIssue: IdScanIssue | undefined,
): Promise<ScanResult | null> {
  const scannedParts = splitNamePartsForMatch(
    `${extracted.firstName} ${extracted.lastName}`.trim()
  );
  if (!scannedParts) return null;

  const candidatesByDob = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value, created_at
     FROM customers
     WHERE dob = ${dobStr}::date
     LIMIT 200`
  );
  const candidateRows = candidatesByDob.rows as unknown as CustomerIdentityCandidateRow[];

  const scored = candidateRows
    .map((row) => {
      const storedParts = splitNamePartsForMatch(row.name);
      if (!storedParts) return null;
      const s = scoreNameMatch({
        scannedFirst: scannedParts.firstToken,
        scannedLast: scannedParts.lastToken,
        storedFirst: storedParts.firstToken,
        storedLast: storedParts.lastToken,
      });
      const storedIdNumber = scannedIdNumberNormalized
        ? extractStoredIdNumberForMatch(row.id_scan_value)
        : null;
      const storedIdNumberNormalized = normalizeIdNumberForMatch(storedIdNumber);
      const idMatch =
        Boolean(
          scannedIdNumberNormalized &&
          storedIdNumberNormalized &&
          storedIdNumberNormalized === scannedIdNumberNormalized
        ) || Boolean(idNumberHash && row.id_scan_hash === idNumberHash);
      if (!idMatch && !passesFuzzyThresholds(s)) return null;
      const matchScore = s.score + (idMatch ? 1 : 0);
      return { row, score: s, idMatch, matchScore };
    })
    .filter(
      (
        x
      ): x is {
        row: CustomerIdentityCandidateRow;
        score: { score: number; firstMax: number; lastMax: number };
        idMatch: boolean;
        matchScore: number;
      } => Boolean(x)
    )
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        a.row.created_at.getTime() - b.row.created_at.getTime()
    );

  if (scored.length === 1) {
    const matched = scored[0]!.row;
    checkBanned(matched);
    await attachAndEnrich(tx, matched, idScanHash, idScanValue, extracted);

    if (idScanIssue) return makeIdScanIssueError(idScanIssue);

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

async function processNonIdScan(
  tx: DrizzleTx,
  normalized: string
): Promise<ScanResult> {
  // Try membership number
  const membershipCandidate = parseMembershipNumber(normalized) || normalized;

  const byMembership = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE membership_number = ${membershipCandidate}
     LIMIT 1`
  );
  const membershipRows = byMembership.rows as unknown as CustomerIdentityRow[];

  if (membershipRows.length > 0) {
    const matched = membershipRows[0]!;
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
  const isLikelyPassport =
    /^[A-Z0-9]{5,20}$/i.test(trimmedInput) && !/^\d{11,}$/.test(trimmedInput);

  if (isLikelyPassport) {
    const byPassport = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE UPPER(id_number) = UPPER(${trimmedInput})
       LIMIT 1`
    );
    const passportRows = byPassport.rows as unknown as CustomerIdentityRow[];

    if (passportRows.length > 0) {
      const matched = passportRows[0]!;
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
