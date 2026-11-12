import { NextFunction, Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';
import { UnauthorizedError } from '../utils/errors';

export async function getOverview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const overview = await dashboardService.getDashboardOverview(req.auth.familyId);
    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
}

