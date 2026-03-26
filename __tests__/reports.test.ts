process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';

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

describe('GET /api/reports/monthly', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/reports/monthly');
    expect(res.status).toBe(401);
  });

  it('returns empty data for new user', async () => {
    const res = await request(app)
      .get('/api/reports/monthly')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('defaults to 6 months', async () => {
    const res = await request(app)
      .get('/api/reports/monthly')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.data.length).toBe(6);
  });

  it('respects months param', async () => {
    const res = await request(app)
      .get('/api/reports/monthly?months=3')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.data.length).toBe(3);
  });

  it('caps at 24 months', async () => {
    const res = await request(app)
      .get('/api/reports/monthly?months=50')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.data.length).toBe(24);
  });

  it('aggregates income and expenses', async () => {
    const now = new Date();
    await ExpenseModel.create([
      { owner: TEST_USER_ID, description: 'Salary', amount: 5000, type: 'income', date: now },
      { owner: TEST_USER_ID, description: 'Rent', amount: 2000, type: 'expense', date: now },
    ]);
    const res = await request(app)
      .get('/api/reports/monthly?months=1')
      .set('Authorization', `Bearer ${authToken}`);
    const m = res.body.data[0];
    expect(m.income).toBe(5000);
    expect(m.expenses).toBe(2000);
    expect(m.net).toBe(3000);
    expect(m.transactionCount).toBe(2);
  });

  it('has correct field structure', async () => {
    const res = await request(app)
      .get('/api/reports/monthly?months=1')
      .set('Authorization', `Bearer ${authToken}`);
    const e = res.body.data[0];
    expect(e.month).toMatch(/^\d{4}-\d{2}$/);
    expect(e).toHaveProperty('income');
    expect(e).toHaveProperty('expenses');
    expect(e).toHaveProperty('net');
    expect(e).toHaveProperty('transactionCount');
  });

  it('zeros for empty months', async () => {
    const res = await request(app)
      .get('/api/reports/monthly?months=2')
      .set('Authorization', `Bearer ${authToken}`);
    for (const e of res.body.data) {
      expect(e.income).toBe(0);
      expect(e.expenses).toBe(0);
    }
  });
});
