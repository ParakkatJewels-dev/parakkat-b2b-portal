import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { accountLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import * as financeController from './finance.controller';

export const financeRouter = Router();

const pageQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
const idParam = z.object({ id: z.string().uuid() });

/**
 * @openapi
 * /finance/balance:
 *   get: { summary: Agency outstanding balance + credit availability, tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get('/balance', authenticate, requireRole('AGENCY', 'AGENT'), asyncHandler(financeController.balance));

/**
 * @openapi
 * /finance/invoices:
 *   get: { summary: List the agency's invoices, tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/invoices',
  authenticate,
  requireRole('AGENCY', 'AGENT'),
  validate({ query: pageQuery }),
  asyncHandler(financeController.invoices),
);

/**
 * @openapi
 * /finance/invoices/{id}/pdf:
 *   get: { summary: Download a GST tax-invoice PDF (ADMIN any; AGENCY/AGENT own), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/invoices/:id/pdf',
  authenticate,
  requireRole('ADMIN', 'AGENCY', 'AGENT'),
  validate({ params: idParam }),
  asyncHandler(financeController.invoicePdf),
);

/**
 * @openapi
 * /finance/statements/credit:
 *   get: { summary: Download the agency's credit statement PDF (AGENCY/AGENT), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/statements/credit',
  authenticate,
  requireRole('AGENCY', 'AGENT'),
  asyncHandler(financeController.creditStatementPdf),
);

/**
 * @openapi
 * /finance/statements/account:
 *   get: { summary: Download the agency's full account statement PDF (AGENCY/AGENT), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/statements/account',
  authenticate,
  requireRole('AGENCY', 'AGENT'),
  asyncHandler(financeController.accountStatementPdf),
);

/**
 * @openapi
 * /finance/invoices/{id}/settle:
 *   post: { summary: Settle (fully or partially) an outstanding credit invoice (AGENCY), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post(
  '/invoices/:id/settle',
  authenticate,
  accountLimiter,
  requireRole('AGENCY'),
  validate({ params: idParam, body: z.object({ amount: z.number().positive().optional() }) }),
  asyncHandler(financeController.settle),
);

/**
 * @openapi
 * /finance/payments:
 *   get: { summary: Recent inbound payments with settlement/chargeback state (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/payments',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: pageQuery }),
  asyncHandler(financeController.payments),
);

/**
 * @openapi
 * /finance/invoices/all:
 *   get: { summary: Invoices across all agencies (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/invoices/all',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: pageQuery }),
  asyncHandler(financeController.allInvoices),
);

/**
 * @openapi
 * /finance/refunds:
 *   get: { summary: Cancellation refunds + chargebacks across all agencies (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/refunds',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: pageQuery }),
  asyncHandler(financeController.refunds),
);

/**
 * @openapi
 * /finance/payments/{id}/chargeback:
 *   post: { summary: Record a chargeback against a settled inbound payment (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post(
  '/payments/:id/chargeback',
  authenticate,
  accountLimiter,
  requireRole('ADMIN'),
  validate({ params: idParam, body: z.object({ reason: z.string().min(3).max(500) }) }),
  asyncHandler(financeController.chargeback),
);

/**
 * @openapi
 * /finance/settlements/agencies:
 *   get: { summary: Credit agencies with live balances, searchable (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/settlements/agencies',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: z.object({ search: z.string().max(120).optional() }) }),
  asyncHandler(financeController.settlementAgencies),
);

/**
 * @openapi
 * /finance/settlements:
 *   post: { summary: Record an offline cash/bank settlement against an agency's credit AR (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post(
  '/settlements',
  authenticate,
  accountLimiter,
  requireRole('ADMIN'),
  validate({
    body: z.object({
      agencyId: z.string().uuid(),
      amount: z.number().positive(),
      method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'OTHER']),
      reference: z.string().max(120).optional(),
      note: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(financeController.recordSettlement),
);

/**
 * @openapi
 * /finance/settlements/agencies/{id}/history:
 *   get: { summary: Offline settlement/advance receipts for an agency (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get(
  '/settlements/agencies/:id/history',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: idParam }),
  asyncHandler(financeController.settlementHistory),
);

/**
 * @openapi
 * /finance/settlements/agencies/{id}/apply-advance:
 *   post: { summary: Apply an agency's unapplied advance/credit to its open invoices (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post(
  '/settlements/agencies/:id/apply-advance',
  authenticate,
  accountLimiter,
  requireRole('ADMIN'),
  validate({ params: idParam }),
  asyncHandler(financeController.applyAdvance),
);

/**
 * @openapi
 * /finance/reconciliation:
 *   get: { summary: Drift report across portal / CRS / CRS (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get('/reconciliation', authenticate, requireRole('ADMIN'), asyncHandler(financeController.reconciliation));

/**
 * @openapi
 * /finance/crs/flush:
 *   post: { summary: Manually flush pending CRS outbox events (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post('/crs/flush', authenticate, requireRole('ADMIN'), asyncHandler(financeController.flushCrs));

/**
 * @openapi
 * /finance/crs/status:
 *   get: { summary: CRS outbox status — event counts + recent events (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.get('/crs/status', authenticate, requireRole('ADMIN'), asyncHandler(financeController.crsStatus));

/**
 * @openapi
 * /finance/dunning/run:
 *   post: { summary: Run dunning — overdue reminders, auto-suspension, credit alerts (ADMIN), tags: [Finance], security: [{ bearerAuth: [] }] }
 */
financeRouter.post('/dunning/run', authenticate, requireRole('ADMIN'), asyncHandler(financeController.dunning));
