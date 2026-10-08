import path from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config';
import { correlationIdMiddleware } from './middleware/correlationId';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { mountSwagger } from './lib/swagger';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { agenciesRouter } from './modules/agencies/agencies.routes';
import { agentsRouter } from './modules/agents/agents.routes';
import { supportRouter } from './modules/support/support.routes';
import { notificationsRouter } from './modules/notifications/notification.routes';
import { securityRouter } from './modules/security/security.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { healthRouter } from './modules/health/health.routes';
import { onboardingRouter } from './modules/onboarding/onboarding.routes';
import { applicationsRouter } from './modules/applications/applications.routes';
import { applicationActionsRouter } from './modules/applications/actions.routes';
import { verificationRouter } from './modules/verification/verification.routes';
import { commercialRouter } from './modules/commercial/commercial.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { bookingRouter } from './modules/booking/booking.routes';
import { financeRouter } from './modules/finance/finance.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { loadSettings } from './modules/settings/settings.service';
import { cronRouter } from './modules/cron/cron.routes';
import { realtimeRouter } from './modules/realtime/realtime.routes';

export interface CreateAppOptions {
  clientDistDir?: string;
  loadSettingsOnRequest?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const patterns = env.CORS_ORIGIN.split(',').map((s) => s.trim());
        const isAllowed = patterns.some((pattern) => {
          if (pattern.includes('*')) {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\*/g, '[a-zA-Z0-9-]+') + '$';
            const regex = new RegExp(regexStr, 'i');
            return regex.test(origin);
          }
          return pattern === origin;
        });
        callback(null, isAllowed);
      },
      credentials: true,
    }),
  );
  // Capture the raw body so webhook handlers can HMAC-verify the exact bytes
  // Digio signed, while the rest of the app uses the parsed JSON.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(correlationIdMiddleware);
  app.use(requestLogger);

  if (options.loadSettingsOnRequest) {
    const settingsRefreshMs = 30_000;
    let settingsReady: Promise<void> | undefined;
    let settingsLoadedAt = 0;
    app.use((req, _res, next) => {
      if (!req.path.startsWith('/api/') || req.path === '/api/health/live') {
        next();
        return;
      }

      if (!settingsReady && Date.now() - settingsLoadedAt >= settingsRefreshMs) {
        settingsReady = loadSettings()
          .then(() => {
            settingsLoadedAt = Date.now();
          })
          .finally(() => {
            settingsReady = undefined;
          });
      }

      const currentLoad = settingsReady;
      if (currentLoad) {
        void currentLoad.then(() => next(), next);
      } else {
        next();
      }
    });
  }

  app.use(generalLimiter);

  mountSwagger(app);

  app.use('/api/health', healthRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/realtime', realtimeRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/commercial', commercialRouter);
  // More specific mounts first so they take precedence over /applications/:id.
  app.use('/api/applications/:id/verifications', verificationRouter);
  app.use('/api/applications/:id', applicationActionsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/agencies', agenciesRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/security', securityRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/bookings', bookingRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit-logs', auditRouter);

  if (options.clientDistDir) {
    app.use(express.static(options.clientDistDir));
    app.get('*', (req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/') || !req.accepts('html')) {
        next();
        return;
      }
      res.sendFile(path.join(options.clientDistDir!, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
