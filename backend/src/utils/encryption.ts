import crypto from 'crypto';
import { env } from '../config/env';

export function signRecordingToken(callLogId: string, familyId: string, expiresAtMs: number): string {
  const payload = `${callLogId}:${familyId}:${expiresAtMs}`;
  const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

export function verifyRecordingToken(token: string, expectedCallLogId: string, expectedFamilyId: string): boolean {
  const parts = token.split(':');
  if (parts.length !== 4) return false;
  const [callLogId, familyId, expiresStr, sig] = parts;
  if (callLogId !== expectedCallLogId || familyId !== expectedFamilyId) return false;
  if (Date.now() > Number(expiresStr)) return false;

  const expectedSig = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${callLogId}:${familyId}:${expiresStr}`)
    .digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

