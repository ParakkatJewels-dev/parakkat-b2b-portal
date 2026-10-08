import { env } from '../config/env';
import { logger } from './logger';
import { prisma } from './prisma';
import { expireStaleHolds, processRebookQueue } from '../modules/booking/booking.service';
import { flushOutbox } from '../modules/finance/crsOutbox.service';
import { runDunning } from '../modules/finance/dunning.service';

/**
 * In-process scheduler for the portal's periodic maintenance jobs. Without it,
 * these only ran inline / on manual admin trigger, so lapsed holds, failed CRS
 * postings and queued rebooks could linger indefinitely. Each job is:
 *  - isolated: a throwing job is logged and never crashes the process;
 *  - non-overlapping: a job that's still running skips its next tick;
 *  - unref'd: timers don't keep the process alive, so shutdown stays clean.
 * Manual endpoints remain the source of truth for on-demand runs; this just
 * drives them on a timer. Disable with SCHEDULER_ENABLED=false.
 */

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

export interface JobRunResult {
  name: string;
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
  result?: unknown;
  error?: string;
}

let timers: NodeJS.Timeout[] = [];
const running = new Set<string>();

async function tick(job: Job): Promise<JobRunResult> {
  if (running.has(job.name)) {
    logger.warn(`[scheduler] ${job.name} still running from a previous tick; skipping`);
    return { name: job.name, status: 'skipped', durationMs: 0 };
  }
  running.add(job.name);
  const startedAt = Date.now();
  try {
    const result = await job.run();
    const durationMs = Date.now() - startedAt;
    logger.info(`[scheduler] ${job.name} completed`, { ms: durationMs, result });
    return { name: job.name, status: 'completed', durationMs, result };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`[scheduler] ${job.name} failed`, {
      ms: durationMs,
      error,
    });
    return { name: job.name, status: 'failed', durationMs, error };
  } finally {
    running.delete(job.name);
  }
}

/**
 * Dunning writes audit/agency changes and so needs an actor. A scheduled run is
 * attributed to the earliest ADMIN with role SYSTEM. If no admin exists yet
 * (fresh DB), the run is skipped rather than failing.
 */
async function resolveSystemActor(): Promise<{ actorId: string; actorRole: 'SYSTEM' } | null> {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return admin ? { actorId: admin.id, actorRole: 'SYSTEM' } : null;
}

const maintenanceJobs: Job[] = [
  {
    name: 'hold-sweep',
    intervalMs: env.HOLD_SWEEP_INTERVAL_SECONDS * 1000,
    run: () => expireStaleHolds(),
  },
  {
    name: 'crs-outbox-flush',
    intervalMs: env.CRS_FLUSH_INTERVAL_SECONDS * 1000,
    run: () => flushOutbox(),
  },
  {
    name: 'rebook-queue',
    intervalMs: env.REBOOK_QUEUE_INTERVAL_SECONDS * 1000,
    run: () => processRebookQueue(),
  },
];

const dunningJob: Job = {
  name: 'dunning',
  intervalMs: env.DUNNING_INTERVAL_SECONDS * 1000,
  run: async () => {
    const actor = await resolveSystemActor();
    if (!actor) return { skipped: 'no ADMIN user to attribute the run to' };
    return runDunning(actor);
  },
};

export async function runMaintenanceJobs(): Promise<JobRunResult[]> {
  const results: JobRunResult[] = [];
  for (const job of maintenanceJobs) results.push(await tick(job));
  return results;
}

export function runDunningJob(): Promise<JobRunResult> {
  return tick(dunningJob);
}

export function startScheduler(): void {
  if (env.NODE_ENV === 'test') return;
  if (!env.SCHEDULER_ENABLED) {
    logger.info('[scheduler] disabled (SCHEDULER_ENABLED=false)');
    return;
  }

  for (const job of [...maintenanceJobs, dunningJob]) {
    const timer = setInterval(() => void tick(job), job.intervalMs);
    timer.unref();
    timers.push(timer);
    logger.info(`[scheduler] scheduled ${job.name} every ${job.intervalMs / 1000}s`);
  }
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
