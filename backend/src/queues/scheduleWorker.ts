import { generateDosesAllFamilies } from '../services/scheduleEngine.service';
import { logger } from '../utils/logger';

let scheduleTimer: NodeJS.Timeout | null = null;

export function startDailyScheduleGeneratorWorker(): void {
  if (scheduleTimer) return;

  // Run every 30 minutes to ensure rolling dose generation stays populated across timezones/DST
  scheduleTimer = setInterval(() => {
    generateDosesAllFamilies(2).catch((err) => {
      logger.warn('Periodic dose generation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 30 * 60 * 1000);
}

export function stopDailyScheduleGeneratorWorker(): void {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
}

