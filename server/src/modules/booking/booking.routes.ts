import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { accountLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import * as bookingController from './booking.controller';
import {
  bookingIdParamSchema,
  createBookingSchema,
  createGroupBookingSchema,
  groupIdParamSchema,
  listBookingsQuerySchema,
  resortCancelSchema,
  voucherQuerySchema,
} from './booking.schema';

export const bookingRouter = Router();

const agencySide = [authenticate, accountLimiter, requireRole('AGENT', 'AGENCY')] as const;

/**
 * @openapi
 * /bookings:
 *   post:
 *     summary: Create a booking — runs the unified credit gate (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.post(
  '/',
  ...agencySide,
  validate({ body: createBookingSchema }),
  asyncHandler(bookingController.create),
);

/**
 * @openapi
 * /bookings/group:
 *   post:
 *     summary: Create a multi-room group booking (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.post(
  '/group',
  ...agencySide,
  validate({ body: createGroupBookingSchema }),
  asyncHandler(bookingController.createGroup),
);

/**
 * @openapi
 * /bookings/group/{groupId}/pay:
 *   post:
 *     summary: Pay all awaiting-payment lines of a group (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.post(
  '/group/:groupId/pay',
  ...agencySide,
  validate({ params: groupIdParamSchema }),
  asyncHandler(bookingController.payGroup),
);

/**
 * @openapi
 * /bookings:
 *   get:
 *     summary: List the agency's bookings (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/',
  ...agencySide,
  validate({ query: listBookingsQuerySchema }),
  asyncHandler(bookingController.list),
);

/**
 * @openapi
 * /bookings/guests:
 *   get:
 *     summary: Guests derived from bookings' lead-guest data (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get('/guests', ...agencySide, asyncHandler(bookingController.guests));

/**
 * @openapi
 * /bookings/admin:
 *   get:
 *     summary: List all bookings across agencies (ADMIN, read-only oversight)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/admin',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: listBookingsQuerySchema }),
  asyncHandler(bookingController.adminList),
);

/**
 * @openapi
 * /bookings/admin/{id}/no-show:
 *   post: { summary: Record a no-show (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.post(
  '/admin/:id/no-show',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.adminNoShow),
);

/**
 * @openapi
 * /bookings/admin/{id}/resort-cancel:
 *   post: { summary: Resort-initiated cancellation with reason (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.post(
  '/admin/:id/resort-cancel',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: bookingIdParamSchema, body: resortCancelSchema }),
  asyncHandler(bookingController.adminResortCancel),
);

/**
 * @openapi
 * /bookings/admin/rebook-queue:
 *   get: { summary: List commit-failed bookings queued for rebook (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.get('/admin/rebook-queue', authenticate, requireRole('ADMIN'), asyncHandler(bookingController.rebookQueue));

/**
 * @openapi
 * /bookings/admin/rebook/run:
 *   post: { summary: Process the pending rebook queue now (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.post('/admin/rebook/run', authenticate, requireRole('ADMIN'), asyncHandler(bookingController.runRebookQueue));

/**
 * @openapi
 * /bookings/admin/rebook/{id}/retry:
 *   post: { summary: Force-retry a single commit-failed booking (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.post(
  '/admin/rebook/:id/retry',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.retryRebook),
);

/**
 * @openapi
 * /bookings/admin/holds/sweep:
 *   post: { summary: Expire lapsed pay-first holds now (ADMIN), tags: [Bookings], security: [{ bearerAuth: [] }] }
 */
bookingRouter.post('/admin/holds/sweep', authenticate, requireRole('ADMIN'), asyncHandler(bookingController.runHoldSweep));

/**
 * @openapi
 * /bookings/{id}:
 *   get:
 *     summary: Get a booking (AGENT/AGENCY, own agency only)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/:id',
  ...agencySide,
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.getById),
);

/**
 * @openapi
 * /bookings/{id}/voucher:
 *   get:
 *     summary: Download the booking voucher PDF — ?variant=guest (price-free, default) or agent (with prices) (ADMIN any; AGENCY/AGENT own)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/:id/voucher',
  authenticate,
  requireRole('ADMIN', 'AGENCY', 'AGENT'),
  validate({ params: bookingIdParamSchema, query: voucherQuerySchema }),
  asyncHandler(bookingController.voucherPdf),
);

/**
 * @openapi
 * /bookings/{id}/customer-quote:
 *   get:
 *     summary: Customer quotation PDF — agency-branded, sell price only (ADMIN any; AGENCY/AGENT own)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/:id/customer-quote',
  authenticate,
  requireRole('ADMIN', 'AGENCY', 'AGENT'),
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.customerQuotePdf),
);

/**
 * @openapi
 * /bookings/{id}/customer-invoice:
 *   get:
 *     summary: Customer invoice PDF — agency-branded, sell price only (ADMIN any; AGENCY/AGENT own)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.get(
  '/:id/customer-invoice',
  authenticate,
  requireRole('ADMIN', 'AGENCY', 'AGENT'),
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.customerInvoicePdf),
);

/**
 * @openapi
 * /bookings/{id}/pay:
 *   post:
 *     summary: Pay for a pay-first booking, then commit to CRS (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.post(
  '/:id/pay',
  ...agencySide,
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.pay),
);

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   post:
 *     summary: Cancel a booking (reverses CRS if committed) (AGENT/AGENCY)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 */
bookingRouter.post(
  '/:id/cancel',
  ...agencySide,
  validate({ params: bookingIdParamSchema }),
  asyncHandler(bookingController.cancel),
);
