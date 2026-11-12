import { NextFunction, Request, Response } from 'express';
import { EscalationStatus } from '../constants/statuses';
import * as escalationService from '../services/escalation.service';
import { UnauthorizedError } from '../utils/errors';

export async function listEscalations(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status =
      typeof req.query.status === 'string'
        ? (req.query.status as EscalationStatus)
        : undefined;
    const data = await escalationService.listEscalations(req.auth.familyId, status);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateEscalation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await escalationService.updateEscalationStatus(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.body
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

