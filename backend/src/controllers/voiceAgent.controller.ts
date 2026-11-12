import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { CallLog } from '../models/CallLog';
import * as callService from '../services/call.service';
import * as callbackService from '../services/callback.service';
import * as escalationService from '../services/escalation.service';
import * as sarvamVoiceService from '../services/sarvamVoice.service';
import * as voiceContextService from '../services/voiceContext.service';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors';

export async function getStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    const status = sarvamVoiceService.getVoiceAgentStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

export async function getDoseSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.voiceAgentAuth) throw new UnauthorizedError();

    const context = await voiceContextService.resolveValidatedDoseContext({
      familyMemberId: req.body.familyMemberId,
      doseInstanceId: req.body.doseInstanceId,
      callLogId: req.body.callLogId,
      callScheduleId: req.body.callScheduleId,
      scopedFamilyId: req.voiceAgentAuth.familyId,
      requireActiveCallBinding: req.voiceAgentAuth.mode === 'service-token',
    });

    res.json({ success: true, data: context });
  } catch (err) {
    next(err);
  }
}

export async function requestCallback(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.voiceAgentAuth) throw new UnauthorizedError();

    // Verify patient + dose + call binding first
    const context = await voiceContextService.resolveValidatedDoseContext({
      familyMemberId: req.body.familyMemberId,
      doseInstanceId: req.body.doseInstanceId,
      callLogId: req.body.sourceCallLogId,
      scopedFamilyId: req.voiceAgentAuth.familyId,
      requireActiveCallBinding: req.voiceAgentAuth.mode === 'service-token',
    });

    const callback = await callbackService.requestSmartCallback({
      familyId: context.familyId,
      familyMemberId: context.patient.id,
      doseInstanceId: context.dose.id,
      sourceCallLogId: req.body.sourceCallLogId,
      delayMinutes: req.body.delayMinutes,
      reason: req.body.reason,
      patientConfirmed: req.body.patientConfirmed,
      actorType: req.voiceAgentAuth.mode === 'service-token' ? 'VOICE_AGENT' : 'USER',
      actorId: req.voiceAgentAuth.userId || context.patient.id,
    });

    res.status(201).json({ success: true, data: callback });
  } catch (err) {
    next(err);
  }
}

export async function postCallEvents(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.voiceAgentAuth) throw new UnauthorizedError();

    const updated = await callService.recordExternalCallEvent({
      familyId: req.voiceAgentAuth.familyId,
      callLogId: req.body.callLogId,
      outcome: req.body.outcome,
      durationSeconds: req.body.durationSeconds,
      mealConfirmed: req.body.mealConfirmed,
      medicineConfirmed: req.body.medicineConfirmed,
      feelingUnwell: req.body.feelingUnwell,
      requestedHelp: req.body.requestedHelp,
      turns: req.body.turns,
      aiSummary: req.body.aiSummary,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

export async function createEscalation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.voiceAgentAuth) throw new UnauthorizedError();

    let familyId = req.voiceAgentAuth.familyId;

    if (req.voiceAgentAuth.mode === 'service-token') {
      if (!req.body.callLogId || !Types.ObjectId.isValid(req.body.callLogId)) {
        throw new ForbiddenError('Service-authenticated escalation requires valid callLogId');
      }
      const callLog = await CallLog.findById(req.body.callLogId).lean();
      if (!callLog) throw new NotFoundError('Call log');
      if (String(callLog.familyMemberId) !== req.body.familyMemberId) {
        throw new ForbiddenError('callLogId does not belong to specified familyMemberId');
      }
      familyId = String(callLog.familyId);
    }

    if (!familyId) throw new ForbiddenError('Missing family context');

    const escalation = await escalationService.createEscalation({
      familyId,
      familyMemberId: req.body.familyMemberId,
      doseInstanceId: req.body.doseInstanceId,
      callLogId: req.body.callLogId,
      reason: req.body.reason,
      severity: req.body.severity,
      description: req.body.description,
    });

    res.status(201).json({ success: true, data: escalation });
  } catch (err) {
    next(err);
  }
}

