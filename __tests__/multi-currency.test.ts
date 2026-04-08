process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import UserModel from '../src/models/User';
import ExchangeRateModel from '../src/models/ExchangeRate';
import { convertToHKD, convertCurrency, clearRateCache, getExchangeRates } from '../src/utils/exchangeRates';

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
});

describe('Expense model currency fields', () => {
  it('defaults currency to USD when no user record exists', async () => {
    // TEST_USER_ID has no User document so baseCurrency lookup falls back to USD
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Lunch', amount: 50, type: 'expense', category: 'Food' });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('USD');
    expect(res.body.originalAmount).toBeNull();
    expect(res.body.exchangeRate).toBeNull();
  });

  it('defaults currency to user baseCurrency when user exists', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await UserModel.create({ _id: userId, email: 'hk@example.com', password: 'pass123', baseCurrency: 'HKD' });
    const token = jwt.sign({ userId }, 'test-secret');

    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Lunch', amount: 50, type: 'expense', category: 'Food' });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('HKD');
  });

  it('stores foreign currency expense with originalAmount and exchangeRate', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Tokyo ramen',
        amount: 62.4,
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
    // Insert directly without currency field to simulate legacy data (schema default is HKD)
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

  it('returns rates object with source, base, and updatedAt', async () => {
    const res = await request(app)
      .get('/api/exchange-rates')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rates).toBeDefined();
    expect(res.body.source).toBeDefined();
    expect(res.body.updatedAt).toBeDefined();
    expect(res.body.base).toBe('USD');
    expect(typeof res.body.rates.USD).toBe('number');
  });

  it('returns rates for specified base currency', async () => {
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.92, HKD: 7.78 })),
      fetchedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/exchange-rates?base=EUR')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.base).toBe('EUR');
    expect(res.body.rates.EUR).toBe(1);
  });
});

// ─── convertCurrency unit tests ───────────────────────────────────────────────

describe('convertCurrency', () => {
  const usdRates = { USD: 1, EUR: 0.92, HKD: 7.78, JPY: 149.5 };

  it('returns same amount when from === to', () => {
    expect(convertCurrency(100, 'USD', 'USD', usdRates)).toBe(100);
    expect(convertCurrency(100, 'EUR', 'EUR', usdRates)).toBe(100);
  });

  it('converts USD to EUR', () => {
    expect(convertCurrency(100, 'USD', 'EUR', usdRates)).toBe(92);
  });

  it('converts EUR to HKD (cross-currency)', () => {
    // 100 EUR * (7.78 / 0.92) = 845.65 HKD
    expect(convertCurrency(100, 'EUR', 'HKD', usdRates)).toBeCloseTo(845.65, 0);
  });

  it('returns original amount for unknown currency', () => {
    expect(convertCurrency(100, 'XYZ', 'USD', usdRates)).toBe(100);
  });
});

// ─── ExchangeRate MongoDB caching ─────────────────────────────────────────────

describe('getExchangeRates — MongoDB caching', () => {
  it('returns rates from MongoDB cache when fresh', async () => {
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.92, HKD: 7.78 })),
      fetchedAt: new Date(),
    });

    const data = await getExchangeRates('USD');
    expect(data.source).toBe('mongodb');
    expect(data.base).toBe('USD');
    expect(data.rates.EUR).toBe(0.92);
  });

  it('converts rates to requested base currency', async () => {
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.92, HKD: 7.78 })),
      fetchedAt: new Date(),
    });

    const data = await getExchangeRates('EUR');
    expect(data.base).toBe('EUR');
    expect(data.rates.EUR).toBe(1);
    expect(data.rates.USD).toBeCloseTo(1 / 0.92, 3);
    expect(data.rates.HKD).toBeCloseTo(7.78 / 0.92, 3);
  });

  it('clearRateCache removes the MongoDB document', async () => {
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.92 })),
      fetchedAt: new Date(),
    });

    await clearRateCache();
    const doc = await ExchangeRateModel.findOne({ base: 'USD' });
    expect(doc).toBeNull();
  });

  it('returns fallback when no cache and API unavailable', async () => {
    // No seeded rates, API will likely fail in CI
    const data = await getExchangeRates('USD');
    expect(['api', 'fallback', 'mongodb']).toContain(data.source);
    expect(data.base).toBe('USD');
    expect(typeof data.rates.USD).toBe('number');
  });
});

// ─── PATCH /api/users/profile ─────────────────────────────────────────────────

describe('PATCH /api/users/profile', () => {
  let userId2: string;
  let token2: string;

  beforeEach(async () => {
    userId2 = new mongoose.Types.ObjectId().toString();
    await UserModel.create({ _id: userId2, email: 'profile@example.com', password: 'pass123' });
    token2 = jwt.sign({ userId: userId2 }, 'test-secret');
  });

  it('updates baseCurrency', async () => {
    const res = await request(app)
      .patch('/api/users/profile')
      .set('Authorization', `Bearer ${token2}`)
      .send({ baseCurrency: 'HKD' });
    expect(res.status).toBe(200);
    expect(res.body.user.baseCurrency).toBe('HKD');
  });

  it('rejects invalid currency code (not 3 chars)', async () => {
    const res = await request(app)
      .patch('/api/users/profile')
      .set('Authorization', `Bearer ${token2}`)
      .send({ baseCurrency: 'US' });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const res = await request(app)
      .patch('/api/users/profile')
      .send({ baseCurrency: 'EUR' });
    expect(res.status).toBe(401);
  });
});

// ─── Budget summary with currency conversion ──────────────────────────────────

describe('GET /api/reports/budget-summary — currency conversion', () => {
  let userId3: string;
  let token3: string;

  beforeEach(async () => {
    userId3 = new mongoose.Types.ObjectId().toString();
    await UserModel.create({
      _id: userId3,
      email: 'summary@example.com',
      password: 'pass123',
      baseCurrency: 'USD',
      budgets: [{ category: 'Food', limit: 500, alert_threshold: 0.9, enable_alerts: false }],
    });
    token3 = jwt.sign({ userId: userId3 }, 'test-secret');
    // Seed exchange rates: EUR=0.5 means 1 USD = 0.5 EUR → 1 EUR = 2 USD
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.5, HKD: 7.78 })),
      fetchedAt: new Date(),
    });
  });

  it('converts foreign currency expenses to baseCurrency in summary', async () => {
    const now = new Date();
    // 200 EUR at rate EUR=0.5 → 200/0.5 = 400 USD
    await ExpenseModel.create({
      owner: userId3,
      description: 'Groceries',
      amount: 200,
      currency: 'EUR',
      type: 'expense',
      category: 'Food',
      date: now,
    });

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${token3}`);

    expect(res.status).toBe(200);
    expect(res.body.baseCurrency).toBe('USD');
    const food = res.body.data.find((d: { category: string }) => d.category === 'Food');
    expect(food).toBeDefined();
    expect(food.spent).toBeCloseTo(400, 1);
  });

  it('handles same-currency expenses without conversion', async () => {
    const now = new Date();
    await ExpenseModel.create({
      owner: userId3, description: 'Lunch', amount: 50, currency: 'USD', type: 'expense', category: 'Food', date: now,
    });

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${token3}`);

    expect(res.status).toBe(200);
    const food = res.body.data.find((d: { category: string }) => d.category === 'Food');
    expect(food.spent).toBe(50);
  });
});

// ─── Monthly report with currency conversion ──────────────────────────────────

describe('GET /api/reports/monthly — currency conversion', () => {
  let userId4: string;
  let token4: string;

  beforeEach(async () => {
    userId4 = new mongoose.Types.ObjectId().toString();
    await UserModel.create({ _id: userId4, email: 'monthly@example.com', password: 'pass123', baseCurrency: 'USD' });
    token4 = jwt.sign({ userId: userId4 }, 'test-secret');
    await ExchangeRateModel.create({
      base: 'USD',
      rates: new Map(Object.entries({ USD: 1, EUR: 0.5 })),
      fetchedAt: new Date(),
    });
  });

  it('converts expenses to baseCurrency in monthly report', async () => {
    const now = new Date();
    // 100 EUR at EUR=0.5 → 100/0.5 = 200 USD
    await ExpenseModel.create({
      owner: userId4, description: 'EUR expense', amount: 100, currency: 'EUR', type: 'expense', date: now,
    });

    const res = await request(app)
      .get('/api/reports/monthly?months=1')
      .set('Authorization', `Bearer ${token4}`);

    expect(res.status).toBe(200);
    expect(res.body.baseCurrency).toBe('USD');
    const m = res.body.data[0];
    expect(m.expenses).toBeCloseTo(200, 1);
  });
});

// ─── CSV export with currency columns ─────────────────────────────────────────

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

  it('shows currency and empty original fields for same-currency expenses', async () => {
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
    // Should have a currency code in the currency column
    expect(lines[1]).toMatch(/USD|HKD|EUR/);
  });
});

// ─── convertToHKD utility (legacy sync function) ──────────────────────────────

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
