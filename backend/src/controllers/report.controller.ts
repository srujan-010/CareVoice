import { NextFunction, Request, Response } from 'express';
import * as reportService from '../services/report.service';
import { UnauthorizedError } from '../utils/errors';

export async function getReports(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const periodParam = req.query.period;
    const period: reportService.ReportPeriod =
      periodParam === 'daily' || periodParam === 'monthly' ? periodParam : 'weekly';
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;

    const report = await reportService.generateAdherenceReport(req.auth.familyId, {
      period,
      familyMemberId,
    });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

