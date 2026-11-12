import { NextFunction, Request, Response } from 'express';
import * as medicineService from '../services/medicine.service';
import { UnauthorizedError } from '../utils/errors';

export async function listMedicines(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const familyMemberId =
      typeof req.query.familyMemberId === 'string' ? req.query.familyMemberId : undefined;
    const isActiveParam = req.query.isActive;
    const isActive =
      isActiveParam === 'true' ? true : isActiveParam === 'false' ? false : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const data = await medicineService.listMedicines(req.auth.familyId, {
      familyMemberId,
      isActive,
      search,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getMedicine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await medicineService.getMedicineById(
      req.auth.familyId,
      String(req.params.id)
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createMedicine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await medicineService.createMedicine(
      req.auth.familyId,
      req.auth.userId,
      req.body,
      req.ip
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateMedicine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await medicineService.updateMedicine(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.body,
      req.ip
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function deleteMedicine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await medicineService.deleteMedicine(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.ip
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

