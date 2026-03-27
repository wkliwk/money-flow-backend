process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import UserModel from '../src/models/User';
import {
  aggregateMonthlySummary,
  formatMonthlySummaryMessage,
  getPreviousMonthBounds,
  getPriorMonthBounds,
  buildBudgetAlerts,
  MonthlySummaryData,
} from '../src/utils/monthlySummary';

let mongod: MongoMemoryServer;
const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

// Helper: build a date in the previous calendar month
function prevMonthDate(dayOfMonth = 10): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dayOfMonth));
  return d;
}

// Helper: build a date two months ago (prior month for MoM)
function priorMonthDate(dayOfMonth = 10): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, dayOfMonth));
  return d;
}

describe('getPreviousMonthBounds', () => {
  it('returns start/end spanning previous month', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const { start, end, label } = getPreviousMonthBounds(now);
    expect(label).toBe('2026-02');
    expect(start).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('handles January (rolls back to December of prior year)', () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const { start, end, label } = getPreviousMonthBounds(now);
    expect(label).toBe('2025-12');
    expect(start).toEqual(new Date('2025-12-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('getPriorMonthBounds', () => {
  it('returns two months back', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const { start, end } = getPriorMonthBounds(now);
    expect(start).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('handles February — rolls to December of prior year', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    const { start, end } = getPriorMonthBounds(now);
    expect(start).toEqual(new Date('2025-12-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('aggregateMonthlySummary', () => {
  it('returns zeros for user with no transactions', async () => {
    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.totalIncome).toBe(0);
    expect(data.totalExpense).toBe(0);
    expect(data.net).toBe(0);
    expect(data.topCategories).toEqual([]);
    expect(data.momChangePercent).toBeNull();
  });

  it('aggregates income and expense for previous month', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 3000, type: 'income', category: 'Salary', date: prevMonthDate(5) },
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Food', date: prevMonthDate(10) },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Transport', date: prevMonthDate(15) },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.totalIncome).toBe(3000);
    expect(data.totalExpense).toBe(300);
    expect(data.net).toBe(2700);
  });

  it('returns up to 5 top categories sorted by total descending', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 500, type: 'expense', category: 'Rent', date: prevMonthDate(1) },
      { owner: TEST_USER_ID, amount: 300, type: 'expense', category: 'Food', date: prevMonthDate(2) },
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Transport', date: prevMonthDate(3) },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Entertainment', date: prevMonthDate(4) },
      { owner: TEST_USER_ID, amount: 80, type: 'expense', category: 'Health', date: prevMonthDate(5) },
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Other', date: prevMonthDate(6) },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.topCategories).toHaveLength(5);
    expect(data.topCategories[0].category).toBe('Rent');
    expect(data.topCategories[4].category).toBe('Health');
  });

  it('calculates month-over-month change percent', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Food', date: prevMonthDate(10) },
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: priorMonthDate(10) },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.momChangePercent).toBe(100); // doubled
  });

  it('returns null momChangePercent when no prior month data', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 200, type: 'expense', category: 'Food', date: prevMonthDate(10) },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.momChangePercent).toBeNull();
  });

  it('labels null category as Uncategorised', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 50, type: 'expense', date: prevMonthDate(5) },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.topCategories[0].category).toBe('Uncategorised');
  });

  it('does not include current month transactions', async () => {
    const now = new Date();
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 999, type: 'expense', category: 'Food', date: now },
    ]);

    const data = await aggregateMonthlySummary(TEST_USER_ID);
    expect(data.totalExpense).toBe(0);
  });
});

describe('buildBudgetAlerts', () => {
  it('returns empty array when no budgets set', async () => {
    const categories = [{ category: 'Food', total: 500 }];
    const alerts = await buildBudgetAlerts(TEST_USER_ID, categories, []);
    expect(alerts).toEqual([]);
  });

  it('flags categories over budget', async () => {
    const categories = [
      { category: 'Food', total: 600 },
      { category: 'Transport', total: 80 },
    ];
    const budgets = [
      { category: 'Food', limit: 500 },
      { category: 'Transport', limit: 100 },
    ];
    const alerts = await buildBudgetAlerts(TEST_USER_ID, categories, budgets);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe('Food');
    expect(alerts[0].spent).toBe(600);
    expect(alerts[0].limit).toBe(500);
    expect(alerts[0].percentUsed).toBe(120);
  });

  it('does not flag categories under budget', async () => {
    const categories = [{ category: 'Food', total: 400 }];
    const budgets = [{ category: 'Food', limit: 500 }];
    const alerts = await buildBudgetAlerts(TEST_USER_ID, categories, budgets);
    expect(alerts).toHaveLength(0);
  });
});

describe('formatMonthlySummaryMessage', () => {
  const baseData: MonthlySummaryData = {
    month: '2026-02',
    totalIncome: 3000,
    totalExpense: 1200,
    net: 1800,
    topCategories: [
      { category: 'Rent', total: 700 },
      { category: 'Food', total: 300 },
    ],
    budgetAlerts: [],
    prevMonthExpense: 1000,
    momChangePercent: 20,
  };

  it('includes month label and key figures', () => {
    const msg = formatMonthlySummaryMessage(baseData);
    expect(msg).toContain('2026-02');
    expect(msg).toContain('$3000.00');
    expect(msg).toContain('$1200.00');
    expect(msg).toContain('$1800.00');
  });

  it('shows up arrow for increased spending', () => {
    const msg = formatMonthlySummaryMessage(baseData);
    expect(msg).toContain('↑');
    expect(msg).toContain('20%');
  });

  it('shows down arrow for decreased spending', () => {
    const msg = formatMonthlySummaryMessage({ ...baseData, momChangePercent: -15 });
    expect(msg).toContain('↓');
    expect(msg).toContain('15%');
  });

  it('shows No data when no prior month', () => {
    const msg = formatMonthlySummaryMessage({ ...baseData, momChangePercent: null });
    expect(msg).toContain('No data');
  });

  it('lists top categories', () => {
    const msg = formatMonthlySummaryMessage(baseData);
    expect(msg).toContain('Rent');
    expect(msg).toContain('$700.00');
    expect(msg).toContain('Food');
  });

  it('includes budget alerts when present', () => {
    const dataWithAlerts: MonthlySummaryData = {
      ...baseData,
      budgetAlerts: [{ category: 'Food', spent: 600, limit: 500, percentUsed: 120 }],
    };
    const msg = formatMonthlySummaryMessage(dataWithAlerts);
    expect(msg).toContain('Over Budget');
    expect(msg).toContain('Food');
    expect(msg).toContain('120%');
  });

  it('omits budget section when no alerts', () => {
    const msg = formatMonthlySummaryMessage(baseData);
    expect(msg).not.toContain('Over Budget');
  });
});

describe('POST /api/jobs/monthly-summary', () => {
  const JOBS_API_KEY = 'test-jobs-key';

  beforeEach(() => {
    process.env.JOBS_API_KEY = JOBS_API_KEY;
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
  });

  afterEach(() => {
    delete process.env.JOBS_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/jobs/monthly-summary');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await request(app)
      .post('/api/jobs/monthly-summary')
      .set('x-api-key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct API key', async () => {
    await UserModel.create({
      _id: TEST_USER_ID,
      email: 'job@example.com',
      password: 'password123',
    });

    const res = await request(app)
      .post('/api/jobs/monthly-summary')
      .set('x-api-key', JOBS_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.durationMs).toBe('number');
  });

  it('returns 503 when JOBS_API_KEY is not configured', async () => {
    delete process.env.JOBS_API_KEY;
    const res = await request(app)
      .post('/api/jobs/monthly-summary')
      .set('x-api-key', 'any-key');
    expect(res.status).toBe(503);
  });
});
