import { NextFunction, Request, Response } from 'express';
import { CallOutcome, CallType } from '../constants/statuses';
import * as callService from '../services/call.service';
import { UnauthorizedError } from '../utils/errors';

export async function listCalls(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;
    const outcome =
      typeof req.query.outcome === 'string' ? (req.query.outcome as CallOutcome) : undefined;
    const callType =
      typeof req.query.callType === 'string' ? (req.query.callType as CallType) : undefined;

    const calls = await callService.listCalls(req.auth.familyId, {
      familyMemberId,
      outcome,
      callType,
    });
    res.json({ success: true, data: calls });
  } catch (err) {
    next(err);
  }
}

export async function getCallDetail(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const detail = await callService.getCallDetail(req.auth.familyId, String(req.params.id));
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
}

export async function simulateCall(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const result = await callService.simulateCallForDose({
      familyId: req.auth.familyId,
      actorUserId: req.auth.userId,
      doseInstanceId: req.body.doseInstanceId,
      callType: req.body.callType,
      scenario: req.body.scenario,
      delayMinutes: req.body.delayMinutes,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function streamRecording(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const recording = await callService.getAuthorizedRecordingAudio(
      req.auth.familyId,
      String(req.params.id)
    );

    if (recording.audioDataBase64) {
      const buffer = Buffer.from(recording.audioDataBase64, 'base64');
      res.setHeader('Content-Type', recording.mimeType || 'audio/wav');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buffer);
      return;
    }

    res.json({
      success: true,
      data: {
        externalUrl: recording.externalUrl,
        mimeType: recording.mimeType,
      },
    });
  } catch (err) {
    next(err);
  }
}

