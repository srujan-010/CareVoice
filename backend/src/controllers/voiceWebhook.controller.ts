import { NextFunction, Request, Response } from 'express';
import * as callService from '../services/call.service';
import type { SarvamOutboundWebhookPayload } from '../services/sarvamVoice.service';

export async function handleSarvamWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = req.body as SarvamOutboundWebhookPayload;
    const result = await callService.processSarvamOutboundWebhook(payload, {
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      idempotent: result.idempotent,
      correlated: result.correlated,
      data: result.detail,
    });
  } catch (err) {
    next(err);
  }
}
