import IORedis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redisClient: IORedis | null = null;
let redisAvailable = false;

export async function initRedisConnection(): Promise<IORedis | null> {
  if (!env.REDIS_ENABLED) {
    logger.info('Redis is disabled by REDIS_ENABLED=false; using MongoDB scheduler fallback');
    redisAvailable = false;
    return null;
  }

  try {
    const client = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 2) return null; // Stop retrying if Redis isn't running locally
        return Math.min(times * 300, 1000);
      },
    });

    client.on('error', (err) => {
      if (redisAvailable) {
        logger.warn('Redis connection error', { error: err.message });
      }
      redisAvailable = false;
    });

    await client.connect();
    await client.ping();
    redisClient = client;
    redisAvailable = true;
    logger.info('Connected to Redis for BullMQ job queues');
    return client;
  } catch (err) {
    logger.warn('Redis unreachable; falling back to MongoDB job scheduler', {
      error: err instanceof Error ? err.message : String(err),
    });
    redisClient = null;
    redisAvailable = false;
    return null;
  }
}

export function getRedisClient(): IORedis | null {
  return redisAvailable ? redisClient : null;
}

export function isRedisConnected(): boolean {
  return redisAvailable;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
    redisAvailable = false;
  }
}

