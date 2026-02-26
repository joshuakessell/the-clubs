import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdScanPayloadSchema, type IdScanPayload } from '@the-clubs/shared';
import { requireAuth } from '../../auth/middleware';
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
} from '../../checkin/identity';
import { buildFullSessionUpdatedPayload, getAllowedRentals } from '../../checkin/payload';
import { CheckinScanBodySchema } from '../../checkin/schemas';
import type { CustomerRow, LaneSessionRow } from '../../checkin/types';
import { maybeAttachScanIdentifiers } from '../../checkin/helpers';
import { toDate } from '../../checkin/utils';
import { transaction } from '../../db';

function normalizeIdNumberForMatch(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
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

export function registerCheckinScanRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/scan
   *
   * Server-side scan normalization, classification, parsing, and customer matching.
   * Input: { laneId, rawScanText }
   *
   * Returns one of:
   * - MATCHED: customer record (and enrichment applied if match was via name+DOB)
   * - NO_MATCH: extracted identity payload for prefill (ID scans) or membership candidate (non-ID)
   * - ERROR: banned / invalid scan / auth error
   */
  fastify.post('/v1/checkin/scan', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    let body: z.infer<typeof CheckinScanBodySchema>;
    try {
      body = CheckinScanBodySchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    const normalized = normalizeScanText(body.rawScanText);
    if (!normalized) {
      return reply.status(400).send({
        result: 'ERROR',
        error: { code: 'INVALID_SCAN', message: 'Empty scan input' },
      });
    }

    const isAamva = isLikelyAamvaPdf417Text(normalized);
    if (body.selectedCustomerId && !isAamva) {
      return reply.status(400).send({
        result: 'ERROR',
        error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
      });
    }

    try {
      const result = await transaction(async (client) => {
        type CustomerIdentityRow = {
          id: string;
          name: string;
          dob: Date | null;
          id_expiration_date: Date | null;
          membership_number: string | null;
          banned_until: Date | null;
          id_scan_hash: string | null;
          id_scan_value: string | null;
        };
        type CustomerIdentityCandidateRow = CustomerIdentityRow & { created_at: Date };

        const checkBanned = (row: CustomerIdentityRow) => {
          const bannedUntil = toDate(row.banned_until);
          if (bannedUntil && bannedUntil > new Date()) {
            throw {
              statusCode: 403,
              code: 'BANNED',
              message: `Customer is banned until ${bannedUntil.toISOString()}`,
            };
          }
        };

        if (isAamva) {
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
          const idType = extracted.idType ?? null;
          const idTypeOther = extracted.idTypeOther ?? null;

          // Employee-choice resolution (staff override after fuzzy evaluation)
          if (body.selectedCustomerId) {
            const selected = await client.query<CustomerIdentityRow>(
              `SELECT id, name, dob, id_expiration_date, membership_number, banned_until, id_scan_hash, id_scan_value
               FROM customers
               WHERE id = $1
               LIMIT 1`,
              [body.selectedCustomerId]
            );
            if (selected.rows.length === 0) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }
            const chosen = selected.rows[0]!;

            // Only allow selection resolution when scan has the identity fields needed.
            if (!extracted.dob || !extracted.firstName || !extracted.lastName) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const chosenDob = chosen.dob ? chosen.dob.toISOString().slice(0, 10) : null;
            if (chosenDob !== extracted.dob) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const scannedParts = splitNamePartsForMatch(
              `${extracted.firstName} ${extracted.lastName}`.trim()
            );
            const storedParts = splitNamePartsForMatch(chosen.name);
            if (!scannedParts || !storedParts) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const fuzzy = scoreNameMatch({
              scannedFirst: scannedParts.firstToken,
              scannedLast: scannedParts.lastToken,
              storedFirst: storedParts.firstToken,
              storedLast: storedParts.lastToken,
            });
            if (!passesFuzzyThresholds(fuzzy)) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            checkBanned(chosen);
            await maybeAttachScanIdentifiers({
              client,
              customerId: chosen.id,
              existingIdScanHash: chosen.id_scan_hash,
              existingIdScanValue: chosen.id_scan_value,
              idScanHash,
              idScanValue,
            });
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

            if (idScanIssue) {
              return {
                result: 'ERROR' as const,
                error: {
                  code: idScanIssue,
                  message: getIdScanIssueMessage(idScanIssue),
                },
              };
            }

            return {
              result: 'MATCHED' as const,
              scanType: 'STATE_ID' as const,
              normalizedRawScanText: idScanValue,
              idScanHash,
              customer: {
                id: chosen.id,
                name: chosen.name,
                dob: chosen.dob ? chosen.dob.toISOString().slice(0, 10) : null,
                membershipNumber: chosen.membership_number,
              },
              extracted,
              enriched: Boolean(!chosen.id_scan_hash || !chosen.id_scan_value),
            };
          }

          // Matching order:
          // 1) customers.id_scan_hash (name + dob hash) OR customers.id_scan_value (raw scan)
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

            // Ensure both identifiers are persisted for future instant matches.
            await maybeAttachScanIdentifiers({
              client,
              customerId: matched.id,
              existingIdScanHash: matched.id_scan_hash,
              existingIdScanValue: matched.id_scan_value,
              idScanHash,
              idScanValue,
            });
            if (
              extracted.idExpirationDate ||
              extracted.idNumber ||
              extracted.jurisdiction ||
              extracted.issuer ||
              idType ||
              idTypeOther
            ) {
              await client.query(
                `UPDATE customers
                 SET id_expiration_date = COALESCE($1::date, id_expiration_date),
                     id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
                     id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
                     id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
                     id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
                     updated_at = NOW()
                 WHERE id = $6`,
                [
                  extracted.idExpirationDate || null,
                  extracted.idNumber || null,
                  extracted.jurisdiction || extracted.issuer || null,
                  idType,
                  idTypeOther,
                  matched.id,
                ]
              );
            }

            if (idScanIssue) {
              return {
                result: 'ERROR' as const,
                error: {
                  code: idScanIssue,
                  message: getIdScanIssueMessage(idScanIssue),
                },
              };
            }

            return {
              result: 'MATCHED' as const,
              scanType: 'STATE_ID' as const,
              normalizedRawScanText: idScanValue,
              idScanHash,
              customer: {
                id: matched.id,
                name: matched.name,
                dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                membershipNumber: matched.membership_number,
              },
              extracted,
              enriched: false,
            };
          }

          // 1b) fallback match by stored idNumber/hash (manual or scan-id with issuer+idNumber)
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
              await maybeAttachScanIdentifiers({
                client,
                customerId: matched.id,
                existingIdScanHash: matched.id_scan_hash,
                existingIdScanValue: matched.id_scan_value,
                idScanHash,
                idScanValue,
              });
              if (
                extracted.idExpirationDate ||
                extracted.idNumber ||
                extracted.jurisdiction ||
                extracted.issuer ||
                idType ||
                idTypeOther
              ) {
                await client.query(
                  `UPDATE customers
                   SET id_expiration_date = COALESCE($1::date, id_expiration_date),
                       id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
                       id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
                       id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
                       id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
                       updated_at = NOW()
                   WHERE id = $6`,
                  [
                    extracted.idExpirationDate || null,
                    extracted.idNumber || null,
                    extracted.jurisdiction || extracted.issuer || null,
                    idType,
                    idTypeOther,
                    matched.id,
                  ]
                );
              }

              if (idScanIssue) {
                return {
                  result: 'ERROR' as const,
                  error: {
                    code: idScanIssue,
                    message: getIdScanIssueMessage(idScanIssue),
                  },
                };
              }

              return {
                result: 'MATCHED' as const,
                scanType: 'STATE_ID' as const,
                normalizedRawScanText: idScanValue,
                idScanHash,
                customer: {
                  id: matched.id,
                  name: matched.name,
                  dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                  membershipNumber: matched.membership_number,
                },
                extracted,
                enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
              };
            }
          }

          // 2) fallback match by (first_name,last_name,birthdate) normalized
          if (extracted.firstName && extracted.lastName && extracted.dob) {
            // Compare against customers.dob (DATE) using an explicit date cast to avoid timezone issues.
            const dobStr = extracted.dob;
            if (/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) {
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

                // Enrich customer for future instant matches
                await maybeAttachScanIdentifiers({
                  client,
                  customerId: matched.id,
                  existingIdScanHash: matched.id_scan_hash,
                  existingIdScanValue: matched.id_scan_value,
                  idScanHash,
                  idScanValue,
                });
                if (
                  extracted.idExpirationDate ||
                  extracted.idNumber ||
                  extracted.jurisdiction ||
                  extracted.issuer ||
                  idType ||
                  idTypeOther
                ) {
                  await client.query(
                    `UPDATE customers
                     SET id_expiration_date = COALESCE($1::date, id_expiration_date),
                         id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
                         id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
                         id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
                         id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
                         updated_at = NOW()
                     WHERE id = $6`,
                    [
                      extracted.idExpirationDate || null,
                      extracted.idNumber || null,
                      extracted.jurisdiction || extracted.issuer || null,
                      idType,
                      idTypeOther,
                      matched.id,
                    ]
                  );
                }

                if (idScanIssue) {
                  return {
                    result: 'ERROR' as const,
                    error: {
                      code: idScanIssue,
                      message: getIdScanIssueMessage(idScanIssue),
                    },
                  };
                }

                return {
                  result: 'MATCHED' as const,
                  scanType: 'STATE_ID' as const,
                  normalizedRawScanText: idScanValue,
                  idScanHash,
                  customer: {
                    id: matched.id,
                    name: matched.name,
                    dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                    membershipNumber: matched.membership_number,
                  },
                  extracted,
                  enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
                };
              }

              // 2b) fuzzy match: exact DOB filter in SQL, then deterministic similarity in app code
              const scannedParts = splitNamePartsForMatch(
                `${extracted.firstName} ${extracted.lastName}`.trim()
              );
              if (scannedParts) {
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
                  // Single fuzzy match — auto-select
                  const matched = scored[0]!.row;
                  checkBanned(matched);
                  await maybeAttachScanIdentifiers({
                    client,
                    customerId: matched.id,
                    existingIdScanHash: matched.id_scan_hash,
                    existingIdScanValue: matched.id_scan_value,
                    idScanHash,
                    idScanValue,
                  });
                  if (
                    extracted.idExpirationDate ||
                    extracted.idNumber ||
                    extracted.jurisdiction ||
                    extracted.issuer ||
                    idType ||
                    idTypeOther
                  ) {
                    await client.query(
                      `UPDATE customers
                       SET id_expiration_date = COALESCE($1::date, id_expiration_date),
                           id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
                           id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
                           id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
                           id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
                           updated_at = NOW()
                       WHERE id = $6`,
                      [
                        extracted.idExpirationDate || null,
                        extracted.idNumber || null,
                        extracted.jurisdiction || extracted.issuer || null,
                        idType,
                        idTypeOther,
                        matched.id,
                      ]
                    );
                  }
                  if (idScanIssue) {
                    return {
                      result: 'ERROR' as const,
                      error: {
                        code: idScanIssue,
                        message: getIdScanIssueMessage(idScanIssue),
                      },
                    };
                  }
                  return {
                    result: 'MATCHED' as const,
                    scanType: 'STATE_ID' as const,
                    normalizedRawScanText: idScanValue,
                    idScanHash,
                    customer: {
                      id: matched.id,
                      name: matched.name,
                      dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                      membershipNumber: matched.membership_number,
                    },
                    extracted,
                    enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
                  };
                } else if (scored.length > 1) {
                  // Multiple fuzzy matches — return candidates for employee selection
                  return {
                    result: 'CANDIDATES' as const,
                    scanType: 'STATE_ID' as const,
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
              }
            }
          }

          // 3) no match: return extracted identity for prefill
          return {
            result: idScanIssue ? ('ERROR' as const) : ('NO_MATCH' as const),
            scanType: 'STATE_ID' as const,
            normalizedRawScanText: idScanValue,
            idScanHash,
            extracted,
            ...(idScanIssue
              ? {
                  error: {
                    code: idScanIssue,
                    message: getIdScanIssueMessage(idScanIssue),
                  },
                }
              : {}),
          };
        }

        // Non-state-ID: treat as membership/general barcode
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
            result: 'MATCHED' as const,
            scanType: 'MEMBERSHIP' as const,
            normalizedRawScanText: normalized,
            membershipNumber: matched.membership_number,
            customer: {
              id: matched.id,
              name: matched.name,
              dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
              membershipNumber: matched.membership_number,
            },
          };
        }

        // Check if input looks like a passport number (short alphanumeric, 5-20 chars)
        const trimmedInput = normalized.trim();
        const isLikelyPassport = /^[A-Z0-9]{5,20}$/i.test(trimmedInput) && !/^\d{11,}$/.test(trimmedInput);

        if (isLikelyPassport) {
          // Search by id_number for passport matches
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
              result: 'MATCHED' as const,
              scanType: 'PASSPORT' as const,
              normalizedRawScanText: normalized,
              customer: {
                id: matched.id,
                name: matched.name,
                dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                membershipNumber: matched.membership_number,
              },
            };
          }

          // No passport match — return for manual entry prefill
          return {
            result: 'NO_MATCH' as const,
            scanType: 'PASSPORT' as const,
            normalizedRawScanText: normalized,
            passportNumber: trimmedInput,
          };
        }

        return {
          result: 'NO_MATCH' as const,
          scanType: 'MEMBERSHIP' as const,
          normalizedRawScanText: normalized,
          membershipCandidate,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to process checkin scan');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const code = (error as { code?: string }).code;
        const message = (error as { message?: string }).message;
        return reply.status(statusCode).send({
          result: 'ERROR',
          error: { code: code || 'ERROR', message: message || 'Failed to process scan' },
        });
      }
      return reply.status(500).send({
        result: 'ERROR',
        error: { code: 'INTERNAL', message: 'Failed to process scan' },
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/scan-id
   *
   * Scan ID (PDF417 barcode) to identify customer and start/update lane session.
   * Server-authoritative: upserts customer based on id_scan_hash, updates lane session.
   *
   * Input: IdScanPayload (raw barcode + parsed fields)
   * Output: lane session state with customer info
   */
  fastify.post<{
    Params: { laneId: string };
    Body: IdScanPayload;
  }>(
    '/v1/checkin/lane/:laneId/scan-id',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { laneId } = request.params;
      let body: IdScanPayload;

      try {
        body = IdScanPayloadSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // Compute id_scan_hash from normalized name + dob when available.
          let idScanHash: string | null =
            computeIdScanIdentityHash({
              firstName: body.firstName,
              lastName: body.lastName,
              fullName: body.fullName,
              dob: body.dob,
            }) ?? null;
          let idScanValue: string | null = null;
          if (body.raw) {
            idScanValue = normalizeScanText(body.raw);
          }
          if (!idScanHash) {
            if (idScanValue) {
              idScanHash = computeSha256Hex(idScanValue);
            } else if (body.idNumber && (body.issuer || body.jurisdiction)) {
              // Fallback: derive hash from issuer + idNumber
              const issuer = body.issuer || body.jurisdiction || '';
              const combined = `${issuer}:${body.idNumber}`;
              idScanHash = computeSha256Hex(combined);
            }
          }
          if (!idScanValue && body.idNumber) {
            idScanValue = body.idNumber.trim() || null;
          }

          // Determine customer name from parsed fields
          let customerName = body.fullName || '';
          if (!customerName && body.firstName && body.lastName) {
            customerName = `${body.firstName} ${body.lastName}`.trim();
          }
          if (!customerName && body.idNumber) {
            customerName = `Customer ${body.idNumber}`; // Fallback
          }
          if (!customerName) {
            throw { statusCode: 400, message: 'Unable to determine customer name from ID scan' };
          }

          // Parse DOB if provided
          let dob: Date | null = null;
          if (body.dob) {
            const parsedDob = new Date(body.dob);
            if (!isNaN(parsedDob.getTime())) {
              dob = parsedDob;
            }
          }

          // Parse ID expiration date if provided
          let idExpirationDate: Date | null = null;
          if (body.idExpirationDate) {
            const parsedExpiration = new Date(`${body.idExpirationDate}T00:00:00Z`);
            if (!isNaN(parsedExpiration.getTime())) {
              idExpirationDate = parsedExpiration;
            }
          }
          const idScanIssue = getIdScanIssue({
            dob: dob ?? body.dob,
            idExpirationDate: idExpirationDate ?? body.idExpirationDate,
          });

          // Upsert customer based on id_scan_hash
          let customerId: string | null = null;

          const idNumber = body.idNumber?.trim() || null;
          const idState = body.issuer || body.jurisdiction || null;
          const idType = body.idType ?? null;
          const idTypeOther = body.idTypeOther ?? null;

          if (idScanHash) {
            // Look for existing customer by hash
            const existingCustomer = await client.query<{
              id: string;
              name: string;
              dob: Date | null;
              id_expiration_date: Date | null;
            }>(
              `SELECT id, name, dob, id_expiration_date
               FROM customers
               WHERE id_scan_hash = $1 OR id_scan_value = $2
               LIMIT 1`,
              [idScanHash, idScanValue]
            );

            if (existingCustomer.rows.length > 0) {
              customerId = existingCustomer.rows[0]!.id;
              // Update name/dob if missing in existing record
              const existing = existingCustomer.rows[0]!;
              if ((!existing.name || existing.name === 'Customer') && customerName) {
                await client.query(
                  `UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2`,
                  [customerName, customerId]
                );
              }
              if (!existing.dob && dob) {
                await client.query(
                  `UPDATE customers SET dob = $1, updated_at = NOW() WHERE id = $2`,
                  [dob, customerId]
                );
              }
              if (idExpirationDate || idNumber || idState || idType || idTypeOther) {
                await client.query(
                  `UPDATE customers
                   SET id_expiration_date = COALESCE($1::date, id_expiration_date),
                       id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
                       id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
                       id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
                       id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
                       updated_at = NOW()
                   WHERE id = $6`,
                  [
                    idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null,
                    idNumber,
                    idState,
                    idType,
                    idTypeOther,
                    customerId,
                  ]
                );
              }

              // Ensure scan identifiers are persisted for future matches.
              if (idScanValue) {
                await client.query(
                  `UPDATE customers
                 SET id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> $1 THEN $1 ELSE id_scan_hash END,
                     id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> $2 THEN $2 ELSE id_scan_value END,
                     updated_at = NOW()
                 WHERE id = $3`,
                  [idScanHash, idScanValue, customerId]
                );
              }
            } else {
              // Create new customer
              const newCustomer = await client.query<{ id: string }>(
                `INSERT INTO customers
                 (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_hash, id_scan_value, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                 RETURNING id`,
                [
                  customerName,
                  dob,
                  idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null,
                  idNumber,
                  idState,
                  idType,
                  idTypeOther,
                  idScanHash,
                  idScanValue,
                ]
              );
              customerId = newCustomer.rows[0]!.id;
            }
          } else {
            // No hash available - create new customer (manual entry fallback)
            // This should be rare but allowed for manual entry
            const newCustomer = await client.query<{ id: string }>(
              `INSERT INTO customers
               (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_value, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
               RETURNING id`,
              [
                customerName,
                dob,
                idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null,
                idNumber,
                idState,
                idType,
                idTypeOther,
                idScanValue,
              ]
            );
            customerId = newCustomer.rows[0]!.id;
          }

          if (idScanIssue) {
            throw {
              statusCode: 403,
              code: idScanIssue,
              message: getIdScanIssueMessage(idScanIssue),
            };
          }

          // Check if customer is banned
          const customerCheck = await client.query<{ banned_until: unknown }>(
            `SELECT banned_until FROM customers WHERE id = $1`,
            [customerId]
          );
          const bannedUntil = toDate(customerCheck.rows[0]?.banned_until);
          if (bannedUntil && bannedUntil > new Date()) {
            throw {
              statusCode: 403,
              message: `Customer is banned until ${bannedUntil.toISOString()}`,
            };
          }

          // If customer already has an active (not-ended) visit, block a new lane check-in session.
          // Renewal/extension must be started explicitly via /start with visitId.
          if (customerId) {
            const activeVisit = await client.query<{ id: string }>(
              `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
              [customerId]
            );
            if (activeVisit.rows.length > 0) {
              const activeVisitId = activeVisit.rows[0]!.id;

              const activeBlock = await client.query<{
                starts_at: Date;
                ends_at: Date;
                rental_type: string;
                room_number: string | null;
                locker_number: string | null;
              }>(
                `SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as room_number, l.number as locker_number
                 FROM checkin_blocks cb
                 LEFT JOIN rooms r ON cb.room_id = r.id
                 LEFT JOIN lockers l ON cb.locker_id = l.id
                 WHERE cb.visit_id = $1
                 ORDER BY cb.ends_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );

              const block = activeBlock.rows[0];
              const assignedResourceType: 'room' | 'locker' | null = block?.room_number
                ? 'room'
                : block?.locker_number
                  ? 'locker'
                  : null;
              const assignedResourceNumber: string | null =
                block?.room_number ?? block?.locker_number ?? null;

              const waitlistResult = await client.query<{
                id: string;
                desired_tier: string;
                backup_tier: string;
                status: string;
              }>(
                `SELECT id, desired_tier, backup_tier, status
                 FROM waitlist
                 WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );
              const wl = waitlistResult.rows[0];

              throw {
                statusCode: 409,
                code: 'ALREADY_CHECKED_IN',
                message: 'Customer is currently checked in',
                activeCheckin: {
                  visitId: activeVisitId,
                  rentalType: block?.rental_type ?? null,
                  assignedResourceType,
                  assignedResourceNumber,
                  checkinAt: block?.starts_at ? block.starts_at.toISOString() : null,
                  checkoutAt: block?.ends_at ? block.ends_at.toISOString() : null,
                  overdue: block?.ends_at ? block.ends_at.getTime() < Date.now() : null,
                  waitlist: wl
                    ? {
                        id: wl.id,
                        desiredTier: wl.desired_tier,
                        backupTier: wl.backup_tier,
                        status: wl.status,
                      }
                    : null,
                },
              };
            }
          }

          const computedMode: 'CHECKIN' | 'RENEWAL' = 'CHECKIN';

          // Determine allowed rentals (no membership yet, so just basic options)
          const allowedRentals = getAllowedRentals(null);

          // Create or update lane session
          const existingSession = await client.query<LaneSessionRow>(
            `SELECT id, status FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          let session: LaneSessionRow;

          if (existingSession.rows.length > 0 && existingSession.rows[0]!.status !== 'COMPLETED') {
            // Update existing session
            const updateResult = await client.query<LaneSessionRow>(
              `UPDATE lane_sessions
             SET customer_id = $1,
                customer_display_name = $2,
                status = 'ACTIVE',
                staff_id = $3,
                checkin_mode = $4,
                renewal_hours = NULL,
                updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
              [customerId, customerName, staffId, computedMode, existingSession.rows[0]!.id]
            );
            session = updateResult.rows[0]!;
          } else {
            // Create new session
            const newSessionResult = await client.query<LaneSessionRow>(
              `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, checkin_mode, renewal_hours)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5, NULL)
             RETURNING *`,
              [laneId, staffId, customerId, customerName, computedMode]
            );
            session = newSessionResult.rows[0]!;
          }

          // Get customer info if customer exists
          let pastDueBalance = 0;
          let pastDueBlocked = false;
          let customerPrimaryLanguage: 'EN' | 'ES' | undefined;
          let customerDobMonthDay: string | undefined;
          let customerMembershipValidUntil: string | undefined;
          let ledgerLineItems: Array<{ description: string; amount: number }> | undefined;
          let ledgerTotal: number | undefined;
          // last visit is derived from visits + checkin_blocks (broadcast uses DB-join helper)

          if (session.customer_id) {
            const customerInfo = await client.query<CustomerRow>(
              `SELECT past_due_balance, primary_language, dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
              [session.customer_id]
            );
            if (customerInfo.rows.length > 0) {
              const customer = customerInfo.rows[0]!;
              pastDueBalance = parseFloat(String(customer.past_due_balance || 0));
              pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
              customerPrimaryLanguage = customer.primary_language as 'EN' | 'ES' | undefined;

              if (customer.dob) {
                customerDobMonthDay = `${String(customer.dob.getMonth() + 1).padStart(2, '0')}/${String(customer.dob.getDate()).padStart(2, '0')}`;
              }

              // Check membership for ledger seed
              const membershipCardType = customer.membership_card_type as string | undefined;
              const membershipValidUntilDate = customer.membership_valid_until
                ? new Date(customer.membership_valid_until as unknown as string)
                : null;
              const hasMembership =
                membershipCardType === 'SIX_MONTH' &&
                membershipValidUntilDate != null &&
                new Date() <= membershipValidUntilDate;

              if (membershipValidUntilDate) {
                customerMembershipValidUntil = membershipValidUntilDate.toISOString().slice(0, 10);
              }

              if (!hasMembership && computedMode === 'CHECKIN') {
                ledgerLineItems = [{ description: 'Membership Fee', amount: 13 }];
                ledgerTotal = 13;
              }
            }
          }

          return {
            sessionId: session.id,
            customerId: session.customer_id,
            customerName: session.customer_display_name,
            allowedRentals,
            mode: computedMode,
            pastDueBalance,
            pastDueBlocked,
            customerPrimaryLanguage,
            customerDobMonthDay,
            customerMembershipValidUntil,
            ledgerLineItems,
            ledgerTotal,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to scan ID');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          const code = (error as { code?: unknown }).code;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
            return reply.status(200).send({
              code: 'ALREADY_CHECKED_IN',
              alreadyCheckedIn: true,
              activeCheckin:
                activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
            });
          }
          return reply.status(statusCode).send({
            error: message ?? 'Failed to scan ID',
            code: typeof code === 'string' ? code : undefined,
            activeCheckin:
              activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
