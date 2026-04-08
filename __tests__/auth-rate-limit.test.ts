process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ENABLE_RATE_LIMIT = 'true';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 30000);

afterAll(async () => {
  delete process.env.ENABLE_RATE_LIMIT;
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

describe('Auth rate limiting', () => {
  it('returns 429 with correct body and retry-after header after exceeding login limit', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many requests, please try again later');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('returns 429 after exceeding register limit (5 per hour)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/register')
        .send({ email: `user${i}@example.com`, password: 'password123' });
    }

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'extra@example.com', password: 'password123' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many requests, please try again later');
    expect(res.headers['retry-after']).toBeDefined();
  });
});
