// Integration tests for participants field in POST/PUT /api/expenses
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

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

const basePayload = {
  owner: TEST_USER_ID,
  description: 'Test expense',
  amount: 100,
  type: 'expense',
  category: 'Other',
};

describe('POST /api/expenses — participants field', () => {
  it('accepts valid participants array', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: ['Alice', 'Bob'] });
    expect(res.status).toBe(201);
    expect(res.body.participants).toEqual(['Alice', 'Bob']);
  });

  it('accepts empty participants array', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: [] });
    expect(res.status).toBe(201);
    expect(res.body.participants).toEqual([]);
  });

  it('defaults to [] when participants field is missing', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send(basePayload);
    expect(res.status).toBe(201);
    expect(res.body.participants).toEqual([]);
  });

  it('rejects non-array value', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: 'Alice' });
    expect(res.status).toBe(400);
  });

  it('rejects empty string in array', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: [''] });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate names (case-insensitive)', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: ['Alice', 'alice'] });
    expect(res.status).toBe(400);
  });

  it('rejects array exceeding 20 items', async () => {
    const big = Array.from({ length: 21 }, (_, i) => `Person${i}`);
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: big });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/expenses/:id — participants field', () => {
  let expenseId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: ['Alice'] });
    expenseId = res.body._id;
  });

  it('updates participants successfully', async () => {
    const res = await request(app)
      .put(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: ['Alice', 'Charlie'] });
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual(expect.arrayContaining(['Alice', 'Charlie']));
  });

  it('rejects duplicate names on update', async () => {
    const res = await request(app)
      .put(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: ['Alice', 'alice'] });
    expect(res.status).toBe(400);
  });

  it('rejects name over 100 chars on update', async () => {
    const longName = 'a'.repeat(101);
    const res = await request(app)
      .put(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, participants: [longName] });
    expect(res.status).toBe(400);
  });
});
