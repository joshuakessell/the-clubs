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
