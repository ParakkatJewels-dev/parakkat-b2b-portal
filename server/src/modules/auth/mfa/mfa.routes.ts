import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, authenticateOrMfaPending } from '../../../middleware/auth';
import { authLimiter } from '../../../middleware/rateLimit';
import { validate } from '../../../middleware/validate';
import { prisma } from '../../../lib/prisma';
import { ApiError } from '../../../utils/apiError';
import { asyncHandler } from '../../../utils/asyncHandler';
import { isMfaRequiredForRole } from '../auth.service';
import * as mfaController from './mfa.controller';
import { otpCodeSchema, totpConfirmSchema } from './mfa.schema';

export const mfaRouter = Router();

/**
 * Who may enrol a second factor: a session that has passed its current one, an account that has
 * none yet (first sign-in under a mandatory policy), or one where MFA is not in force. A session
 * that still owes an EXISTING factor may not — confirming a newly enrolled one would complete the
 * login without the factor the account actually has.
 */
const enrolmentAllowed = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.user!.mfaVerified) return next();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { role: true, mfaEnabled: true } });
  if (user.mfaEnabled && isMfaRequiredForRole(user.role, true)) {
    throw ApiError.forbidden('Finish signing in with your current second factor before changing it.');
  }
  next();
});

/**
 * @openapi
 * /auth/mfa/setup/totp:
 *   post:
 *     summary: Begin TOTP MFA setup with Supabase Auth (returns the QR code for an authenticator app)
 *     tags: [MFA]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: otpauth URL + QR code data URL
 */
mfaRouter.post('/setup/totp', authenticateOrMfaPending, enrolmentAllowed, asyncHandler(mfaController.setupTotp));

/**
 * @openapi
 * /auth/mfa/setup/totp/confirm:
 *   post:
 *     summary: Confirm TOTP setup with a code from the authenticator app
 *     tags: [MFA]
 *     security: [{ bearerAuth: [] }]
 */
mfaRouter.post(
  '/setup/totp/confirm',
  authenticateOrMfaPending,
  enrolmentAllowed,
  authLimiter,
  validate({ body: totpConfirmSchema }),
  asyncHandler(mfaController.confirmTotp),
);

/**
 * @openapi
 * /auth/mfa/setup/email/request:
 *   post:
 *     summary: Request an email OTP to begin email-based MFA setup
 *     tags: [MFA]
 *     security: [{ bearerAuth: [] }]
 */
mfaRouter.post(
  '/setup/email/request',
  authenticateOrMfaPending,
  enrolmentAllowed,
  authLimiter,
  asyncHandler(mfaController.requestEmailSetup),
);

/**
 * @openapi
 * /auth/mfa/setup/email/confirm:
 *   post:
 *     summary: Confirm email-based MFA setup with the code that was emailed
 *     tags: [MFA]
 *     security: [{ bearerAuth: [] }]
 */
mfaRouter.post(
  '/setup/email/confirm',
  authenticateOrMfaPending,
  enrolmentAllowed,
  authLimiter,
  validate({ body: otpCodeSchema }),
  asyncHandler(mfaController.confirmEmailSetup),
);

/**
 * @openapi
 * /auth/mfa/disable:
 *   post:
 *     summary: Disable MFA (not permitted for ADMIN/VERIFIER, who require it)
 *     tags: [MFA]
 *     security: [{ bearerAuth: [] }]
 */
mfaRouter.post('/disable', authenticate, asyncHandler(mfaController.disableMfa));
