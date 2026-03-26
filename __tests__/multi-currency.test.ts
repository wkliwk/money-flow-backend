process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import { convertToHKD, clearRateCache } from '../src/utils/exchangeRates';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_currency_test';
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
  clearRateCache();
});

describe('Expense model currency fields', () => {
  it('defaults currency to HKD when not specified', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Lunch', amount: 50, type: 'expense', category: 'Food' });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('HKD');
    expect(res.body.originalAmount).toBeNull();
    expect(res.body.exchangeRate).toBeNull();
  });

  it('stores foreign currency expense with originalAmount and exchangeRate', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Tokyo ramen',
        amount: 62.4, // HKD equivalent
        type: 'expense',
        category: 'Food',
        currency: 'JPY',
        originalAmount: 1200,
        exchangeRate: 0.052,
      });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('JPY');
    expect(res.body.originalAmount).toBe(1200);
    expect(res.body.exchangeRate).toBe(0.052);
    expect(res.body.amount).toBe(62.4);
  });

  it('rejects invalid currency code', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Bad currency',
        amount: 100,
        type: 'expense',
        currency: 'XYZ',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/currency must be one of/);
  });

  it('updates currency fields via PUT', async () => {
    const create = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Original', amount: 100, type: 'expense' });

    const res = await request(app)
      .put(`/api/expenses/${create.body._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Updated',
        amount: 78,
        type: 'expense',
        currency: 'USD',
        originalAmount: 10,
        exchangeRate: 7.8,
      });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.originalAmount).toBe(10);
    expect(res.body.exchangeRate).toBe(7.8);
  });

  it('existing expenses without currency default to HKD on read', async () => {
    // Insert directly without currency field to simulate legacy data
    await ExpenseModel.create({
      owner: TEST_USER_ID,
      description: 'Legacy expense',
      amount: 200,
    });

    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].currency).toBe('HKD');
    expect(res.body.data[0].originalAmount).toBeNull();
  });
});

describe('GET /api/exchange-rates', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/exchange-rates');
    expect(res.status).toBe(401);
  });

  it('returns rates object with source and updatedAt', async () => {
    const res = await request(app)
      .get('/api/exchange-rates')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rates).toBeDefined();
    expect(res.body.source).toBeDefined();
    expect(res.body.updatedAt).toBeDefined();
    expect(typeof res.body.rates.USD).toBe('number');
    expect(typeof res.body.rates.JPY).toBe('number');
    expect(typeof res.body.rates.CNY).toBe('number');
  });
});

describe('CSV export with currency columns', () => {
  it('includes currency headers and data in CSV', async () => {
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'USD purchase',
        amount: 78,
        type: 'expense',
        category: 'Shopping',
        currency: 'USD',
        originalAmount: 10,
        exchangeRate: 7.8,
      });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Amount (HKD)');
    expect(res.text).toContain('Currency');
    expect(res.text).toContain('Original Amount');
    expect(res.text).toContain('Exchange Rate');
    expect(res.text).toContain('USD');
    expect(res.text).toContain('10');
    expect(res.text).toContain('7.8');
  });

  it('shows HKD and empty original fields for HKD expenses', async () => {
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Local food', amount: 50, type: 'expense' });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(2);
    // HKD expense should have HKD in currency column and empty original/rate
    expect(lines[1]).toContain('HKD');
  });
});

describe('convertToHKD utility', () => {
  it('returns same amount for HKD', () => {
    expect(convertToHKD(100, 'HKD', 1)).toBe(100);
  });

  it('converts foreign currency to HKD', () => {
    expect(convertToHKD(10, 'USD', 7.8)).toBe(78);
  });

  it('rounds to 2 decimal places', () => {
    expect(convertToHKD(1000, 'JPY', 0.052)).toBe(52);
    expect(convertToHKD(100, 'EUR', 8.537)).toBe(853.7);
  });
});

describe('Dashboard aggregation backward compatibility', () => {
  it('monthly report aggregates amount field (always HKD)', async () => {
    // Create one HKD and one foreign currency expense
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Local meal',
        amount: 50,
        type: 'expense',
        category: 'Food',
        date: new Date().toISOString(),
      });

    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Japan meal',
        amount: 62.4,
        type: 'expense',
        category: 'Food',
        currency: 'JPY',
        originalAmount: 1200,
        exchangeRate: 0.052,
        date: new Date().toISOString(),
      });

    const res = await request(app)
      .get('/api/reports/monthly?months=1')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const currentMonth = res.body.data[res.body.data.length - 1];
    // Both expenses should be summed in HKD: 50 + 62.4 = 112.4
    expect(currentMonth.expenses).toBeCloseTo(112.4, 1);
  });
});
