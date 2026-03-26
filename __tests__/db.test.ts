process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../src/app';
import { connectWithRetry, getHealthStatus, getRetryDelay, BASE_DELAY_MS } from '../src/db';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('connectWithRetry', () => {
  it('connects successfully with valid URI', async () => {
    const uri = mongod.getUri();
    await mongoose.disconnect();
    const conn = await connectWithRetry(uri, 0);
    expect(conn.connection.readyState).toBe(1);
  });

  it('throws after exhausting retries on invalid URI', async () => {
    await mongoose.disconnect();
    await expect(
      connectWithRetry('mongodb://invalid-host:27017/test', 0)
    ).rejects.toThrow();
    // Reconnect for remaining tests
    await mongoose.connect(mongod.getUri());
  }, 30_000);

  it('retries before succeeding', async () => {
    await mongoose.disconnect();
    const uri = mongod.getUri();
    const conn = await connectWithRetry(uri, 2);
    expect(conn.connection.readyState).toBe(1);
  });
});

describe('getRetryDelay', () => {
  it('returns exponential backoff delay', () => {
    expect(getRetryDelay(0)).toBe(BASE_DELAY_MS);
    expect(getRetryDelay(1)).toBe(BASE_DELAY_MS * 2);
    expect(getRetryDelay(2)).toBe(BASE_DELAY_MS * 4);
    expect(getRetryDelay(3)).toBe(BASE_DELAY_MS * 8);
  });
});

describe('getHealthStatus', () => {
  it('returns healthy when connected', async () => {
    const health = await getHealthStatus();
    expect(health.status).toBe('healthy');
    expect(health.dbState).toBe('connected');
    expect(typeof health.responseTimeMs).toBe('number');
    expect(health.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when disconnected', async () => {
    await mongoose.disconnect();
    const health = await getHealthStatus();
    expect(health.status).toBe('unhealthy');
    expect(health.dbState).toBe('disconnected');
    // Reconnect for remaining tests
    await mongoose.connect(mongod.getUri());
  });
});

describe('GET /api/health', () => {
  it('returns 200 with healthy status when db is connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.dbState).toBe('connected');
    expect(res.body).toHaveProperty('responseTimeMs');
  });

  it('returns 503 when db is disconnected', async () => {
    await mongoose.disconnect();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    // Reconnect
    await mongoose.connect(mongod.getUri());
  });

  it('does not break existing /health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
