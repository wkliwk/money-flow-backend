process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';
import RecurringExpenseModel from '../src/models/RecurringExpense';
import ExpenseModel from '../src/models/Expense';
import {
  calculateNextOccurrence,
  processRecurringExpenses,
  validateRecurringData,
} from '../src/utils/recurring';

let mongoServer: MongoMemoryServer;
let token: string;
let testUserId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RecurringExpenseModel.deleteMany({});
  await ExpenseModel.deleteMany({});

  const userId = new mongoose.Types.ObjectId();
  testUserId = userId.toString();
  await UserModel.create({
    _id: userId,
    email: `recurring-cov-${Date.now()}@example.com`,
    password: 'hashed_password',
    budgets: [],
  });
  token = jwt.sign({ userId: testUserId }, 'test-secret');
}, 15000);

describe('calculateNextOccurrence', () => {
  it('calculates DAILY correctly', () => {
    const date = new Date(2026, 0, 15);
    const next = calculateNextOccurrence(date, 'DAILY');
    expect(next.getDate()).toBe(16);
  });

  it('calculates QUARTERLY correctly', () => {
    const date = new Date(2026, 0, 15); // Jan 15
    const next = calculateNextOccurrence(date, 'QUARTERLY');
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(15);
  });

  it('calculates YEARLY correctly', () => {
    const date = new Date(2026, 5, 15); // June 15, 2026
    const next = calculateNextOccurrence(date, 'YEARLY');
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(15);
  });

  it('handles MONTHLY with Jan 31 (caps to Feb 28)', () => {
    const date = new Date(2026, 0, 31); // Jan 31
    const next = calculateNextOccurrence(date, 'MONTHLY');
    // Jan 31 + 1 month = Feb 28 (capped to last day of Feb)
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(28);
  });

  it('handles MONTHLY with a normal date (Jan 15 -> Feb 15)', () => {
    const date = new Date(2026, 0, 15); // Jan 15
    const next = calculateNextOccurrence(date, 'MONTHLY');
    expect(next.getMonth()).toBe(1); // Feb
    expect(next.getDate()).toBe(15);
  });

  it('handles QUARTERLY with Jan 31 (caps to Apr 30)', () => {
    const date = new Date(2026, 0, 31); // Jan 31
    const next = calculateNextOccurrence(date, 'QUARTERLY');
    // Jan 31 + 3 months = Apr 30 (capped to last day of April)
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(30);
  });
});

describe('validateRecurringData', () => {
  it('returns valid for correct data', () => {
    const result = validateRecurringData({
      name: 'Rent',
      amount: 1500,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing name', () => {
    const result = validateRecurringData({
      amount: 100,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required and must be a non-empty string');
  });

  it('rejects empty string name', () => {
    const result = validateRecurringData({
      name: '   ',
      amount: 100,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects non-string name', () => {
    const result = validateRecurringData({
      name: 123,
      amount: 100,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing amount', () => {
    const result = validateRecurringData({
      name: 'Test',
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('amount is required and must be a positive number');
  });

  it('rejects zero amount', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 0,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: -10,
      start_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing start_date', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('start_date is required');
  });

  it('rejects invalid start_date', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: 'not-a-date',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('start_date must be a valid date');
  });

  it('rejects invalid end_date', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: '2026-01-01',
      end_date: 'invalid',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('end_date must be a valid date');
  });

  it('rejects end_date before start_date', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: '2026-06-01',
      end_date: '2026-01-01',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('end_date must be after start_date');
  });

  it('accepts valid end_date after start_date', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      frequency: 'MONTHLY',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing frequency', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: '2026-01-01',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid frequency', () => {
    const result = validateRecurringData({
      name: 'Test',
      amount: 100,
      start_date: '2026-01-01',
      frequency: 'BIWEEKLY',
    });
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors', () => {
    const result = validateRecurringData({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('processRecurringExpenses', () => {
  it('does not generate transaction for future start_date', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);

    await RecurringExpenseModel.create({
      userId: testUserId,
      name: 'Future Sub',
      amount: 10,
      category: 'Entertainment',
      start_date: future,
      frequency: 'MONTHLY',
    });

    await processRecurringExpenses();

    const expenses = await ExpenseModel.find({ owner: testUserId });
    expect(expenses).toHaveLength(0);
  });

  it('does not duplicate transaction if already generated today', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await RecurringExpenseModel.create({
      userId: testUserId,
      name: 'Daily Coffee',
      amount: 5,
      category: 'Food',
      start_date: today,
      frequency: 'DAILY',
    });

    // Run twice
    await processRecurringExpenses();
    await processRecurringExpenses();

    const expenses = await ExpenseModel.find({
      owner: testUserId,
    });
    // Should only have 1 -- processedUntil ensures idempotency
    expect(expenses).toHaveLength(1);
  });

  it('handles per-item errors gracefully', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await RecurringExpenseModel.create({
      userId: testUserId,
      name: 'Test',
      amount: 5,
      category: 'Food',
      start_date: today,
      frequency: 'DAILY',
    });

    // Mock ExpenseModel.create to throw for the first call
    const origCreate = ExpenseModel.create;
    jest.spyOn(ExpenseModel, 'create').mockRejectedValueOnce(new Error('create fail'));

    await processRecurringExpenses();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RecurringProcessor] Error processing'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

describe('Recurring routes - edge cases', () => {
  it('GET /api/recurring/:id returns 404 for nonexistent', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .get(`/api/recurring/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('PUT /api/recurring/:id returns 404 for nonexistent', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/recurring/${fakeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/recurring/:id returns 404 for nonexistent', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/recurring/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/recurring rejects missing name', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('PUT /api/recurring/:id rejects invalid data', async () => {
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    const id = createRes.body._id;

    const res = await request(app)
      .put(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated',
        amount: 'not-a-number',
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('PUT /api/recurring/:id rejects end_date before start_date via validateRecurringData', async () => {
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    const id = createRes.body._id;

    const res = await request(app)
      .put(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated',
        amount: 50,
        frequency: 'MONTHLY',
        start_date: '2026-12-01',
        end_date: '2026-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('POST /api/recurring creates with end_date', async () => {
    const res = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Temp Sub',
        amount: 50,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        category: 'Entertainment',
        description: 'Temporary subscription',
      });
    expect(res.status).toBe(201);
    expect(res.body.end_date).toBeDefined();
    expect(res.body.description).toBe('Temporary subscription');
  });

  it('PUT /api/recurring/:id updates with end_date and description', async () => {
    const createRes = await request(app)
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sub',
        amount: 100,
        frequency: 'MONTHLY',
        start_date: '2026-01-01',
      });
    const id = createRes.body._id;

    const res = await request(app)
      .put(`/api/recurring/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sub Updated',
        amount: 120,
        frequency: 'QUARTERLY',
        start_date: '2026-01-01',
        end_date: '2027-01-01',
        category: 'Bills',
        description: 'Updated desc',
      });
    expect(res.status).toBe(200);
    expect(res.body.frequency).toBe('QUARTERLY');
    expect(res.body.description).toBe('Updated desc');
  });
});
