import { NextFunction, Request, Response } from 'express';
import { CallLifecycleStatus, CallOutcome, CallType } from '../constants/statuses';
import * as callService from '../services/call.service';
import { UnauthorizedError } from '../utils/errors';

export async function listCalls(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;
    const outcome =
      typeof req.query.outcome === 'string' ? (req.query.outcome as CallOutcome) : undefined;
    const callStatus =
      typeof req.query.callStatus === 'string'
        ? (req.query.callStatus as CallLifecycleStatus)
        : undefined;
    const callType =
      typeof req.query.callType === 'string'
        ? (req.query.callType as CallType | 'ADMIN_TEST_CALL')
        : undefined;
    const mode =
      req.query.mode === 'mock' || req.query.mode === 'live' ? req.query.mode : undefined;
    const dateFrom =
      typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : undefined;
    const dateTo =
      typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : undefined;
    const isTestCall =
      req.query.isTestCall === 'true'
        ? true
        : req.query.isTestCall === 'false'
          ? false
          : undefined;

    const calls = await callService.listCalls(req.auth.familyId, {
      familyMemberId,
      outcome,
      callStatus,
      callType,
      isTestCall,
      mode,
      dateFrom,
      dateTo,
    });
    res.json({ success: true, data: calls });
  } catch (err) {
    next(err);
  }
}

export async function getTodayCallStats(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const stats = await callService.getTodaysLiveCallStats(req.auth.familyId);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

export async function getCallDetail(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const reconcile = req.query.reconcile === 'true';
    const detail = await callService.getCallDetail(req.auth.familyId, String(req.params.id), {
      reconcile,
    });
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

    const isDownload = req.query.download === 'true';
    const mime = recording.mimeType || 'audio/wav';
    const ext = mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('ogg') ? 'ogg' : 'wav';

    if (recording.audioBuffer) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', recording.audioBuffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      if (isDownload) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="carevoice-call-${String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')}.${ext}"`
        );
      }
      res.send(recording.audioBuffer);
      return;
    }

    if (recording.audioDataBase64) {
      const buffer = Buffer.from(recording.audioDataBase64, 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      if (isDownload) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="carevoice-call-${String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')}.${ext}"`
        );
      }
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

