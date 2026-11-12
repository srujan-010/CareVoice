import { NextFunction, Request, Response } from 'express';
import { DoseStatus } from '../constants/statuses';
import { getQueueStatus } from '../queues/queueManager';
import * as medicineService from '../services/medicine.service';
import { UnauthorizedError } from '../utils/errors';

export async function listDoses(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const status = typeof req.query.status === 'string' ? (req.query.status as DoseStatus) : undefined;

    const doses = await medicineService.listDoses(req.auth.familyId, {
      familyMemberId,
      date,
      status,
    });
    res.json({
      success: true,
      data: {
        doses,
        queueStatus: getQueueStatus(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function generateDoses(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const horizonDays = Number(req.body?.horizonDays ?? 2);
    const result = await medicineService.triggerScheduleGenerationForFamily(
      req.auth.familyId,
      Math.min(Math.max(horizonDays, 0), 7)
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateDose(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const dose = await medicineService.updateDoseStatusByCaregiver(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.body
    );
    res.json({ success: true, data: dose });
  } catch (err) {
    next(err);
  }
}

