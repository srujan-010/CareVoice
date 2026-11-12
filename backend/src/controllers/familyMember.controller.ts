import { NextFunction, Request, Response } from 'express';
import * as familyMemberService from '../services/familyMember.service';
import { UnauthorizedError } from '../utils/errors';

export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const isActiveParam = req.query.isActive;
    const isActive =
      isActiveParam === 'true' ? true : isActiveParam === 'false' ? false : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const members = await familyMemberService.listFamilyMembers(req.auth.familyId, {
      isActive,
      search,
    });
    res.json({ success: true, data: members });
  } catch (err) {
    next(err);
  }
}

export async function createMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const member = await familyMemberService.createFamilyMember(
      req.auth.familyId,
      req.auth.userId,
      req.auth.name,
      req.body,
      req.ip
    );
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function getMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const member = await familyMemberService.getFamilyMemberById(
      req.auth.familyId,
      String(req.params.id)
    );
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function getMemberProfile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await familyMemberService.getFamilyMemberProfile(
      req.auth.familyId,
      String(req.params.id)
    );
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}

export async function updateMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const member = await familyMemberService.updateFamilyMember(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.auth.name,
      req.body,
      req.ip
    );
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function updateConsent(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const consent = await familyMemberService.updateMemberConsent(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.auth.name,
      req.body
    );
    res.json({ success: true, data: consent });
  } catch (err) {
    next(err);
  }
}

export async function toggleMemberStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const isActive = Boolean(req.body.isActive);
    const member = await familyMemberService.setFamilyMemberActiveStatus(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      isActive,
      req.ip
    );
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function deleteMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const result = await familyMemberService.deleteFamilyMember(
      req.auth.familyId,
      String(req.params.id),
      req.auth.userId,
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

