import { NextFunction, Request, Response } from 'express';
import { NotificationChannel } from '../constants/statuses';
import * as notificationService from '../services/notification.service';
import { UnauthorizedError } from '../utils/errors';

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const channel =
      typeof req.query.channel === 'string'
        ? (req.query.channel as NotificationChannel)
        : undefined;
    const unreadOnly = req.query.unreadOnly === 'true';

    const data = await notificationService.listNotifications(req.auth.familyId, {
      channel,
      unreadOnly,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await notificationService.markNotificationRead(
      req.auth.familyId,
      String(req.params.id)
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await notificationService.markAllNotificationsRead(req.auth.familyId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

