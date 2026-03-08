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
import { transaction } from '../../db';

// ── Types ──

type Queryable = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

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
  client: Queryable,
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
    client: client as any,
    customerId: matched.id,
    existingIdScanHash: matched.id_scan_hash,
    existingIdScanValue: matched.id_scan_value,
    idScanHash,
    idScanValue,
  });

  await enrichCustomerIdentity(client, matched.id, {
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

  return transaction(async (client) => {
    if (isAamva) {
      return processAamvaScan(client, normalized, input.selectedCustomerId);
    }
    return processNonIdScan(client, normalized);
  });
}

// ── AAMVA (State ID) Processing ──

async function processAamvaScan(
  client: Queryable,
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
      client, selectedCustomerId, extracted, idScanHash, idScanValue, idScanIssue
    );
  }

  // ── 1) Match by id_scan_hash or id_scan_value ──
  const byHashOrValue = await client.query<CustomerIdentityRow>(
    `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id_scan_hash = $1 OR id_scan_value = $2
     LIMIT 2`,
    [idScanHash, idScanValue]
  );

  if (byHashOrValue.rows.length > 0) {
    const matched =
      byHashOrValue.rows.find((r) => r.id_scan_hash === idScanHash) ??
      byHashOrValue.rows[0]!;

    checkBanned(matched);
    await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);

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
    const byIdNumber = await client.query<CustomerIdentityRow>(
      `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE id_scan_value = $1 OR id_scan_hash = $2
       LIMIT 2`,
      [scannedIdNumber, idNumberHash]
    );

    if (byIdNumber.rows.length > 0) {
      const matched = idNumberHash
        ? (byIdNumber.rows.find((r) => r.id_scan_hash === idNumberHash) ??
          byIdNumber.rows[0]!)
        : byIdNumber.rows[0]!;

      checkBanned(matched);
      await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);

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
      const byNameDob = await client.query<CustomerIdentityRow>(
        `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE dob = $1::date
           AND lower(split_part(name, ' ', 1)) = lower($2)
           AND lower(regexp_replace(name, '^.*\\s', '')) = lower($3)
         LIMIT 2`,
        [dobStr, extracted.firstName, extracted.lastName]
      );

      if (byNameDob.rows.length > 0) {
        const matched = byNameDob.rows[0]!;
        checkBanned(matched);
        await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);

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
        client, dobStr, extracted, scannedIdNumberNormalized, idNumberHash,
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
  client: Queryable,
  selectedCustomerId: string,
  extracted: ReturnType<typeof extractAamvaIdentity>,
  idScanHash: string,
  idScanValue: string,
  idScanIssue: IdScanIssue | undefined,
): Promise<ScanResult> {
  const selected = await client.query<CustomerIdentityRow>(
    `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE id = $1
     LIMIT 1`,
    [selectedCustomerId]
  );

  if (selected.rows.length === 0) {
    return {
      result: 'ERROR',
      error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
    };
  }
  const chosen = selected.rows[0]!;

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
    client: client as any,
    customerId: chosen.id,
    existingIdScanHash: chosen.id_scan_hash,
    existingIdScanValue: chosen.id_scan_value,
    idScanHash,
    idScanValue,
  });

  // Employee-resolution uses a more targeted enrichment (preserves existing DOB)
  const identityUpdates: string[] = [];
  const identityValues: Array<string | null> = [];
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
    await client.query(
      `UPDATE customers
       SET ${identityUpdates.join(', ')},
           updated_at = NOW()
       WHERE id = $${identityValues.length}`,
      identityValues
    );
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
  client: Queryable,
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

  const candidatesByDob = await client.query<CustomerIdentityCandidateRow>(
    `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value, created_at
     FROM customers
     WHERE dob = $1::date
     LIMIT 200`,
    [dobStr]
  );

  const scored = candidatesByDob.rows
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
    await attachAndEnrich(client, matched, idScanHash, idScanValue, extracted);

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
  client: Queryable,
  normalized: string
): Promise<ScanResult> {
  // Try membership number
  const membershipCandidate = parseMembershipNumber(normalized) || normalized;

  const byMembership = await client.query<CustomerIdentityRow>(
    `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
     FROM customers
     WHERE membership_number = $1
     LIMIT 1`,
    [membershipCandidate]
  );

  if (byMembership.rows.length > 0) {
    const matched = byMembership.rows[0]!;
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
    const byPassport = await client.query<CustomerIdentityRow>(
      `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
       FROM customers
       WHERE UPPER(id_number) = UPPER($1)
       LIMIT 1`,
      [trimmedInput]
    );

    if (byPassport.rows.length > 0) {
      const matched = byPassport.rows[0]!;
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
