import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { closeRedisConnection, initRedisConnection } from './config/redis';
import { startCallWorker } from './queues/callWorker';
import { shutdownQueueManager } from './queues/queueManager';
import {
  startDailyScheduleGeneratorWorker,
  stopDailyScheduleGeneratorWorker,
} from './queues/scheduleWorker';
import {
  generateDosesAllFamilies,
  recoverPendingCallJobs,
} from './services/scheduleEngine.service';
import { logger } from './utils/logger';

async function bootstrap() {
  await connectDatabase();
  await initRedisConnection();
  await startCallWorker();

  // Recover queued jobs after restart & generate any missing daily doses
  await recoverPendingCallJobs();
  await generateDosesAllFamilies(2);
  startDailyScheduleGeneratorWorker();

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`CareVoice backend listening on port ${env.PORT}`, {
      env: env.NODE_ENV,
      voiceMode: env.VOICE_PROVIDER_MODE,
      telephonyEnabled: env.TELEPHONY_ENABLED,
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopDailyScheduleGeneratorWorker();
    await shutdownQueueManager();
    await closeRedisConnection();

    const forceExitTimer = setTimeout(() => {
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    server.close(async () => {
      clearTimeout(forceExitTimer);
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
