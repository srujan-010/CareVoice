import { Job, Queue, Worker } from 'bullmq';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { logger } from '../utils/logger';

export interface CallJobPayload {
  callScheduleId: string;
  jobKey: string;
  familyId: string;
  callType: string;
}

type CallProcessorFn = (payload: CallJobPayload) => Promise<void>;

const CALL_QUEUE_NAME = 'carevoice-call-jobs';

let bullQueue: Queue<CallJobPayload> | null = null;
let bullWorker: Worker<CallJobPayload> | null = null;
let processorFn: CallProcessorFn | null = null;
const fallbackTimers = new Map<string, NodeJS.Timeout>();
const inFlightFallbackJobs = new Set<string>();
let fallbackPoller: NodeJS.Timeout | null = null;

export function registerCallJobProcessor(fn: CallProcessorFn): void {
  processorFn = fn;
}

export async function initQueueManager(
  onPollDueJobs?: () => Promise<void>
): Promise<{ mode: 'bullmq-redis' | 'mongodb-fallback' }> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    bullQueue = new Queue<CallJobPayload>(CALL_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    });

    bullWorker = new Worker<CallJobPayload>(
      CALL_QUEUE_NAME,
      async (job: Job<CallJobPayload>) => {
        if (processorFn) {
          await processorFn(job.data);
        }
      },
      {
        connection: redis,
        concurrency: 5,
      }
    );

    bullWorker.on('failed', (job, err) => {
      logger.error('BullMQ call job failed', {
        jobId: job?.id,
        error: err.message,
      });
    });

    logger.info('BullMQ Queue & Worker initialized with Redis');
    return { mode: 'bullmq-redis' };
  }

  // MongoDB fallback poller for environments without Redis
  if (onPollDueJobs && !fallbackPoller) {
    fallbackPoller = setInterval(() => {
      onPollDueJobs().catch((err) => {
        logger.warn('Fallback scheduler poll error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 15000);
  }

  logger.info('QueueManager initialized in MongoDB scheduler fallback mode');
  return { mode: 'mongodb-fallback' };
}

export async function enqueueCallJob(
  payload: CallJobPayload,
  scheduledFor: Date
): Promise<void> {
  const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());

  if (bullQueue && isRedisConnected()) {
    await bullQueue.add(payload.callType, payload, {
      jobId: payload.jobKey,
      delay: delayMs,
    });
    return;
  }

  // Fallback timer for near-future jobs (<= 1 hour)
  if (
    delayMs <= 60 * 60 * 1000 &&
    !fallbackTimers.has(payload.jobKey) &&
    !inFlightFallbackJobs.has(payload.jobKey)
  ) {
    const timer = setTimeout(() => {
      fallbackTimers.delete(payload.jobKey);
      if (inFlightFallbackJobs.has(payload.jobKey)) return;
      if (processorFn) {
        inFlightFallbackJobs.add(payload.jobKey);
        processorFn(payload)
          .catch((err) => {
            logger.error('Fallback call job execution failed', {
              callScheduleId: payload.callScheduleId,
              error: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => {
            inFlightFallbackJobs.delete(payload.jobKey);
          });
      }
    }, delayMs);
    fallbackTimers.set(payload.jobKey, timer);
  }
}

export async function removeCallJob(jobKey: string): Promise<void> {
  if (bullQueue && isRedisConnected()) {
    try {
      const existing = await bullQueue.getJob(jobKey);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may already be active or gone
    }
  }

  const timer = fallbackTimers.get(jobKey);
  if (timer) {
    clearTimeout(timer);
    fallbackTimers.delete(jobKey);
  }
}

export function getQueueStatus(): {
  mode: 'bullmq-redis' | 'mongodb-fallback';
  redisConnected: boolean;
  pendingFallbackTimers: number;
} {
  return {
    mode: bullQueue && isRedisConnected() ? 'bullmq-redis' : 'mongodb-fallback',
    redisConnected: isRedisConnected(),
    pendingFallbackTimers: fallbackTimers.size,
  };
}

export async function shutdownQueueManager(): Promise<void> {
  if (fallbackPoller) {
    clearInterval(fallbackPoller);
    fallbackPoller = null;
  }
  for (const timer of fallbackTimers.values()) {
    clearTimeout(timer);
  }
  fallbackTimers.clear();

  if (bullWorker) {
    await bullWorker.close();
    bullWorker = null;
  }
  if (bullQueue) {
    await bullQueue.close();
    bullQueue = null;
  }
}

