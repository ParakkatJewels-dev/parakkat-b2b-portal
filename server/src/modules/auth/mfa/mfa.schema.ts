import { z } from 'zod';

export const otpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export type OtpCodeInput = z.infer<typeof otpCodeSchema>;

/** Confirms the authenticator enrolment that /setup/totp returned. */
export const totpConfirmSchema = otpCodeSchema.extend({
  factorId: z.string().uuid(),
});
