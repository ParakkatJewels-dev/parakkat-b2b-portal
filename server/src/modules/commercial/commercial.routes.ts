import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { getTiers, saveTiers } from './tiers';

export const commercialRouter = Router();

/**
 * @openapi
 * /commercial/tiers:
 *   get:
 *     summary: List configured tier presets used to populate commercial terms (ADMIN)
 *     tags: [Commercial]
 *     security: [{ bearerAuth: [] }]
 */
commercialRouter.get(
  '/tiers',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.status(200).json({ tiers: getTiers() });
  }),
);

const updateTiersSchema = z.object({
  tiers: z.record(
    z.string(),
    z.object({
      paymentMode: z.enum(['PREPAY', 'CREDIT']),
      creditLimit: z.number().nonnegative(),
      paymentTerms: z.string().min(1),
      markupPct: z.number().nonnegative(),
    }),
  ),
});

/**
 * @openapi
 * /commercial/tiers:
 *   post:
 *     summary: Update configured tier presets dynamically (ADMIN)
 *     tags: [Commercial]
 *     security: [{ bearerAuth: [] }]
 */
commercialRouter.post(
  '/tiers',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: updateTiersSchema }),
  asyncHandler(async (req, res) => {
    await saveTiers(req.body.tiers, { actorId: req.user!.id, actorRole: req.user!.role });
    res.status(200).json({ tiers: getTiers() });
  }),
);
