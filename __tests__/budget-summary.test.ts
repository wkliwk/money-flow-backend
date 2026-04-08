process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
let authToken: string;
let userId: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const res = await request(app)
    .post('/auth/register')
    .send({ email: 'budget@test.com', password: 'password123' });
  authToken = res.body.token;

  const user = await UserModel.findOne({ email: 'budget@test.com' });
  userId = user!._id.toString();
  // Set baseCurrency to HKD so test expenses (schema default HKD) aren't converted
  await UserModel.findByIdAndUpdate(userId, { baseCurrency: 'HKD' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await ExpenseModel.deleteMany({});
  await UserModel.findByIdAndUpdate(userId, { budgets: [] });
});

describe('GET /api/reports/budget-summary', () => {
  it('returns budget vs actual for current month', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      budgets: [
        { category: 'Food', limit: 500 },
        { category: 'Transport', limit: 200 },
      ],
    });

    const now = new Date();
    await ExpenseModel.create([
      { owner: userId, amount: 150, type: 'expense', category: 'Food', date: now },
      { owner: userId, amount: 100, type: 'expense', category: 'Food', date: now },
      { owner: userId, amount: 80, type: 'expense', category: 'Transport', date: now },
    ]);

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.totalBudgeted).toBe(700);
    expect(res.body.totalSpent).toBe(330);
    expect(res.body.totalRemaining).toBe(370);

    const food = res.body.data.find((d: { category: string }) => d.category === 'Food');
    expect(food.spent).toBe(250);
    expect(food.budgetLimit).toBe(500);
    expect(food.percentUsed).toBe(50);
    expect(food.overBudget).toBe(false);
  });

  it('flags over-budget categories', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      budgets: [{ category: 'Shopping', limit: 100 }],
    });

    const now = new Date();
    await ExpenseModel.create({
      owner: userId, amount: 150, type: 'expense', category: 'Shopping', date: now,
    });

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.body.data[0].overBudget).toBe(true);
    expect(res.body.data[0].percentUsed).toBe(150);
    expect(res.body.data[0].remaining).toBe(-50);
  });

  it('includes categories with spending but no budget', async () => {
    const now = new Date();
    await ExpenseModel.create({
      owner: userId, amount: 50, type: 'expense', category: 'Entertainment', date: now,
    });

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].category).toBe('Entertainment');
    expect(res.body.data[0].spent).toBe(50);
    expect(res.body.data[0].budgetLimit).toBe(0);
  });

  it('returns empty data when no budgets and no spending', async () => {
    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.totalBudgeted).toBe(0);
    expect(res.body.totalSpent).toBe(0);
  });

  it('filters by specific month', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      budgets: [{ category: 'Food', limit: 300 }],
    });

    await ExpenseModel.create([
      { owner: userId, amount: 100, type: 'expense', category: 'Food', date: new Date('2026-02-15') },
      { owner: userId, amount: 200, type: 'expense', category: 'Food', date: new Date('2026-03-15') },
    ]);

    const res = await request(app)
      .get('/api/reports/budget-summary?month=2026-02')
      .set('Authorization', `Bearer ${authToken}`);

    const food = res.body.data.find((d: { category: string }) => d.category === 'Food');
    expect(food.spent).toBe(100);
  });

  it('rejects invalid month format', async () => {
    const res = await request(app)
      .get('/api/reports/budget-summary?month=invalid')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/reports/budget-summary');
    expect(res.status).toBe(401);
  });

  it('sorts by percentUsed descending', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      budgets: [
        { category: 'Food', limit: 500 },
        { category: 'Transport', limit: 100 },
      ],
    });

    const now = new Date();
    await ExpenseModel.create([
      { owner: userId, amount: 100, type: 'expense', category: 'Food', date: now },
      { owner: userId, amount: 90, type: 'expense', category: 'Transport', date: now },
    ]);

    const res = await request(app)
      .get('/api/reports/budget-summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.body.data[0].category).toBe('Transport');
    expect(res.body.data[1].category).toBe('Food');
  });
});
