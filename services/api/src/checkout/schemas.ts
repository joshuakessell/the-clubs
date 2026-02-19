import { z } from 'zod';

export const ResolveKeySchema = z.object({
  token: z.string().min(1),
  kioskDeviceId: z.string().min(1),
});

export type ResolveKeyInput = z.infer<typeof ResolveKeySchema>;

export const CreateCheckoutRequestSchema = z.object({
  occupancyId: z.string().uuid(), // checkin_block.id
  kioskDeviceId: z.string().min(1),
  checklist: z.object({
    key: z.boolean().optional(),
    towel: z.boolean().optional(),
    sheets: z.boolean().optional(),
    remote: z.boolean().optional(),
  }),
});

export type CreateCheckoutRequestInput = z.infer<typeof CreateCheckoutRequestSchema>;

export const MarkFeePaidSchema = z.object({
  note: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'CREDIT']).optional(),
  registerNumber: z.number().int().min(1).max(3).optional(),
  tipCents: z.number().int().nonnegative().optional(),
});

export type MarkFeePaidInput = z.infer<typeof MarkFeePaidSchema>;
