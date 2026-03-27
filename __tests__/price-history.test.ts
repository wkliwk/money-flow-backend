process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
const USER_ID = 'price_user_123';
const OTHER_USER = 'price_other_456';
const token = jwt.sign({ userId: USER_ID }, 'test-secret');
const otherToken = jwt.sign({ userId: OTHER_USER }, 'test-secret');

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

describe('GET /api/expenses/last-amounts', () => {
  it('returns 401 without auth', async () => {
    await request(app).get('/api/expenses/last-amounts').expect(401);
  });

  it('returns empty map when no transactions', async () => {
    const res = await request(app)
      .get('/api/expenses/last-amounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('returns most recent amount per item', async () => {
    await ExpenseModel.create([
      { owner: USER_ID, item: 'Coffee', amount: 30, date: new Date('2026-01-01'), description: 'Starbucks' },
      { owner: USER_ID, item: 'Coffee', amount: 45, date: new Date('2026-03-01'), description: 'Starbucks' },
      { owner: USER_ID, item: 'Lunch', amount: 80, date: new Date('2026-02-01'), description: 'Cafe' },
    ]);
    const res = await request(app)
      .get('/api/expenses/last-amounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body['coffee']).toBe(45);
    expect(res.body['lunch']).toBe(80);
  });

  it('does not return other users data', async () => {
    await ExpenseModel.create([
      { owner: OTHER_USER, item: 'Dinner', amount: 200, date: new Date('2026-03-01') },
    ]);
    const res = await request(app)
      .get('/api/expenses/last-amounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body['dinner']).toBeUndefined();
  });
});

describe('GET /api/expenses/price-history/:item', () => {
  it('returns 401 without auth', async () => {
    await request(app).get('/api/expenses/price-history/Coffee').expect(401);
  });

  it('returns empty history for unknown item', async () => {
    const res = await request(app)
      .get('/api/expenses/price-history/Unknown')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.history).toEqual([]);
    expect(res.body.stats).toBeNull();
  });

  it('returns price history with stats', async () => {
    await ExpenseModel.create([
      { owner: USER_ID, item: 'Coffee', amount: 30, date: new Date('2026-01-01') },
      { owner: USER_ID, item: 'Coffee', amount: 45, date: new Date('2026-02-01') },
      { owner: USER_ID, item: 'Coffee', amount: 35, date: new Date('2026-03-01') },
    ]);
    const res = await request(app)
      .get('/api/expenses/price-history/Coffee')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.item).toBe('Coffee');
    expect(res.body.history).toHaveLength(3);
    expect(res.body.stats.count).toBe(3);
    expect(res.body.stats.latest).toBe(35);
    expect(res.body.stats.min).toBe(30);
    expect(res.body.stats.max).toBe(45);
    expect(res.body.stats.avg).toBeCloseTo(36.67, 1);
  });

  it('matches case-insensitively', async () => {
    await ExpenseModel.create([
      { owner: USER_ID, item: 'coffee', amount: 30, date: new Date('2026-01-01') },
    ]);
    const res = await request(app)
      .get('/api/expenses/price-history/Coffee')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.history).toHaveLength(1);
  });

  it('respects limit parameter', async () => {
    await ExpenseModel.create(
      Array.from({ length: 5 }, (_, i) => ({
        owner: USER_ID, item: 'Tea', amount: 20 + i, date: new Date(`2026-0${i + 1}-01`),
      }))
    );
    const res = await request(app)
      .get('/api/expenses/price-history/Tea?limit=3')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.history).toHaveLength(3);
  });

  it('isolates by user', async () => {
    await ExpenseModel.create([
      { owner: OTHER_USER, item: 'Coffee', amount: 100, date: new Date('2026-01-01') },
    ]);
    const res = await request(app)
      .get('/api/expenses/price-history/Coffee')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.history).toHaveLength(0);
  });
});
