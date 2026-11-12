import { NextFunction, Request, Response } from 'express';
import * as callService from '../services/call.service';
import { UnauthorizedError } from '../utils/errors';

export async function getPreflight(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const verifyDeployment =
      req.auth.role === 'ADMIN' && req.query.verifyDeployment === 'true';

    const preflight = await callService.getCallPreflight({ verifyDeployment });
    res.json({ success: true, data: preflight });
  } catch (err) {
    next(err);
  }
}

export async function triggerRealTestCall(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();

    const result = await callService.initiateRealTestCall({
      familyId: req.auth.familyId,
      actorUserId: req.auth.userId,
      familyMemberId: req.body.familyMemberId,
      doseInstanceId: req.body.doseInstanceId,
      callType: req.body.callType,
      purpose: req.body.purpose,
      overrideQuietHours: Boolean(req.body.overrideQuietHours),
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getCallStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const snapshot = await callService.getCallStatusSnapshot(
      req.auth.familyId,
      String(req.params.id)
    );
    res.json({ success: true, data: snapshot });
  } catch (err) {
    next(err);
  }
}

export async function cancelActiveCall(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const cancelled = await callService.cancelActiveRealCall({
      familyId: req.auth.familyId,
      actorUserId: req.auth.userId,
      callLogId: String(req.params.id),
      reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: cancelled });
  } catch (err) {
    next(err);
  }
}
