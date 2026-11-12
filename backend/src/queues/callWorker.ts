import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import {
  enqueueCallJob,
  initQueueManager,
  registerCallJobProcessor,
} from './queueManager';
import { executeScheduledCallJob } from '../services/call.service';
import { logger } from '../utils/logger';

const STALE_DISPATCH_MS = 2 * 60 * 1000;
const MISSED_WINDOW_MS = 30 * 60 * 1000;

/**
 * Recovers scheduled call jobs after a backend restart:
 * - Resolves stale DISPATCHED claims against CallLog so jobs are neither stuck forever nor blindly double-dialed.
 * - Re-queues interrupted pre-CallLog claims within a 30-minute window; marks older missed windows SKIPPED.
 * - Re-enqueues any due QUEUED jobs (never re-enqueues FAILED/nonRetryable jobs).
 */
export async function recoverScheduledCallsOnStartup(
  referenceNow = new Date()
): Promise<{
  requeuedStale: number;
  reconciledDispatched: number;
  skippedExpired: number;
  dueEnqueued: number;
}> {
  const staleBefore = new Date(referenceNow.getTime() - STALE_DISPATCH_MS);
  const expiredCutoff = new Date(referenceNow.getTime() - MISSED_WINDOW_MS);

  const staleJobs = await CallSchedule.find({
    status: 'DISPATCHED',
    $or: [
      { dispatchedAt: { $lte: staleBefore } },
      { dispatchedAt: { $exists: false }, updatedAt: { $lte: staleBefore } },
    ],
  }).limit(50);

  let requeuedStale = 0;
  let reconciledDispatched = 0;
  let skippedExpired = 0;

  for (const job of staleJobs) {
    const existingLog = await CallLog.findOne({ callScheduleId: job._id }).lean();

    if (existingLog) {
      const isFailure =
        existingLog.callStatus === 'FAILED' || existingLog.callStatus === 'LANGUAGE_UNAVAILABLE';
      job.status = isFailure ? 'FAILED' : 'COMPLETED';
      job.completedAt = existingLog.endedAt || referenceNow;
      job.errorCategory = existingLog.errorCategory;
      if (isFailure && !existingLog.failureReason) {
        job.failureReason = 'Call interrupted before completion during server restart';
      } else if (existingLog.failureReason) {
        job.failureReason = existingLog.failureReason;
      }
      if (existingLog.errorCategory && existingLog.errorCategory !== 'PROVIDER_ERROR') {
        job.nonRetryable = true;
      }
      await job.save();
      reconciledDispatched += 1;
      continue;
    }

    if (!job.nonRetryable && job.scheduledFor.getTime() >= expiredCutoff.getTime()) {
      job.status = 'QUEUED';
      job.dispatchedAt = undefined;
      job.failureReason = 'Recovered after backend restart prior to provider dispatch';
      await job.save();
      requeuedStale += 1;
    } else {
      job.status = 'SKIPPED';
      job.failureReason = 'Missed scheduled execution window across backend restart';
      await job.save();
      skippedExpired += 1;
    }
  }

  // Enqueue any overdue or due QUEUED jobs safely
  const dueEnqueued = await pollDueFallbackJobs(referenceNow);

  logger.info('Completed startup call schedule recovery', {
    requeuedStale,
    reconciledDispatched,
    skippedExpired,
    dueEnqueued,
  });

  return {
    requeuedStale,
    reconciledDispatched,
    skippedExpired,
    dueEnqueued,
  };
}

export async function pollDueFallbackJobs(referenceNow = new Date()): Promise<number> {
  const lookAhead = new Date(referenceNow.getTime() + 30 * 1000);
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
  return dueJobs.length;
}

export async function startCallWorker(): Promise<{ mode: 'bullmq-redis' | 'mongodb-fallback' }> {
  registerCallJobProcessor(async (payload) => {
    logger.info('Processing call schedule job', {
      callScheduleId: payload.callScheduleId,
      callType: payload.callType,
    });
    await executeScheduledCallJob(payload.callScheduleId);
  });

  const initialized = await initQueueManager(async () => {
    await pollDueFallbackJobs();
  });
  recoverScheduledCallsOnStartup().catch((err) => {
    logger.warn('Initial scheduled call recovery failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return initialized;
}

