import { Router } from 'express';
import { authenticate, authenticateOrMfaPending } from '../../../middleware/auth';
import { authLimiter } from '../../../middleware/rateLimit';
import { validate } from '../../../middleware/validate';
import { asyncHandler } from '../../../utils/asyncHandler';
import * as mfaController from './mfa.controller';
import { otpCodeSchema } from './mfa.schema';

export const mfaRouter = Router();

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
mfaRouter.post('/setup/totp', authenticateOrMfaPending, asyncHandler(mfaController.setupTotp));

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
  authLimiter,
  validate({ body: otpCodeSchema }),
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
