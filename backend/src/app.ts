import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import routes from './routes';
import { ForbiddenError } from './utils/errors';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const allowedOrigins = env.FRONTEND_URL.split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : undefined;
        if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
          callback(null, true);
        } else {
          callback(new ForbiddenError('Origin not allowed by CORS'));
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

