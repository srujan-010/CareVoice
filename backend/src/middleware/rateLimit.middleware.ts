import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const isTest = env.NODE_ENV === 'test';

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests; please wait a few minutes and try again.',
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many authentication attempts; please try again shortly.',
  },
});

export const voiceWebhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: isTest ? 5000 : 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'VOICE_RATE_LIMITED',
    message: 'Voice agent request limit exceeded.',
  },
});

