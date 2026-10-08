import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { availabilityQuerySchema } from '../booking/booking.schema';
import * as catalogController from './catalog.controller';

export const catalogRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/**
 * @openapi
 * /catalog/resorts:
 *   get:
 *     summary: List resorts (read-only from CRS) — AGENT/AGENCY
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 */
catalogRouter.get(
  '/resorts',
  authenticate,
  requireRole('AGENT', 'AGENCY'),
  asyncHandler(catalogController.resorts),
);

/**
 * @openapi
 * /catalog/rooms:
 *   get:
 *     summary: Browse the room catalog without dates (indicative pricing) — AGENT/AGENCY
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 */
catalogRouter.get(
  '/rooms',
  authenticate,
  requireRole('AGENT', 'AGENCY'),
  asyncHandler(catalogController.browse),
);

/**
 * @openapi
 * /catalog/availability:
 *   get:
 *     summary: Search room availability with the agency price (AGENT/AGENCY)
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 */
catalogRouter.get(
  '/availability',
  authenticate,
  requireRole('AGENT', 'AGENCY'),
  validate({ query: availabilityQuerySchema }),
  asyncHandler(catalogController.availability),
);

/**
 * @openapi
 * /catalog/axis-rates:
 *   get:
 *     summary: Admin read-through of CRS rate plans, occupancy & restrictions
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 */
catalogRouter.get(
  '/axis-rates',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: z.object({ resortId: z.string().optional(), checkIn: dateStr, checkOut: dateStr }) }),
  asyncHandler(catalogController.axisRates),
);

/**
 * @openapi
 * /catalog/admin/overview:
 *   get: { summary: Admin read-only catalog of CRS resorts + room types, tags: [Catalog], security: [{ bearerAuth: [] }] }
 */
catalogRouter.get(
  '/admin/overview',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(catalogController.adminCatalog),
);
