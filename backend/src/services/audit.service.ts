import { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog';
import { logger } from '../utils/logger';

export interface RecordAuditInput {
  familyId?: Types.ObjectId | string;
  actorType: 'USER' | 'VOICE_AGENT' | 'SYSTEM' | 'WEBHOOK';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await AuditLog.create({
      familyId: input.familyId ? new Types.ObjectId(String(input.familyId)) : undefined,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ipAddress: input.ipAddress,
      metadata: input.metadata,
    });
  } catch (err) {
    logger.warn('Failed to persist audit log', {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

