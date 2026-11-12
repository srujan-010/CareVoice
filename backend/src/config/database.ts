import mongoose, { ClientSession } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let isConnected = false;
let disconnectListenerAttached = false;

function isTransientConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('EREFUSED') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('querySrv') ||
    msg.includes('queryTxt') ||
    msg.includes('MongoServerSelectionError')
  );
}

export async function connectDatabase(dbNameOverride?: string): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const dbName = dbNameOverride ?? env.MONGODB_DB_NAME;

  mongoose.set('strictQuery', true);

  if (!disconnectListenerAttached) {
    disconnectListenerAttached = true;
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
    });
  }

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        dbName,
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      isConnected = true;
      logger.info('Connected to MongoDB Atlas', { dbName });
      return mongoose;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientConnectionError(err)) {
        const delayMs = attempt * 600;
        logger.warn('Transient MongoDB connection/DNS error; retrying', {
          attempt,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB Atlas');
  }
}

export function getDatabaseHealth(): { connected: boolean; state: string } {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  const state = states[mongoose.connection.readyState] ?? 'unknown';
  return {
    connected: mongoose.connection.readyState === 1,
    state,
  };
}

/**
 * Executes a callback inside a MongoDB transaction when supported (replica sets / Atlas),
 * gracefully falling back when running against standalone instances that lack transactions.
 */
export async function withOptionalTransaction<T>(
  fn: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('Transaction numbers are only allowed on a replica set') ||
      message.includes('does not support retryable writes')
    ) {
      logger.warn('MongoDB instance does not support transactions; running sequentially');
      return fn(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

