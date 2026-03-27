process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'analytics_user_123';
const OTHER_USER_ID = 'analytics_other_456';
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');
const otherToken = jwt.sign({ userId: OTHER_USER_ID }, 'test-secret');

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

async function seed(docs: object[]) {
  await ExpenseModel.insertMany(docs);
}

describe('GET /api/expenses/analytics', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/expenses/analytics');
    expect(res.status).toBe(401);
  });

  it('rejects invalid month format', async () => {
    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-13')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM/);
  });

  it('returns zeros for empty data', async () => {
    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-01')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalIncome).toBe(0);
    expect(res.body.totalExpense).toBe(0);
    expect(res.body.netBalance).toBe(0);
    expect(res.body.categoryBreakdown).toEqual([]);
    expect(res.body.dailyTotals).toEqual([]);
  });

  it('returns correct totals for a specific month', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 300, type: 'income', category: 'Salary', date: new Date('2024-03-05') },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-10') },
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Transport', date: new Date('2024-03-15') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalIncome).toBe(300);
    expect(res.body.totalExpense).toBe(150);
    expect(res.body.netBalance).toBe(150);
  });

  it('returns categoryBreakdown sorted by total desc with percentages', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Food', date: new Date('2024-03-01') },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-02') },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Transport', date: new Date('2024-03-03') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    const breakdown = res.body.categoryBreakdown;
    expect(breakdown[0].category).toBe('Food');
    expect(breakdown[0].total).toBe(300);
    expect(breakdown[0].count).toBe(2);
    expect(breakdown[0].percentage).toBe(75);
    expect(breakdown[1].category).toBe('Transport');
    expect(breakdown[1].total).toBe(100);
    expect(breakdown[1].percentage).toBe(25);
  });

  it('returns dailyTotals grouped by date', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-10') },
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Transport', date: new Date('2024-03-10') },
      { owner: TEST_USER_ID, amount: 200, type: 'income', category: 'Salary', date: new Date('2024-03-15') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    const daily = res.body.dailyTotals;
    const mar10 = daily.find((d: { date: string }) => d.date === '2024-03-10');
    const mar15 = daily.find((d: { date: string }) => d.date === '2024-03-15');
    expect(mar10.expense).toBe(150);
    expect(mar10.income).toBe(0);
    expect(mar15.income).toBe(200);
    expect(mar15.expense).toBe(0);
  });

  it('only returns data for the authenticated user', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-01') },
      { owner: OTHER_USER_ID, amount: 999, type: 'expense', category: 'Food', date: new Date('2024-03-01') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalExpense).toBe(100);
  });

  it('excludes expenses outside the requested month', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-15') },
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Food', date: new Date('2024-04-01') },
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Food', date: new Date('2024-02-28') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalExpense).toBe(100);
  });

  it('defaults to current month when month param is omitted', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    await seed([
      { owner: TEST_USER_ID, amount: 75, type: 'expense', category: 'Food', date: thisMonth },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalExpense).toBe(75);
  });

  it('other user token sees only their own data', async () => {
    await seed([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: new Date('2024-03-01') },
    ]);

    const res = await request(app)
      .get('/api/expenses/analytics?month=2024-03')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalExpense).toBe(0);
  });
});
