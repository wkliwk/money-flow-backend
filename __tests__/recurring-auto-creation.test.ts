process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JOBS_API_KEY = 'test-jobs-key';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app';
import RecurringExpenseModel from '../src/models/RecurringExpense';
import ExpenseModel from '../src/models/Expense';
import { processRecurringExpenses, calculateNextOccurrence } from '../src/utils/recurring';

let mongoServer: MongoMemoryServer;
const testUserId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await RecurringExpenseModel.deleteMany({});
  await ExpenseModel.deleteMany({});
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('Recurring Expense Auto-Creation', () => {
  describe('Basic expense generation', () => {
    it('creates an expense when a daily recurring is due', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Coffee',
        amount: 5,
        category: 'Food',
        start_date: today(),
        frequency: 'DAILY',
      });

      const result = await processRecurringExpenses();

      expect(result.processed).toBe(1);
      expect(result.expensesCreated).toBe(1);

      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount).toBe(5);
      expect(expenses[0].category).toBe('Food');
    });

    it('creates an expense for monthly recurring due today', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Netflix',
        amount: 15.99,
        category: 'Entertainment',
        start_date: today(),
        frequency: 'MONTHLY',
      });

      const result = await processRecurringExpenses();

      expect(result.expensesCreated).toBe(1);
      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses[0].amount).toBe(15.99);
    });

    it('does not create expenses for future start_date', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Future Sub',
        amount: 10,
        start_date: daysFromNow(30),
        frequency: 'MONTHLY',
      });

      const result = await processRecurringExpenses();
      expect(result.processed).toBe(0);
      expect(result.expensesCreated).toBe(0);
    });

    it('does not create expenses for expired recurring', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Old Sub',
        amount: 10,
        start_date: daysAgo(60),
        end_date: daysAgo(1),
        frequency: 'MONTHLY',
      });

      const result = await processRecurringExpenses();
      expect(result.expensesCreated).toBe(0);
    });

    it('does not create expenses for inactive recurring', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Paused Sub',
        amount: 10,
        start_date: today(),
        frequency: 'MONTHLY',
        active: false,
      });

      const result = await processRecurringExpenses();
      expect(result.processed).toBe(0);
      expect(result.expensesCreated).toBe(0);
    });
  });

  describe('nextDueDate advancement', () => {
    it('advances nextDueDate after processing a daily recurring', async () => {
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Daily Coffee',
        amount: 5,
        start_date: today(),
        frequency: 'DAILY',
      });

      await processRecurringExpenses();

      const updated = await RecurringExpenseModel.findById(rec._id);
      const expectedNext = calculateNextOccurrence(today(), 'DAILY');
      expect(updated?.nextDueDate.toDateString()).toBe(expectedNext.toDateString());
    });

    it('advances nextDueDate for monthly frequency', async () => {
      const startDate = today();
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Monthly Sub',
        amount: 20,
        start_date: startDate,
        frequency: 'MONTHLY',
      });

      await processRecurringExpenses();

      const updated = await RecurringExpenseModel.findById(rec._id);
      const expectedNext = calculateNextOccurrence(startDate, 'MONTHLY');
      expect(updated?.nextDueDate.toDateString()).toBe(expectedNext.toDateString());
    });

    it('sets lastProcessedDate after processing', async () => {
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Sub',
        amount: 10,
        start_date: today(),
        frequency: 'WEEKLY',
      });

      await processRecurringExpenses();

      const updated = await RecurringExpenseModel.findById(rec._id);
      expect(updated?.lastProcessedDate).toBeDefined();
    });

    it('sets processedUntil to the date of the created expense', async () => {
      const startDate = today();
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Sub',
        amount: 10,
        start_date: startDate,
        frequency: 'WEEKLY',
      });

      await processRecurringExpenses();

      const updated = await RecurringExpenseModel.findById(rec._id);
      expect(updated?.processedUntil?.toDateString()).toBe(startDate.toDateString());
    });
  });

  describe('Back-creation of missed expenses', () => {
    it('creates 3 back-dated daily expenses if server was down 3 days', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Daily Vitamin',
        amount: 1,
        start_date: daysAgo(3),
        frequency: 'DAILY',
      });

      const result = await processRecurringExpenses();

      // Should create expenses for 3 days ago, 2 days ago, 1 day ago, and today = 4
      expect(result.expensesCreated).toBe(4);

      const expenses = await ExpenseModel.find({ owner: testUserId }).sort({ date: 1 });
      expect(expenses).toHaveLength(4);
    });

    it('creates back-dated weekly expenses for missed weeks', async () => {
      // Started 3 weeks ago, never processed
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Weekly Lesson',
        amount: 50,
        start_date: daysAgo(21),
        frequency: 'WEEKLY',
      });

      const result = await processRecurringExpenses();

      // 3 weeks ago, 2 weeks ago, 1 week ago, today = 4
      expect(result.expensesCreated).toBe(4);
    });

    it('creates back-dated monthly expenses when processedUntil is behind', async () => {
      // Recurring started 3 months ago, processedUntil set to 2 months ago
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      threeMonthsAgo.setHours(0, 0, 0, 0);

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      twoMonthsAgo.setHours(0, 0, 0, 0);

      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Monthly Insurance',
        amount: 100,
        start_date: threeMonthsAgo,
        frequency: 'MONTHLY',
        processedUntil: twoMonthsAgo,
        nextDueDate: calculateNextOccurrence(twoMonthsAgo, 'MONTHLY'),
      });

      const result = await processRecurringExpenses();

      // Should create expenses for 1 month ago and today = 2
      expect(result.expensesCreated).toBe(2);
    });
  });

  describe('Idempotency', () => {
    it('does not create duplicate expenses on double run', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Netflix',
        amount: 15.99,
        start_date: today(),
        frequency: 'MONTHLY',
      });

      // First run
      const result1 = await processRecurringExpenses();
      expect(result1.expensesCreated).toBe(1);

      // Second run -- should create nothing
      const result2 = await processRecurringExpenses();
      expect(result2.expensesCreated).toBe(0);

      // Only 1 expense total
      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses).toHaveLength(1);
    });

    it('remains idempotent with back-created expenses', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Daily Vitamin',
        amount: 1,
        start_date: daysAgo(2),
        frequency: 'DAILY',
      });

      // First run: creates 3 expenses (2 days ago, yesterday, today)
      const result1 = await processRecurringExpenses();
      expect(result1.expensesCreated).toBe(3);

      // Second run: creates nothing
      const result2 = await processRecurringExpenses();
      expect(result2.expensesCreated).toBe(0);

      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses).toHaveLength(3);
    });
  });

  describe('calculateNextOccurrence', () => {
    it('handles DAILY frequency', () => {
      const d = new Date(2026, 3, 1); // April 1, 2026
      const next = calculateNextOccurrence(d, 'DAILY');
      expect(next.getDate()).toBe(2);
    });

    it('handles WEEKLY frequency', () => {
      const d = new Date(2026, 3, 1);
      const next = calculateNextOccurrence(d, 'WEEKLY');
      expect(next.getDate()).toBe(8);
    });

    it('handles MONTHLY frequency with month-end capping', () => {
      const d = new Date(2026, 0, 31); // Jan 31
      const next = calculateNextOccurrence(d, 'MONTHLY');
      expect(next.getMonth()).toBe(1); // February
      expect(next.getDate()).toBe(28); // Feb 28 (2026 is not a leap year)
    });

    it('handles QUARTERLY frequency', () => {
      const d = new Date(2026, 0, 15); // Jan 15
      const next = calculateNextOccurrence(d, 'QUARTERLY');
      expect(next.getMonth()).toBe(3); // April
      expect(next.getDate()).toBe(15);
    });

    it('handles YEARLY frequency', () => {
      const d = new Date(2026, 5, 15); // June 15, 2026
      const next = calculateNextOccurrence(d, 'YEARLY');
      expect(next.getFullYear()).toBe(2027);
      expect(next.getMonth()).toBe(5);
    });
  });

  describe('POST /api/recurring/process endpoint', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).post('/api/recurring/process');
      expect(res.status).toBe(401);
    });

    it('returns 401 with wrong API key', async () => {
      const res = await request(app)
        .post('/api/recurring/process')
        .set('x-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('processes recurring expenses with valid API key', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Test Sub',
        amount: 10,
        start_date: today(),
        frequency: 'MONTHLY',
      });

      const res = await request(app)
        .post('/api/recurring/process')
        .set('x-api-key', 'test-jobs-key');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.expensesCreated).toBe(1);
      expect(res.body.processed).toBe(1);
      expect(res.body.durationMs).toBeDefined();
    });

    it('returns empty result when no recurring expenses are due', async () => {
      const res = await request(app)
        .post('/api/recurring/process')
        .set('x-api-key', 'test-jobs-key');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.expensesCreated).toBe(0);
    });
  });

  describe('Model fields', () => {
    it('sets nextDueDate to start_date on creation', async () => {
      const startDate = daysFromNow(5);
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Future Sub',
        amount: 10,
        start_date: startDate,
        frequency: 'MONTHLY',
      });

      expect(rec.nextDueDate.toDateString()).toBe(startDate.toDateString());
    });

    it('defaults active to true', async () => {
      const rec = await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Sub',
        amount: 10,
        start_date: today(),
        frequency: 'MONTHLY',
      });

      expect(rec.active).toBe(true);
    });
  });

  describe('Processing result details', () => {
    it('includes details for each processed recurring', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Sub A',
        amount: 10,
        start_date: today(),
        frequency: 'MONTHLY',
      });

      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Sub B',
        amount: 20,
        start_date: today(),
        frequency: 'WEEKLY',
      });

      const result = await processRecurringExpenses();

      expect(result.details).toHaveLength(2);
      expect(result.details.map((d) => d.name).sort()).toEqual(['Sub A', 'Sub B']);
      expect(result.errors).toBe(0);
    });
  });

  describe('Expense content', () => {
    it('includes description in generated expense when present', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Gym',
        amount: 50,
        description: 'Monthly membership',
        start_date: today(),
        frequency: 'MONTHLY',
      });

      await processRecurringExpenses();

      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses[0].description).toBe('Gym - Monthly membership');
    });

    it('uses name only when no description', async () => {
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Spotify',
        amount: 9.99,
        start_date: today(),
        frequency: 'MONTHLY',
      });

      await processRecurringExpenses();

      const expenses = await ExpenseModel.find({ owner: testUserId });
      expect(expenses[0].description).toBe('Spotify');
    });

    it('sets correct date on back-dated expenses', async () => {
      const startDate = daysAgo(2);
      await RecurringExpenseModel.create({
        userId: testUserId,
        name: 'Daily',
        amount: 1,
        start_date: startDate,
        frequency: 'DAILY',
      });

      await processRecurringExpenses();

      const expenses = await ExpenseModel.find({ owner: testUserId }).sort({ date: 1 });
      // First expense should be on start_date
      expect(expenses[0].date?.toDateString()).toBe(startDate.toDateString());
    });
  });
});
