import { NextFunction, Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { UnauthorizedError } from '../utils/errors';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.registerFamilyAccount(req.body, req.ip);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.loginUser(req.body, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await authService.logoutUser(req.auth.userId, req.auth.familyId, req.ip);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const session = await authService.getCurrentSession(req.auth.userId, req.auth.familyId);
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
}

export async function listCaregivers(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const users = await authService.listFamilyCaregivers(req.auth.familyId);
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

export async function addCaregiver(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const user = await authService.createFamilyCaregiver(
      req.auth.familyId,
      req.auth.userId,
      req.body,
      req.ip
    );
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateFamilySettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const family = await authService.updateFamilyProfile(
      req.auth.familyId,
      req.auth.userId,
      req.body
    );
    res.json({ success: true, data: family });
  } catch (err) {
    next(err);
  }
}

