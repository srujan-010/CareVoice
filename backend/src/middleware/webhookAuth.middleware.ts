import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../models/User';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { AuthJwtPayload } from './auth.middleware';

declare global {
  namespace Express {
    interface Request {
      voiceAgentAuth?: {
        mode: 'user-jwt' | 'service-token';
        familyId?: string;
        userId?: string;
      };
      rawBody?: Buffer;
    }
  }
}

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Protects /api/voice-agent/* endpoints.
 * Requires EITHER a valid caregiver/admin JWT OR the backend VOICE_AGENT_INTERNAL_TOKEN.
 * Unauthenticated callers are always rejected (401).
 */
export async function authenticateVoiceAgent(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const serviceToken = req.headers['x-voice-agent-token'];
    if (typeof serviceToken === 'string' && serviceToken.length > 0) {
      if (!timingSafeMatch(serviceToken, env.VOICE_AGENT_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Invalid voice agent service token');
      }
      req.voiceAgentAuth = { mode: 'service-token' };
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : req.cookies?.carevoice_token
          ? String(req.cookies.carevoice_token)
          : '';

    if (!token) {
      throw new UnauthorizedError('Voice agent authentication required');
    }

    let decoded: AuthJwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as AuthJwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await User.findById(decoded.userId).lean();
    if (!user || !user.isActive || user.tokenVersion !== decoded.tokenVersion) {
      throw new UnauthorizedError('User session inactive or revoked');
    }

    req.auth = {
      userId: String(user._id),
      familyId: String(user.familyId),
      role: user.role,
      email: user.email,
      name: user.name,
    };
    req.voiceAgentAuth = {
      mode: 'user-jwt',
      familyId: String(user.familyId),
      userId: String(user._id),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verifies inbound Sarvam Voice Agent webhook requests without assuming undocumented headers.
 * Supports:
 * 1) High-entropy secret webhook route token (/api/voice-agent/webhook/sarvam/:webhookToken)
 * 2) Header token (X-Webhook-Token or Authorization: Bearer <SARVAM_WEBHOOK_TOKEN>)
 * 3) Optional HMAC-SHA256 verification (X-Sarvam-Signature / X-Webhook-Signature) if SARVAM_WEBHOOK_SECRET is configured
 */
export function verifySarvamWebhookAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const hasRouteTokenConfig = env.SARVAM_WEBHOOK_TOKEN.length >= 24;
    const hasHmacConfig = env.SARVAM_WEBHOOK_SECRET.length > 0;

    if (!hasRouteTokenConfig && !hasHmacConfig) {
      throw new ForbiddenError(
        'Webhook rejected: configure SARVAM_WEBHOOK_TOKEN (or SARVAM_WEBHOOK_SECRET) on backend'
      );
    }

    const routeToken =
      typeof req.params.webhookToken === 'string' ? req.params.webhookToken.trim() : '';
    const headerToken =
      typeof req.headers['x-webhook-token'] === 'string'
        ? req.headers['x-webhook-token'].trim()
        : typeof req.headers.authorization === 'string' &&
            req.headers.authorization.startsWith('Bearer ')
          ? req.headers.authorization.slice(7).trim()
          : '';

    const candidateToken = routeToken || headerToken;

    if (routeToken) {
      if (!hasRouteTokenConfig || !timingSafeMatch(routeToken, env.SARVAM_WEBHOOK_TOKEN)) {
        throw new UnauthorizedError('Invalid Sarvam webhook route token');
      }
      next();
      return;
    }

    if (candidateToken && hasRouteTokenConfig) {
      if (!timingSafeMatch(candidateToken, env.SARVAM_WEBHOOK_TOKEN)) {
        throw new UnauthorizedError('Invalid webhook authentication token');
      }
      next();
      return;
    }

    const signatureHeader =
      (req.headers['x-sarvam-signature'] as string | undefined) ||
      (req.headers['x-webhook-signature'] as string | undefined);

    if (signatureHeader && hasHmacConfig) {
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const expectedHex = crypto
        .createHmac('sha256', env.SARVAM_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      const providedHex = signatureHeader.replace(/^sha256=/i, '').trim();
      if (!timingSafeMatch(providedHex, expectedHex)) {
        throw new UnauthorizedError('Webhook signature verification failed');
      }
      next();
      return;
    }

    throw new UnauthorizedError('Missing valid Sarvam webhook authentication');
  } catch (err) {
    next(err);
  }
}

export const verifySarvamWebhookSignature = verifySarvamWebhookAuth;
