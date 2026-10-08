import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '../../config/env';
import { runDunningJob, runMaintenanceJobs, type JobRunResult } from '../../lib/scheduler';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/apiError';

export const cronRouter = Router();

function authorizeCron(req: Request): void {
  if (!env.CRON_SECRET) {
    throw ApiError.serviceUnavailable('CRON_SECRET is not configured');
  }

  const actual = Buffer.from(req.header('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw ApiError.unauthorized('Invalid cron credentials');
  }
}

function statusFor(results: JobRunResult[]): number {
  return results.some((result) => result.status === 'failed') ? 500 : 200;
}

cronRouter.get(
  '/maintenance',
  asyncHandler(async (req, res) => {
    authorizeCron(req);
    const results = await runMaintenanceJobs();
    res.status(statusFor(results)).json({ results });
  }),
);

cronRouter.get(
  '/dunning',
  asyncHandler(async (req, res) => {
    authorizeCron(req);
    const result = await runDunningJob();
    res.status(statusFor([result])).json({ results: [result] });
  }),
);
