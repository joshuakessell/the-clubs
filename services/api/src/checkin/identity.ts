import crypto from 'crypto';
import { Parse as ParseAamva } from 'aamva-parser';

export type ExtractedIdIdentity = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  dob?: string; // YYYY-MM-DD
  idExpirationDate?: string; // YYYY-MM-DD
  idNumber?: string;
  issuer?: string;
  jurisdiction?: string;
  idType?: 'STATE_ID' | 'DRIVERS_LICENSE' | 'PASSPORT' | 'OTHER';
  idTypeOther?: string;
};

type NormalizedNameParts = {
  normalizedFull: string;
  firstToken: string;
  lastToken: string;
};

function toDate(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function computeSha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function computeIdScanIdentityHash(params: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  dob?: Date | string | null;
}): string | null {
  const dobDate = toDateOnly(params.dob);
  if (!dobDate) return null;
  const dobIso = dobDate.toISOString().slice(0, 10);
  const nameFromParts = `${params.firstName ?? ''} ${params.lastName ?? ''}`.trim();
  const name = (nameFromParts || params.fullName || '').trim();
  if (!name) return null;
  const normalized = normalizePersonNameForMatch(name);
  if (!normalized) return null;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 2) return null;
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return computeSha256Hex(`${first}|${last}|${dobIso}`);
}

export function normalizeScanText(raw: string): string {
  // Normalize line endings and whitespace while preserving line breaks.
  // Honeywell scanners often emit already-decoded PDF417 text that may include \r\n or \r.
  const lf = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = lf.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  return lines.join('\n').trim();
}

export function isLikelyAamvaPdf417Text(raw: string): boolean {
  // Heuristic detection for AAMVA DL/ID text payloads.
  const s = raw;
  return (
    s.startsWith('@') ||
    s.includes('ANSI ') ||
    s.includes('AAMVA') ||
    /\nDCS/.test(s) ||
    /\nDAC/.test(s) ||
    /\nDBD/.test(s) ||
    /\nDAQ/.test(s)
  );
}

const AAMVA_CODES = new Set([
  // core identity fields
  'DCS',
  'DAC',
  'DAD',
  'DAA',
  'DBB',
  'DBD',
  'DAQ',
  'DAJ',
  'DCI',
  // common truncation/flags that often appear between name fields
  'DDE',
  'DDF',
  'DDG',
  // other common fields that can appear and must be treated as boundaries
  'DBA',
  'DBC',
  'DCA',
  'DCB',
  'DCD',
  'DCF',
  'DCG',
  'DCK',
  'DCL',
  'DDA',
  'DDB',
  'DDC',
  'DDD',
  'DAG',
  'DAI',
  'DAK',
  'DAR',
  'DAS',
  'DAT',
  'DAU',
]);

function extractAamvaFieldMap(raw: string): Record<string, string> {
  // Scan raw (already normalized) for occurrences of known AAMVA 3-letter codes.
  // Record positions and slice values between consecutive codes.
  // Trim whitespace/newlines from values.
  // If a code appears multiple times, keep the first non-empty value (or prefer the longest non-empty).
  const s = raw;
  const hits: Array<{ code: string; idx: number }> = [];

  for (let i = 0; i <= s.length - 3; i++) {
    const code = s.slice(i, i + 3);
    if (AAMVA_CODES.has(code)) {
      hits.push({ code, idx: i });
    }
  }

  hits.sort((a, b) => a.idx - b.idx);

  const out: Record<string, string> = {};
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const nextIdx = hits[i + 1]?.idx ?? s.length;
    const rawValue = s.slice(cur.idx + 3, nextIdx);
    const value = rawValue.replace(/\s+/g, ' ').trim();
    if (!value) continue;

    const existing = out[cur.code];
    if (!existing) {
      out[cur.code] = value;
      continue;
    }
    // Prefer longest non-empty (helps when a code repeats with a fuller value).
    if (value.length > existing.length) out[cur.code] = value;
  }

  return out;
}

function inferAamvaIdType(fieldMap: Record<string, string>): 'STATE_ID' | 'DRIVERS_LICENSE' {
  const normalize = (value: string | undefined) => (value || '').trim().toUpperCase();
  const classValue = normalize(fieldMap['DCA']);
  const restrictions = normalize(fieldMap['DCB']);
  const endorsements = normalize(fieldMap['DCD']);
  const licenseSignals = [classValue, restrictions, endorsements].filter(Boolean);
  const hasLicenseSignal = licenseSignals.some(
    (value) => !['NONE', 'N/A', 'NA', 'ID', 'IDENTIFICATION'].includes(value)
  );
  return hasLicenseSignal ? 'DRIVERS_LICENSE' : 'STATE_ID';
}

function parseAamvaDateToISO(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) return undefined;

  const tryYyyyMmDd = () => {
    const yyyy = Number(digits.slice(0, 4));
    const mm = Number(digits.slice(4, 6));
    const dd = Number(digits.slice(6, 8));
    if (yyyy < 1900 || yyyy > 2100) return undefined;
    if (mm < 1 || mm > 12) return undefined;
    if (dd < 1 || dd > 31) return undefined;
    return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  const tryMmDdYyyy = () => {
    const mm = Number(digits.slice(0, 2));
    const dd = Number(digits.slice(2, 4));
    const yyyy = Number(digits.slice(4, 8));
    if (yyyy < 1900 || yyyy > 2100) return undefined;
    if (mm < 1 || mm > 12) return undefined;
    if (dd < 1 || dd > 31) return undefined;
    return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  // First try YYYYMMDD if year looks plausible, otherwise MMDDYYYY.
  const yyyy = Number(digits.slice(0, 4));
  if (yyyy >= 1900 && yyyy <= 2100) {
    return tryYyyyMmDd() ?? tryMmDdYyyy();
  }
  return tryMmDdYyyy() ?? tryYyyyMmDd();
}

function isCleanParsedAamvaValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  if (s.length > 64) return false;
  // Guard against concatenated AAMVA codes leaking into parsed strings.
  if (/(?:^|[^A-Z])D[A-Z]{2}(?:[^A-Z]|$)/.test(s)) return false;
  if (/\b(DAQ|DBB|DBD|DCS|DAC|DAA|DAJ|DCI)\b/.test(s)) return false;
  return true;
}

export function extractAamvaIdentity(rawNormalized: string): ExtractedIdIdentity {
  const fieldMap = extractAamvaFieldMap(rawNormalized);
  const fromMap: ExtractedIdIdentity = {
    lastName: fieldMap['DCS'] || undefined,
    firstName: fieldMap['DAC'] || undefined,
    fullName: fieldMap['DAA'] || undefined,
    dob: parseAamvaDateToISO(fieldMap['DBB']) || parseAamvaDateToISO(fieldMap['DBD']) || undefined,
    idExpirationDate: parseAamvaDateToISO(fieldMap['DBA']) || undefined,
    idNumber: fieldMap['DAQ'] || undefined,
    jurisdiction: fieldMap['DAJ'] || fieldMap['DCI'] || undefined,
    issuer: fieldMap['DAJ'] || fieldMap['DCI'] || undefined,
    idType: inferAamvaIdType(fieldMap),
  };

  if (!fromMap.fullName && fromMap.firstName && fromMap.lastName) {
    fromMap.fullName = `${fromMap.firstName} ${fromMap.lastName}`.trim();
  }

  try {
    const parsed = ParseAamva(rawNormalized) as unknown as {
      firstName?: string | null;
      lastName?: string | null;
      dateOfBirth?: Date | string | null;
      driversLicenseId?: string | null;
      state?: string | null;
      pdf417?: string | null;
    };

    // Only trust parsed values if they look clean AND we are missing that field from fieldMap.
    const parsedDob =
      parsed?.dateOfBirth instanceof Date
        ? parsed.dateOfBirth.toISOString().slice(0, 10)
        : typeof parsed?.dateOfBirth === 'string'
          ? parseAamvaDateToISO(parsed.dateOfBirth)
          : undefined;

    const out: ExtractedIdIdentity = { ...fromMap };
    if (!out.firstName && isCleanParsedAamvaValue(parsed?.firstName))
      out.firstName = parsed.firstName!.trim();
    if (!out.lastName && isCleanParsedAamvaValue(parsed?.lastName))
      out.lastName = parsed.lastName!.trim();
    if (!out.idNumber && isCleanParsedAamvaValue(parsed?.driversLicenseId))
      out.idNumber = parsed.driversLicenseId!.trim();
    if (!out.jurisdiction && isCleanParsedAamvaValue(parsed?.state))
      out.jurisdiction = parsed.state!.trim();
    if (!out.issuer && isCleanParsedAamvaValue(parsed?.state)) out.issuer = parsed.state!.trim();
    if (!out.dob && parsedDob) out.dob = parsedDob;
    if (!out.fullName && out.firstName && out.lastName)
      out.fullName = `${out.firstName} ${out.lastName}`.trim();
    return out;
  } catch {
    return fromMap;
  }
}

export function normalizePersonNameForMatch(input: string): string {
  // Rules:
  // - lower-case
  // - trim
  // - remove punctuation (keep letters, numbers, spaces)
  // - collapse whitespace
  // - remove common suffix tokens at end: jr, sr, ii, iii, iv
  const lowered = input.toLowerCase().trim();
  const noPunct = lowered.replace(/[^a-z0-9 ]+/g, ' ');
  const collapsed = noPunct.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const tokens = collapsed.split(' ').filter(Boolean);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

export function splitNamePartsForMatch(input: string): NormalizedNameParts | null {
  const normalizedFull = normalizePersonNameForMatch(input);
  if (!normalizedFull) return null;
  const tokens = normalizedFull.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const firstToken = tokens[0]!;
  const lastToken = tokens[tokens.length - 1]!;
  return { normalizedFull, firstToken, lastToken };
}

function jaroWinklerSimilarity(aRaw: string, bRaw: string): number {
  // Deterministic lightweight string similarity. Returns 0..1.
  const a = aRaw;
  const b = bRaw;
  if (a === b) return a.length === 0 ? 0 : 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (k < bLen && !bMatches[k]) k++;
    if (k < bLen && a[i] !== b[k]) t++;
    k++;
  }
  const transpositions = t / 2;

  const jaro = (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3;

  // Winkler adjustment
  const prefixMax = 4;
  let prefix = 0;
  for (let i = 0; i < Math.min(prefixMax, aLen, bLen); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  const p = 0.1;
  const jw = jaro + prefix * p * (1 - jaro);
  return Math.max(0, Math.min(1, jw));
}

const FUZZY_MIN_OVERALL = 0.88;
const FUZZY_MIN_LAST = 0.9;
const FUZZY_MIN_FIRST = 0.85;

export function scoreNameMatch(params: {
  scannedFirst: string;
  scannedLast: string;
  storedFirst: string;
  storedLast: string;
}): {
  score: number;
  firstMax: number;
  lastMax: number;
} {
  const firstDirect = jaroWinklerSimilarity(params.scannedFirst, params.storedFirst);
  const lastDirect = jaroWinklerSimilarity(params.scannedLast, params.storedLast);
  const direct = (firstDirect + lastDirect) / 2;

  const firstSwapped = jaroWinklerSimilarity(params.scannedFirst, params.storedLast);
  const lastSwapped = jaroWinklerSimilarity(params.scannedLast, params.storedFirst);
  const swapped = (firstSwapped + lastSwapped) / 2;

  const score = Math.max(direct, swapped);
  const firstMax = Math.max(firstDirect, firstSwapped);
  const lastMax = Math.max(lastDirect, lastSwapped);
  return { score, firstMax, lastMax };
}

export function passesFuzzyThresholds(score: {
  score: number;
  firstMax: number;
  lastMax: number;
}): boolean {
  return (
    score.score >= FUZZY_MIN_OVERALL &&
    score.lastMax >= FUZZY_MIN_LAST &&
    score.firstMax >= FUZZY_MIN_FIRST
  );
}

export function calculateAge(
  dob: Date | string | null,
  now: Date = new Date()
): number | undefined {
  const d = toDate(dob);
  if (!d) {
    return undefined;
  }
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  return age;
}

export type IdScanIssue = 'ID_EXPIRED' | 'UNDERAGE';

function toDateOnly(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const iso = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return undefined;
    return d;
  }
  return undefined;
}

export function getIdScanIssue(params: {
  dob?: Date | string | null;
  idExpirationDate?: Date | string | null;
  now?: Date;
}): IdScanIssue | undefined {
  const now = params.now ?? new Date();
  const age = calculateAge(params.dob ?? null, now);
  if (age !== undefined && age < 18) {
    return 'UNDERAGE';
  }

  const expiresOn = toDateOnly(params.idExpirationDate);
  if (!expiresOn) return undefined;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (expiresOn.getTime() < today.getTime()) {
    return 'ID_EXPIRED';
  }
  return undefined;
}

export function getIdScanIssueMessage(issue: IdScanIssue): string {
  switch (issue) {
    case 'ID_EXPIRED':
      return 'ID is expired. Please provide an unexpired ID.';
    case 'UNDERAGE':
      return 'Customer is under 18. Please provide an ID showing 18+.';
    default:
      return 'ID is not valid for check-in.';
  }
}

/**
 * Parse membership number from scan input.
 * Supports configurable regex pattern.
 */
export function parseMembershipNumber(scanValue: string): string | null {
  // Default: extract digits only
  const pattern = process.env.MEMBERSHIP_SCAN_PATTERN || '\\d+';
  const regex = new RegExp(pattern);
  const match = scanValue.match(regex);
  return match ? match[0] : null;
}
