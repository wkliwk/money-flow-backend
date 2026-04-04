process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { UserModel } from '../src/models/User';
import { RecurringExpenseModel } from '../src/models/RecurringExpense';
import { ExpenseModel } from '../src/models/Expense';
import { processRecurringExpenses, calculateNextOccurrence } from '../src/utils/recurring';

let mongoServer: MongoMemoryServer;
let token: string;
let testUserId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RecurringExpenseModel.deleteMany({});
  await ExpenseModel.deleteMany({});

  // Create test user with valid ObjectId
  const userId = new mongoose.Types.ObjectId();
  testUserId = userId.toString();

  await UserModel.create({
    _id: userId,
    email: `test${Date.now()}@example.com`,
    password: 'hashed_password',
    budgets: [],
  });

  // Generate JWT token for test user
  token = jwt.sign({ userId: testUserId }, 'test-secret');
});

describe('Recurring Expenses', () => {
  it('should create a new recurring expense', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rent',
        amount: 1500,
        category: 'Housing',
        start_date: '2026-01-01',
        frequency: 'MONTHLY',
        description: 'Monthly rent',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Rent');
    expect(res.body.amount).toBe(1500);
    expect(res.body.frequency).toBe('MONTHLY');
  });

  it('should list all recurring expenses for user', async () => {
    // Create two recurring expenses
    await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rent',
        amount: 1500,
        category: 'Housing',
        start_date: '2026-01-01',
        frequency: 'MONTHLY',
      });

    await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Netflix',
        amount: 15,
        category: 'Entertainment',
        start_date: '2026-01-01',
        frequency: 'MONTHLY',
      });

    const res = await request(app)
      .get('/api/recurring')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.recurring).toHaveLength(2);
  });

  it('should update a recurring expense', async () => {
    // Create a recurring expense
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Subscription',
        amount: 10,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    const id = createRes.body._id;

    // Update it
    const updateRes = await request(app)
      .put(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Premium Subscription',
        amount: 20,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Premium Subscription');
    expect(updateRes.body.amount).toBe(20);
  });

  it('should delete a recurring expense', async () => {
    // Create a recurring expense
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Insurance',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    const id = createRes.body._id;

    // Delete it
    const deleteRes = await request(app)
      .delete(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(200);

    // Verify it's gone
    const listRes = await request(app)
      .get('/api/recurring')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.body.recurring).toHaveLength(0);
  });

  it('should validate start_date is before end_date', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Temporary Subscription',
        amount: 50,
        frequency: 'MONTHLY',
        start_date: '2026-12-31',
        end_date: '2026-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should require valid frequency enum', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Invalid',
        amount: 100,
        frequency: 'INVALID_FREQ',
        start_date: '2026-01-01',
      });

    expect(res.status).toBe(400);
  });

  it('should calculate next occurrence correctly for MONTHLY', () => {
    const date = new Date(2026, 0, 15); // January 15, 2026
    const next = calculateNextOccurrence(date, 'MONTHLY');
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1); // February (0-indexed)
    expect(next.getDate()).toBe(15);
  });

  it('should calculate next occurrence correctly for WEEKLY', () => {
    const date = new Date(2026, 0, 1); // January 1, 2026
    const next = calculateNextOccurrence(date, 'WEEKLY');
    expect(next.getDate() - date.getDate()).toBe(7);
  });

  it('should process recurring expenses and generate transactions', async () => {
    // Create a recurring expense starting today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recurring = await RecurringExpenseModel.create({
      userId: testUserId,
      name: 'Daily Coffee',
      amount: 5,
      category: 'Food',
      start_date: today,
      frequency: 'DAILY',
    });

    expect(recurring).toBeDefined();

    // Process recurring expenses
    await processRecurringExpenses();

    // Check if transaction was created
    const expenses = await ExpenseModel.find({ owner: testUserId });
    expect(expenses.length).toBeGreaterThan(0);
    const transaction = expenses.find((e) => e.description?.includes('Daily Coffee'));
    expect(transaction).toBeDefined();
    expect(transaction?.amount).toBe(5);
  });

  it('should not generate transaction if end_date has passed', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Create a recurring expense that ended yesterday
    await RecurringExpenseModel.create({
      userId: testUserId,
      name: 'Old Subscription',
      amount: 10,
      frequency: 'MONTHLY',
      start_date: new Date('2025-01-01'),
      end_date: yesterday,
    });

    // Process recurring expenses
    await processRecurringExpenses();

    // Check that no transaction was created
    const expenses = await ExpenseModel.find({ owner: testUserId });
    expect(expenses.length).toBe(0);
  });

  it('should isolate recurring expenses per user', async () => {
    // Create another user
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const otherToken = jwt.sign({ userId: otherUserId }, 'test-secret');

    // Create recurring for user 1
    await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'User 1 Subscription',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    // Create recurring for user 2
    await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        name: 'User 2 Subscription',
        amount: 200,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    // Check that user 1 only sees their recurring
    const user1Res = await request(app)
      .get('/api/recurring')
      .set('Authorization', `Bearer ${token}`);

    expect(user1Res.body.recurring).toHaveLength(1);
    expect(user1Res.body.recurring[0].name).toBe('User 1 Subscription');
  });

  it('should reject invalid amount', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Invalid',
        amount: -50,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });

    expect(res.status).toBe(400);
  });

  it('should get specific recurring expense', async () => {
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Specific Expense',
        amount: 75,
        frequency: 'QUARTERLY',
        start_date: '2026-01-01',
      });

    const id = createRes.body._id;

    const getRes = await request(app)
      .get(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe('Specific Expense');
  });
});
