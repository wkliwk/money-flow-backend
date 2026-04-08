process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../src/app';
import { getRetryDelay, getHealthStatus, BASE_DELAY_MS, CONNECTION_TIMEOUT_MS, MIN_POOL_SIZE, MAX_POOL_SIZE } from '../src/db';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('getRetryDelay', () => {
  it('returns exponential backoff delay', () => {
    expect(getRetryDelay(0)).toBe(BASE_DELAY_MS);
    expect(getRetryDelay(1)).toBe(BASE_DELAY_MS * 2);
    expect(getRetryDelay(2)).toBe(BASE_DELAY_MS * 4);
    expect(getRetryDelay(3)).toBe(BASE_DELAY_MS * 8);
  });
});

describe('connection config constants', () => {
  it('has correct timeout and pool settings', () => {
    expect(CONNECTION_TIMEOUT_MS).toBe(10_000);
    expect(MIN_POOL_SIZE).toBe(5);
    expect(MAX_POOL_SIZE).toBe(10);
  });
});

describe('getHealthStatus', () => {
  it('returns healthy when connected', async () => {
    const health = await getHealthStatus();
    expect(health.status).toBe('healthy');
    expect(health.dbState).toBe('connected');
    expect(typeof health.responseTimeMs).toBe('number');
  });
});

describe('GET /api/health', () => {
  it('returns 200 with healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.dbState).toBe('connected');
    expect(res.body).toHaveProperty('responseTimeMs');
  });

  it('preserves existing /health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
