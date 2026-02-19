import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import type { LaneSessionRow } from '../../checkin/types';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { transaction } from '../../db';

import { getLaneFeatureFlags } from '../../checkin/laneFeatureFlags';
import { assertLaneWriteAuthority } from '../../checkin/laneAuthority';
import { writeOfflineOutboxRecord } from '../../checkin/offlineOutbox';

/**
 * Structured error for flow command failures.
 * Extends Error so stack traces, Sentry, and Fastify error hooks work correctly.
 */
class FlowCommandError extends Error {
  readonly statusCode: number;
  readonly error: string;
  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.name = 'FlowCommandError';
    this.statusCode = statusCode;
    this.error = error;
  }
}

type FlowActor = 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM';

type FlowStep =
  | 'RENTAL'
  | 'WAITLIST_PREFERENCES'
  | 'WAITLIST_BACKUP'
  | 'PAYMENT'
  | 'AGREEMENT'
  | 'COMPLETE';

type FlowCommandType =
  | 'SET_STEP'
  | 'BACK_STEP'
  | 'CANCEL_STEP'
  | 'PROPOSE_SELECTION'
  | 'CONFIRM_SELECTION'
  | 'WAITLIST_UPDATE';

const FlowActorSchema = z.union([z.literal('CUSTOMER'), z.literal('EMPLOYEE'), z.literal('SYSTEM')]);

const FlowCommandTypeSchema = z.union([
  z.literal('SET_STEP'),
  z.literal('BACK_STEP'),
  z.literal('CANCEL_STEP'),
  z.literal('PROPOSE_SELECTION'),
  z.literal('CONFIRM_SELECTION'),
  z.literal('WAITLIST_UPDATE'),
]);

const FlowCommandRequestSchema = z.object({
  sessionId: z.string().min(1),
  commandId: z.string().uuid(),
  actor: FlowActorSchema,
  expectedFlowVersion: z.number().int().nonnegative().optional(),
  type: FlowCommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
});

const SetStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('SET_STEP'),
  payload: z.object({ step: z.string().min(1) }),
});

const BackStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('BACK_STEP'),
  payload: z.undefined().optional(),
});

const CancelStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('CANCEL_STEP'),
  payload: z.undefined().optional(),
});

const ProposeSelectionCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('PROPOSE_SELECTION'),
  payload: z.object({ rentalType: z.string().min(1) }),
});

const ConfirmSelectionCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('CONFIRM_SELECTION'),
  payload: z.undefined().optional(),
});

const WaitlistUpdateCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('WAITLIST_UPDATE'),
  payload: z
    .object({
      waitlistDesiredType: z.string().min(1).optional(),
      desiredTier: z.string().min(1).optional(),
      waitlistDesiredTypes: z.array(z.string().min(1)).optional(),
      desiredTypes: z.array(z.string().min(1)).optional(),
      backupRentalType: z.string().min(1).optional(),
      backupTier: z.string().min(1).optional(),
      waitlistRequestedResourceNumber: z.string().min(1).optional(),
      requestedResourceNumber: z.string().min(1).optional(),
      waitlistRequestedResourceType: z.union([z.literal('room'), z.literal('locker')]).optional(),
      requestedResourceType: z.union([z.literal('room'), z.literal('locker')]).optional(),
    })
    .refine(
      (p) => Object.keys(p).length > 0,
      'WAITLIST_UPDATE payload must include at least one field'
    ),
});

const FlowCommandRequestByTypeSchema = z.discriminatedUnion('type', [
  SetStepCommandSchema,
  BackStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  CancelStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  ProposeSelectionCommandSchema,
  ConfirmSelectionCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  WaitlistUpdateCommandSchema,
]);

const FLOW_STEPS: FlowStep[] = [
  'RENTAL',
  'WAITLIST_PREFERENCES',
  'WAITLIST_BACKUP',
  'PAYMENT',
  'AGREEMENT',
  'COMPLETE',
];

const FLOW_STEP_INDEX: Record<FlowStep, number> = {
  RENTAL: 0,
  WAITLIST_PREFERENCES: 1,
  WAITLIST_BACKUP: 2,
  PAYMENT: 3,
  AGREEMENT: 4,
  COMPLETE: 5,
};

const ALLOWED_STEP_TRANSITIONS: Readonly<Record<FlowStep, ReadonlySet<FlowStep>>> = {
  RENTAL: new Set(['RENTAL', 'WAITLIST_PREFERENCES']),
  WAITLIST_PREFERENCES: new Set(['RENTAL', 'WAITLIST_PREFERENCES', 'WAITLIST_BACKUP']),
  WAITLIST_BACKUP: new Set(['WAITLIST_PREFERENCES', 'WAITLIST_BACKUP', 'PAYMENT']),
  PAYMENT: new Set(['WAITLIST_BACKUP', 'PAYMENT', 'AGREEMENT']),
  AGREEMENT: new Set(['PAYMENT', 'AGREEMENT', 'COMPLETE']),
  COMPLETE: new Set(['AGREEMENT', 'COMPLETE']),
};

function assertAllowedStepTransition(params: {
  currentStep: FlowStep;
  nextStep: FlowStep;
  type: FlowCommandType;
}): void {
  const { currentStep, nextStep, type } = params;
  const currentIndex = FLOW_STEP_INDEX[currentStep];
  const nextIndex = FLOW_STEP_INDEX[nextStep];

  // CANCEL does not change steps.
  if (type === 'CANCEL_STEP') {
    if (nextStep !== currentStep) {
      throw new FlowCommandError(400, 'InvalidTransition', 'CANCEL_STEP cannot change step');
    }
    return;
  }

  // BACK_STEP must move to the previous step (or stay at first).
  if (type === 'BACK_STEP') {
    const expected = getPreviousFlowStep(currentStep);
    if (nextStep !== expected) {
      throw new FlowCommandError(400, 'InvalidTransition', `BACK_STEP must move to ${expected}`);
    }
    return;
  }

  // SET_STEP: allow no-op, forward one step, or any backward jump.
  if (nextStep === currentStep) return;
  if (nextIndex < currentIndex) return;
  if (nextIndex === currentIndex + 1) return;

  throw new FlowCommandError(400, 'InvalidTransition', `SET_STEP may only advance by one step (or jump backwards). ${currentStep} -> ${nextStep} not allowed`);
}

function assertStepIsValidForFlow(params: { currentStep: FlowStep; nextStep: FlowStep }): void {
  const { currentStep, nextStep } = params;
  const currentIndex = FLOW_STEP_INDEX[currentStep];
  const nextIndex = FLOW_STEP_INDEX[nextStep];

  // Backwards jumps are always valid.
  if (nextIndex < currentIndex) return;

  const allowed = ALLOWED_STEP_TRANSITIONS[currentStep];
  if (!allowed.has(nextStep)) {
    throw new FlowCommandError(400, 'InvalidTransition', `Transition ${currentStep} -> ${nextStep} is not allowed`);
  }
}

function parseFlowStep(value: unknown): FlowStep | null {
  if (typeof value !== 'string') return null;
  return (FLOW_STEPS as string[]).includes(value) ? (value as FlowStep) : null;
}

function getPreviousFlowStep(step: FlowStep): FlowStep {
  const currentIndex = FLOW_STEPS.indexOf(step);
  if (currentIndex <= 0) return FLOW_STEPS[0]!;
  return FLOW_STEPS[currentIndex - 1]!;
}

function computeFlowUpdate(input: {
  currentStep: FlowStep;
  type: FlowCommandType;
  payload?: Record<string, unknown>;
}): {
  nextStep: FlowStep;
  clear: {
    rental: boolean;
    waitlistPreferences: boolean;
    waitlistBackup: boolean;
    paymentIntent: boolean;
    agreement: boolean;
  };
} {
  const { currentStep, type, payload } = input;


  if (type === 'SET_STEP') {
    const requested = parseFlowStep(payload?.['step']);
    if (!requested) {
      throw new FlowCommandError(400, 'InvalidPayload', 'payload.step is required');
    }

    // When jumping backwards, clear everything after the requested step.
    const currentIndex = FLOW_STEPS.indexOf(currentStep);
    const requestedIndex = FLOW_STEPS.indexOf(requested);

    const movingBackwards = requestedIndex < currentIndex;
    const clear = {
      rental: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
      waitlistPreferences:
        movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_PREFERENCES'),
      waitlistBackup: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
      paymentIntent: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
      agreement: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
    };

    assertAllowedStepTransition({ currentStep, nextStep: requested, type });
    assertStepIsValidForFlow({ currentStep, nextStep: requested });
    return { nextStep: requested, clear };
  }

  if (type === 'BACK_STEP') {
    const nextStep = getPreviousFlowStep(currentStep);

    assertAllowedStepTransition({ currentStep, nextStep, type });
    assertStepIsValidForFlow({ currentStep, nextStep });

    const requestedIndex = FLOW_STEPS.indexOf(nextStep);

    // Back clears LEAVING step AND anything after it (should be same as jumping back)
    const clear = {
      rental: requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
      waitlistPreferences: requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_PREFERENCES'),
      waitlistBackup: requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
      paymentIntent: requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
      agreement: requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
    };

    return { nextStep, clear };
  }

  // For command-specific step transitions (Propose/Confirm typically advance step)
  const noClear = {
    rental: false,
    waitlistPreferences: false,
    waitlistBackup: false,
    paymentIntent: false,
    agreement: false,
  };

  if (type === 'PROPOSE_SELECTION' || type === 'CONFIRM_SELECTION') {
    let nextTargetStep = currentStep;
    if (type === 'CONFIRM_SELECTION' && currentStep === 'RENTAL') {
      nextTargetStep = 'WAITLIST_PREFERENCES';
    }
    // No clearing for these; they are purely additive.
    return { nextStep: nextTargetStep, clear: noClear };
  }

  if (type === 'WAITLIST_UPDATE') {
    // Purely additive update to draft fields.
    return { nextStep: currentStep, clear: noClear };
  }

  if (type === 'CANCEL_STEP') {
    // CANCEL_STEP clears the step we are currently on, without changing step.
    const clear = {
      rental: currentStep === 'RENTAL',
      waitlistPreferences: currentStep === 'WAITLIST_PREFERENCES',
      waitlistBackup: currentStep === 'WAITLIST_BACKUP',
      paymentIntent: currentStep === 'PAYMENT',
      agreement: currentStep === 'AGREEMENT',
    };

    return { nextStep: currentStep, clear };
  }

  // Exhaustive fallback — should be unreachable with current FlowCommandType union.
  return { nextStep: currentStep, clear: noClear };
}

async function isFlowCommandsEnabled(params: {
  client: Parameters<typeof getLaneFeatureFlags>[0];
  laneId: string;
}): Promise<boolean> {
  const flags = await getLaneFeatureFlags(params.client, params.laneId);
  return flags.flowCommandsEnabled;
}

async function isLanFallbackEnabledForLane(params: {
  client: Parameters<typeof getLaneFeatureFlags>[0];
  laneId: string;
}): Promise<boolean> {
  if (process.env.LAN_FALLBACK !== 'true') return false;
  const flags = await getLaneFeatureFlags(params.client, params.laneId);
  return flags.lanFallbackEnabled;
}
// NOTE: This function is duplicated from realtime-lan.ts (B-8 review finding).
// A future refactor should extract both into a shared `checkin/laneFeatureFlags.ts` utility.

export function registerCheckinFlowCommandRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: {
      sessionId: string;
      commandId: string;
      actor: FlowActor;
      expectedFlowVersion?: number;
      type: FlowCommandType;
      payload?: Record<string, unknown>;
    };
    Reply:
    | {
      applied: true;
      deduped: false;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: true;
      deduped: true;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: false;
      error: string;
      message?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/flow-command',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = FlowCommandRequestByTypeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          applied: false,
          error: 'ValidationFailed',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        });
      }

      const { sessionId, commandId, actor, expectedFlowVersion, type, payload } = parsed.data;

      try {
        const result = await transaction(async (client) => {
          if (!(await isFlowCommandsEnabled({ client, laneId }))) {
            throw new FlowCommandError(404, 'NotFound', 'Not Found');
          }

          const authority = await assertLaneWriteAuthority({ client, laneId });
          if (!authority.allowed) {
            throw new FlowCommandError(409, 'LaneNotAuthoritative', authority.reason ?? 'Lane write not allowed');
          }

          const lanMode = await isLanFallbackEnabledForLane({ client, laneId });
          const locked = await client.query<LaneSessionRow>(
            `SELECT *
             FROM lane_sessions
             WHERE id = $1 AND lane_id = $2
             FOR UPDATE`,
            [sessionId, laneId]
          );

          if (locked.rows.length === 0) {
            throw new FlowCommandError(404, 'NotFound', 'Session not found');
          }

          const session = locked.rows[0]!;
          const currentVersion = session.flow_version ?? 0;

          const dedupe = await client.query<{ session_id: string; command_id: string }>(
            `SELECT session_id, command_id
             FROM lane_session_commands
             WHERE session_id = $1 AND command_id = $2
             LIMIT 1`,
            [sessionId, commandId]
          );

          if (dedupe.rows.length > 0) {
            return { applied: true as const, deduped: true as const, session };
          }

          if (typeof expectedFlowVersion === 'number' && expectedFlowVersion !== currentVersion) {
            throw new FlowCommandError(409, 'VersionMismatch', `expectedFlowVersion ${expectedFlowVersion} does not match current ${currentVersion}`);
          }

          await client.query(
            `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, commandId, actor, type, payload ?? null]
          );

          if (lanMode) {
            await writeOfflineOutboxRecord(client, {
              laneId,
              sessionId,
              commandId,
              actor,
              type,
              payload: payload ?? null,
            });
          }

          // Domain-specific command mutations (accumulated).
          let nextStatus = session.status;
          let nextDesiredRentalType = session.desired_rental_type;
          let nextProposedRentalType = session.proposed_rental_type;
          let nextProposedBy = session.proposed_by;
          let nextSelectionConfirmed = session.selection_confirmed;
          let nextSelectionConfirmedBy = session.selection_confirmed_by;
          let nextSelectionLockedAt = session.selection_locked_at;
          let nextWaitlistDesiredType = session.waitlist_desired_type;
          let nextWaitlistDesiredTypesJson = session.waitlist_desired_types_json;
          let nextBackupRentalType = session.backup_rental_type;
          let nextWaitlistRequestedResourceNumber = session.waitlist_requested_resource_number;
          let nextWaitlistRequestedResourceType = session.waitlist_requested_resource_type;

          if (type === 'PROPOSE_SELECTION') {
            const rentalType = typeof payload?.['rentalType'] === 'string' ? payload['rentalType'] : null;
            if (!rentalType) {
              throw new FlowCommandError(400, 'InvalidPayload', 'payload.rentalType is required');
            }



            if (session.selection_confirmed) {
              throw new FlowCommandError(400, 'SelectionLocked', 'Selection is already locked');
            }

            nextProposedRentalType = rentalType;
            nextProposedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
          }

          if (type === 'CONFIRM_SELECTION') {

            if (!session.proposed_rental_type && !nextProposedRentalType) {
              throw new FlowCommandError(400, 'NoProposal', 'No selection proposed yet');
            }

            nextSelectionConfirmed = true;
            nextSelectionConfirmedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
            nextSelectionLockedAt = new Date();

            // Promotion rule: confirm sets desired to the proposed one if not already set.
            // Tests expect desired_rental_type to match proposed upon confirmation.
            if (nextProposedRentalType) {
              nextDesiredRentalType = nextProposedRentalType;
            } else if (session.proposed_rental_type) {
              nextDesiredRentalType = session.proposed_rental_type;
            }

            if (nextStatus === 'ACTIVE') {
              nextStatus = 'AWAITING_PAYMENT';
            }
          }

          if (type === 'WAITLIST_UPDATE') {
            const normalizeString = (value: unknown) => {
              if (value === null || value === undefined) return null;
              if (typeof value !== 'string') return null;
              const trimmed = value.trim();
              return trimmed.length > 0 ? trimmed : null;
            };

            const p = payload as Record<string, any>;
            const desired = normalizeString(p?.['waitlistDesiredType'] ?? p?.['desiredTier']);
            const backup = normalizeString(p?.['backupRentalType'] ?? p?.['backupTier']);
            const requestedNumber = normalizeString(p?.['waitlistRequestedResourceNumber'] ?? p?.['requestedResourceNumber']);
            const requestedTypeRaw = p?.['waitlistRequestedResourceType'] ?? p?.['requestedResourceType'];
            const requestedType =
              requestedTypeRaw === 'room' || requestedTypeRaw === 'locker' ? requestedTypeRaw : null;

            const desiredTypesRaw = p?.['waitlistDesiredTypes'] ?? p?.['desiredTypes'];
            const desiredTypes = Array.isArray(desiredTypesRaw)
              ? desiredTypesRaw
                .filter((entry): entry is string => typeof entry === 'string')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
              : undefined;

            nextWaitlistDesiredType = desired;
            nextWaitlistDesiredTypesJson = desiredTypes ? JSON.stringify(desiredTypes) : nextWaitlistDesiredTypesJson;
            nextBackupRentalType = backup;
            nextWaitlistRequestedResourceNumber = requestedNumber;
            nextWaitlistRequestedResourceType = requestedType;
          }

          const currentStep = parseFlowStep(session.flow_step) ?? 'RENTAL';
          const { nextStep, clear } = computeFlowUpdate({ currentStep, type, payload });
          const nextVersion = currentVersion + 1;

          const stringifyIfObject = (val: any) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'string') return val;
            return JSON.stringify(val);
          };

          const params = [
            nextStatus,
            nextStep,
            nextVersion,
            commandId,
            actor,
            clear.rental,
            nextDesiredRentalType,
            nextProposedRentalType,
            nextProposedBy,
            nextSelectionConfirmed,
            nextSelectionConfirmedBy,
            nextSelectionLockedAt,
            clear.waitlistPreferences || clear.waitlistBackup,
            nextWaitlistDesiredType,
            stringifyIfObject(nextWaitlistDesiredTypesJson),
            nextBackupRentalType,
            nextWaitlistRequestedResourceNumber,
            nextWaitlistRequestedResourceType,
            clear.paymentIntent,
            clear.agreement,
            sessionId,
          ];

          const updatedSession = await client.query<LaneSessionRow>(
            `UPDATE lane_sessions
             SET status = $1::public.lane_session_status,
                 flow_step = $2,
                 flow_version = $3,
                 flow_last_command_id = $4,
                 flow_last_actor = $5,
                 desired_rental_type = CASE WHEN $6 THEN NULL ELSE $7::public.rental_type END,
                 proposed_rental_type = CASE WHEN $6 THEN NULL ELSE $8::public.rental_type END,
                 proposed_by = CASE WHEN $6 THEN NULL ELSE $9 END,
                 selection_confirmed = CASE WHEN $6 THEN false ELSE $10 END,
                 selection_confirmed_by = CASE WHEN $6 THEN NULL ELSE $11 END,
                 selection_locked_at = CASE WHEN $6 THEN NULL ELSE $12::timestamptz END,
                 waitlist_desired_type = CASE WHEN $13 THEN NULL ELSE $14::public.rental_type END,
                 waitlist_desired_types_json = CASE WHEN $13 THEN NULL ELSE $15::jsonb END,
                 backup_rental_type = CASE WHEN $13 THEN NULL ELSE $16::public.rental_type END,
                 waitlist_requested_resource_number = CASE WHEN $13 THEN NULL ELSE $17 END,
                 waitlist_requested_resource_type = CASE WHEN $13 THEN NULL ELSE $18::public.inventory_resource_type END,
                 payment_intent_id = CASE WHEN $19 THEN NULL ELSE payment_intent_id END,
                 price_quote_json = CASE WHEN $19 THEN NULL ELSE price_quote_json END,
                 disclaimers_ack_json = CASE WHEN $19 THEN NULL ELSE disclaimers_ack_json END,
                 agreement_bypass_pending = CASE WHEN $20 THEN false ELSE agreement_bypass_pending END,
                 updated_at = NOW()
             WHERE id = $21
             RETURNING *`,
            params
          );

          return { applied: true as const, deduped: false as const, session: updatedSession.rows[0]! };
        });

        const { laneId: sessionLaneId, payload: sessionPayload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(sessionPayload, sessionLaneId);

        return reply.send({
          applied: true,
          deduped: result.deduped,
          flowVersion: result.session.flow_version ?? 0,
          session: result.session,
        });
      } catch (err: any) {
        request.log.error(err, 'Failed to apply flow command');
        return reply.status(err.statusCode ?? 500).send({
          applied: false,
          error: err.error ?? 'InternalServerError',
          message: err.message ?? 'An unexpected error occurred',
        });
      }
    }
  );
}
