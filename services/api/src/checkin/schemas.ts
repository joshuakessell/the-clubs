import { z } from 'zod';

export const StartLaneSessionBodySchema = z
  .object({
    customerId: z.string().uuid().optional(),
    idScanValue: z.string().min(1).optional(),
    membershipScanValue: z.string().optional(),
    visitId: z.string().uuid().optional(),
    renewalHours: z.union([z.literal(2), z.literal(6)]).optional(),
  })
  .refine((val) => !!val.customerId || !!val.idScanValue, {
    message: 'customerId or idScanValue is required',
  });

export const CheckinScanBodySchema = z.object({
  laneId: z.string().min(1),
  rawScanText: z.string().min(1),
  selectedCustomerId: z.string().uuid().optional(),
});

export const PastDueBypassSchema = z.object({
  managerId: z.string().uuid(),
  managerPin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});

export const MembershipPurchaseIntentSchema = z.object({
  intent: z.enum(['PURCHASE', 'RENEW', 'NONE']),
  sessionId: z.string().uuid().optional(),
});

export const AddOnsSchema = z.object({
  sessionId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
      })
    )
    .min(1),
});

export const HighlightOptionSchema = z.object({
  step: z.enum(['MEMBERSHIP', 'WAITLIST_BACKUP']),
  option: z.string().min(1).nullable(),
  sessionId: z.string().uuid().optional(),
});

export const MembershipChoiceSchema = z.object({
  choice: z.enum(['ONE_TIME', 'SIX_MONTH', 'NONE']),
  sessionId: z.string().uuid().optional(),
});

export const CompleteMembershipPurchaseSchema = z.object({
  sessionId: z.string().uuid().optional(),
  membershipNumber: z.string().min(1),
});

export type FlowActor = 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM';
export type FlowStep = 'RENTAL' | 'WAITLIST_BACKUP' | 'WAITLIST_DISCLAIMER' | 'PAYMENT' | 'AGREEMENT' | 'ASSIGNMENT' | 'COMPLETE';
export type FlowCommandType = 'SET_STEP' | 'BACK_STEP' | 'CANCEL_STEP' | 'PROPOSE_SELECTION' | 'CONFIRM_SELECTION' | 'WAITLIST_UPDATE';

export const FlowActorSchema = z.union([z.literal('CUSTOMER'), z.literal('EMPLOYEE'), z.literal('SYSTEM')]);
export const FlowCommandTypeSchema = z.union([
  z.literal('SET_STEP'), z.literal('BACK_STEP'), z.literal('CANCEL_STEP'),
  z.literal('PROPOSE_SELECTION'), z.literal('CONFIRM_SELECTION'), z.literal('WAITLIST_UPDATE')
]);
export const FlowCommandRequestSchema = z.object({
  sessionId: z.string().min(1),
  commandId: z.string().uuid(),
  actor: FlowActorSchema,
  expectedFlowVersion: z.number().int().nonnegative().optional(),
  type: FlowCommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
});
export const SetStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('SET_STEP'),
  payload: z.object({
    step: z.string().min(1),
    paymentMethod: z.string().optional(),
    paymentFailed: z.boolean().optional(),
    failureReason: z.string().optional(),
    splitCashAmount: z.number().optional(),
    splitCreditAmount: z.number().optional(),
  }),
});
export const BackStepCommandSchema = FlowCommandRequestSchema.extend({ type: z.literal('BACK_STEP'), payload: z.undefined().optional() });
export const CancelStepCommandSchema = FlowCommandRequestSchema.extend({ type: z.literal('CANCEL_STEP'), payload: z.undefined().optional() });
export const ProposeSelectionCommandSchema = FlowCommandRequestSchema.extend({ type: z.literal('PROPOSE_SELECTION'), payload: z.object({ rentalType: z.string().min(1) }) });
export const ConfirmSelectionCommandSchema = FlowCommandRequestSchema.extend({ type: z.literal('CONFIRM_SELECTION'), payload: z.undefined().optional() });
export const WaitlistUpdateCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('WAITLIST_UPDATE'),
  payload: z.object({
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
  }).refine((p) => Object.keys(p).length > 0, 'WAITLIST_UPDATE payload must include at least one field'),
});
export const FlowCommandRequestByTypeSchema = z.discriminatedUnion('type', [
  SetStepCommandSchema, BackStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  CancelStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }), ProposeSelectionCommandSchema,
  ConfirmSelectionCommandSchema.extend({ payload: z.record(z.unknown()).optional() }), WaitlistUpdateCommandSchema,
]);
