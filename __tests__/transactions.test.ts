process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_123';
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('POST /api/transactions/parse-text', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .send({ text: 'coffee $5' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when text is empty', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when text exceeds 500 chars', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'a'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('parses simple expense "coffee $4.50"', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'coffee $4.50' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(4.5);
    expect(res.body.merchant).toMatch(/coffee/i);
    expect(res.body.category).toBe('food');
    expect(res.body.confidence).toBeGreaterThan(0);
  });

  it('parses expense with participants', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'lunch with Casey $56 each' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(56);
    expect(res.body.participants).toEqual(['Casey']);
    expect(res.body.notes).toMatch(/split/i);
  });

  it('parses Cantonese input', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: '今日同Casey食咗麥當勞 $65', locale: 'zh-HK' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(65);
    expect(res.body.participants).toEqual(['Casey']);
  });

  it('accepts optional locale parameter', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'coffee $5', locale: 'en-US' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(5);
  });

  it('returns confidence and missing_fields', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'something random without numbers' });

    expect(res.status).toBe(200);
    expect(res.body.missing_fields).toContain('amount');
    expect(typeof res.body.confidence).toBe('number');
  });
});
