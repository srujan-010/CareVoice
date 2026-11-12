import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../constants/statuses';
import { User } from '../models/User';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export interface AuthJwtPayload {
  userId: string;
  familyId: string;
  role: UserRole;
  tokenVersion: number;
}

export interface AuthContext {
  userId: string;
  familyId: string;
  role: UserRole;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.cookies?.carevoice_token) {
      token = String(req.cookies.carevoice_token);
    }

    if (!token) {
      throw new UnauthorizedError('Missing authentication token');
    }

    let decoded: AuthJwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as AuthJwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    const user = await User.findById(decoded.userId).lean();
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account not found or inactive');
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      throw new UnauthorizedError('Session has been revoked; please log in again');
    }

    if (String(user.familyId) !== String(decoded.familyId)) {
      throw new UnauthorizedError('Family context mismatch');
    }

    req.auth = {
      userId: String(user._id),
      familyId: String(user.familyId),
      role: user.role,
      email: user.email,
      name: user.name,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function authorizeRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      next(new ForbiddenError(`Role ${req.auth.role} is not permitted for this action`));
      return;
    }
    next();
  };
}

