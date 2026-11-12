import { CallSchedule } from '../models/CallSchedule';
import {
  enqueueCallJob,
  initQueueManager,
  registerCallJobProcessor,
} from './queueManager';
import { executeScheduledCallJob } from '../services/call.service';
import { logger } from '../utils/logger';

export async function pollDueFallbackJobs(): Promise<void> {
  const lookAhead = new Date(Date.now() + 30 * 1000);
  const dueJobs = await CallSchedule.find({
    status: 'QUEUED',
    scheduledFor: { $lte: lookAhead },
  })
    .limit(20)
    .lean();

  for (const job of dueJobs) {
    await enqueueCallJob(
      {
        callScheduleId: String(job._id),
        jobKey: job.jobKey,
        familyId: String(job.familyId),
        callType: job.callType,
      },
      job.scheduledFor
    );
  }
}

export async function startCallWorker(): Promise<{ mode: 'bullmq-redis' | 'mongodb-fallback' }> {
  registerCallJobProcessor(async (payload) => {
    logger.info('Processing call schedule job', {
      callScheduleId: payload.callScheduleId,
      callType: payload.callType,
    });
    await executeScheduledCallJob(payload.callScheduleId);
  });

  const initialized = await initQueueManager(pollDueFallbackJobs);
  if (initialized.mode === 'mongodb-fallback') {
    pollDueFallbackJobs().catch((err) => {
      logger.warn('Initial fallback call poll failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return initialized;
}

