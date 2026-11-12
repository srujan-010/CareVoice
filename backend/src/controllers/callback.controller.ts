import { NextFunction, Request, Response } from 'express';
import * as callbackService from '../services/callback.service';
import { UnauthorizedError } from '../utils/errors';

export async function listCallbacks(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;
    const data = await callbackService.listCallbacks(req.auth.familyId, {
      status,
      familyMemberId,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createCallback(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const callback = await callbackService.requestSmartCallback({
      familyId: req.auth.familyId,
      familyMemberId: req.body.familyMemberId,
      doseInstanceId: req.body.doseInstanceId,
      sourceCallLogId: req.body.sourceCallLogId,
      delayMinutes: req.body.delayMinutes,
      reason: req.body.reason,
      patientConfirmed: req.body.patientConfirmed,
      actorType: 'USER',
      actorId: req.auth.userId,
    });
    res.status(201).json({ success: true, data: callback });
  } catch (err) {
    next(err);
  }
}

export async function cancelCallback(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const callback = await callbackService.cancelCallback(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId
    );
    res.json({ success: true, data: callback });
  } catch (err) {
    next(err);
  }
}

