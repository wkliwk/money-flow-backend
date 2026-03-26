import mongoose from 'mongoose';

const CONNECTION_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;
const MIN_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;

function getRetryDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

async function connectWithRetry(uri: string, retries = MAX_RETRIES): Promise<typeof mongoose> {
  const options: mongoose.ConnectOptions = {
    connectTimeoutMS: CONNECTION_TIMEOUT_MS,
    socketTimeoutMS: SOCKET_TIMEOUT_MS,
    minPoolSize: MIN_POOL_SIZE,
    maxPoolSize: MAX_POOL_SIZE,
    serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(uri, options);
      return conn;
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`MongoDB connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('MongoDB connection failed after all retries');
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  dbState: string;
  responseTimeMs: number;
}

const DB_STATE_MAP: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

async function getHealthStatus(): Promise<HealthStatus> {
  const start = Date.now();
  const state = mongoose.connection.readyState;
  const dbState = DB_STATE_MAP[state] || 'unknown';

  if (state !== 1) {
    return {
      status: 'unhealthy',
      dbState,
      responseTimeMs: Date.now() - start,
    };
  }

  try {
    const admin = mongoose.connection.db?.admin();
    if (admin) {
      await admin.ping();
    }
    return {
      status: 'healthy',
      dbState,
      responseTimeMs: Date.now() - start,
    };
  } catch {
    return {
      status: 'unhealthy',
      dbState: 'ping_failed',
      responseTimeMs: Date.now() - start,
    };
  }
}

export {
  connectWithRetry,
  getHealthStatus,
  getRetryDelay,
  HealthStatus,
  CONNECTION_TIMEOUT_MS,
  MIN_POOL_SIZE,
  MAX_POOL_SIZE,
  MAX_RETRIES,
  BASE_DELAY_MS,
};
