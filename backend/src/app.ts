import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import routes from './routes';
import { ForbiddenError } from './utils/errors';
import { logger } from './utils/logger';

export function isAllowedOrigin(
  origin: string | undefined,
  configuredFrontendUrl: string
): boolean {
  if (!origin) return true; // allow non-browser / same-origin / server-to-server requests

  const normalized = origin.trim().replace(/\/+$/, '');
  const configured = configuredFrontendUrl
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  // Wildcard allow
  if (configured.includes('*')) {
    return true;
  }

  // Exact match against configured FRONTEND_URL entries
  if (configured.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    return true;
  }

  // Allow all Vercel deployment domains (production, preview branches, PR previews)
  if (/^https:\/\/([a-z0-9_-]+\.)*vercel\.app$/i.test(normalized)) {
    return true;
  }

  // Allow local development and testing origins on any port (localhost / 127.0.0.1)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
    return true;
  }

  return false;
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, env.FRONTEND_URL)) {
          callback(null, true);
        } else {
          logger.warn(`CORS rejected for origin: ${origin}`, {
            configuredFrontendUrl: env.FRONTEND_URL,
          });
          callback(new ForbiddenError(`Origin '${origin}' not allowed by CORS`));
        }
      },
      credentials: true,
    })
  );

  app.use(cookieParser());
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', apiRateLimiter, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

