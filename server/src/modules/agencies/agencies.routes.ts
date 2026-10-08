import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requireOwnAgency, requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import * as agenciesController from './agencies.controller';
import { gstinSchema, mobileSchema, panSchema } from '../onboarding/onboarding.schema';

import { uploadAgencyDocs } from '../../middleware/upload';

export const agenciesRouter = Router();

const createAgencySchema = z.object({
  legalName: z.string().min(2).max(200),
  gstin: gstinSchema.optional(),
  pan: panSchema,
  contactEmail: z.string().email(),
  contactPhone: mobileSchema,
  tier: z.string().min(1),
  isIndependent: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.isIndependent && !data.gstin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GSTIN is required for business agencies',
      path: ['gstin'],
    });
  }
});

/**
 * @openapi
 * /agencies:
 *   get:
 *     summary: List agencies (ADMIN/VERIFIER only)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN', 'VERIFIER'),
  asyncHandler(agenciesController.list),
);

/**
 * @openapi
 * /agencies:
 *   post:
 *     summary: Admin-create an agency directly (D7 exception path) (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  uploadAgencyDocs,
  validate({ body: createAgencySchema }),
  asyncHandler(agenciesController.create),
);

/**
 * @openapi
 * /agencies/me:
 *   get:
 *     summary: The signed-in agency's own profile, commercial terms and documents (AGENCY)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.get('/me', authenticate, requireRole('AGENCY'), asyncHandler(agenciesController.myProfile));

/**
 * @openapi
 * /agencies/me/resale-markup:
 *   get:
 *     summary: The agency's default resale markup % — agents read it to prefill bookings (AGENCY/AGENT)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.get(
  '/me/resale-markup',
  authenticate,
  requireRole('AGENCY', 'AGENT'),
  asyncHandler(agenciesController.getResaleMarkup),
);

/**
 * @openapi
 * /agencies/me/resale-markup:
 *   patch:
 *     summary: Set the agency's default resale markup % (B2B sell-price layer) (AGENCY)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.patch(
  '/me/resale-markup',
  authenticate,
  requireRole('AGENCY'),
  validate({ body: z.object({ resaleMarkupPct: z.number().min(0).max(500) }) }),
  asyncHandler(agenciesController.updateResaleMarkup),
);

/**
 * @openapi
 * /agencies/{id}/detail:
 *   get:
 *     summary: Rich admin view of an agency — profile, terms, users, docs, financials (ADMIN/VERIFIER)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.get(
  '/:id/detail',
  authenticate,
  requireRole('ADMIN', 'VERIFIER'),
  asyncHandler(agenciesController.getDetail),
);

/**
 * @openapi
 * /agencies/{id}:
 *   get:
 *     summary: Get an agency by id (ADMIN/VERIFIER, or AGENCY/AGENT for their own agency)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.get(
  '/:id',
  authenticate,
  requireOwnAgency((req) => req.params.id),
  asyncHandler(agenciesController.getById),
);

/**
 * @openapi
 * /agencies/{id}:
 *   patch:
 *     summary: Edit an agency's profile fields (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({
    body: z
      .object({
        legalName: z.string().min(2).max(200).optional(),
        gstin: gstinSchema.optional(),
        pan: panSchema.optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: mobileSchema.optional(),
      })
      .refine((d) => Object.keys(d).length > 0, { message: 'No editable fields provided' }),
  }),
  asyncHandler(agenciesController.update),
);

/**
 * @openapi
 * /agencies/{id}/suspend:
 *   post:
 *     summary: Suspend an active agency — blocks transacting, reversible (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.post(
  '/:id/suspend',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(agenciesController.suspend),
);

/**
 * @openapi
 * /agencies/{id}/reactivate:
 *   post:
 *     summary: Reactivate a suspended agency (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.post(
  '/:id/reactivate',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(agenciesController.reactivate),
);

/**
 * @openapi
 * /agencies/{id}:
 *   delete:
 *     summary: Delete an agency with no financial history (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(agenciesController.remove),
);

/**
 * @openapi
 * /agencies/{id}/commercial-config:
 *   post:
 *     summary: Update an agency's commercial configuration (ADMIN)
 *     tags: [Agencies]
 *     security: [{ bearerAuth: [] }]
 */
agenciesRouter.post(
  '/:id/commercial-config',
  authenticate,
  requireRole('ADMIN'),
  validate({
    body: z.object({
      tier: z.string().min(1),
      markupPct: z.number().min(0).max(100).optional(), // per-agency override
    }),
  }),
  asyncHandler(agenciesController.updateCommercialConfig),
);
