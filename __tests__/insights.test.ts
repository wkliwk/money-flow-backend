process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import { WeeklyPulseModel } from '../src/models/WeeklyPulse';

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'You spent thoughtfully this week.' }],
        }),
      },
    })),
  };
});

let mongod: MongoMemoryServer;
const USER = 'user_test_insights';
const token = jwt.sign({ userId: USER }, 'test-secret');

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
  jest.restoreAllMocks();
});

function thisMonday(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('GET /api/insights/weekly-pulse', () => {
  it('rejects unauthenticated', async () => {
    const res = await request(app).get('/api/insights/weekly-pulse');
    expect(res.status).toBe(401);
  });

  it('returns { pulse: null } when no pulse exists', async () => {
    const res = await request(app)
      .get('/api/insights/weekly-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pulse: null });
  });

  it('returns the most recent pulse', async () => {
    await WeeklyPulseModel.create([
      { userId: USER, weekStart: '2026-01-05', narrative: 'older', stats: { totalSpend: 0, fourWeekAverage: 0, deltaPercent: 0, topCategory: 'X', highestSpendDay: '2026-01-05', largestTransaction: null, transactionCount: 0 } },
      { userId: USER, weekStart: '2026-02-02', narrative: 'newer', stats: { totalSpend: 0, fourWeekAverage: 0, deltaPercent: 0, topCategory: 'X', highestSpendDay: '2026-02-02', largestTransaction: null, transactionCount: 0 } },
    ]);

    const res = await request(app)
      .get('/api/insights/weekly-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pulse.narrative).toBe('newer');
  });

  it('returns 500 when db throws', async () => {
    jest.spyOn(WeeklyPulseModel, 'findOne').mockImplementationOnce(() => {
      throw new Error('db');
    });
    const res = await request(app)
      .get('/api/insights/weekly-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/insights/previous-pulse', () => {
  it('returns null when no previous pulse', async () => {
    const res = await request(app)
      .get('/api/insights/previous-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pulse: null });
  });

  it('returns the most recent pulse strictly before this week', async () => {
    await WeeklyPulseModel.create([
      { userId: USER, weekStart: '2020-01-06', narrative: 'old', stats: { totalSpend: 0, fourWeekAverage: 0, deltaPercent: 0, topCategory: 'X', highestSpendDay: '2020-01-06', largestTransaction: null, transactionCount: 0 } },
    ]);
    const res = await request(app)
      .get('/api/insights/previous-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pulse.narrative).toBe('old');
  });

  it('returns 500 when db throws', async () => {
    jest.spyOn(WeeklyPulseModel, 'findOne').mockImplementationOnce(() => {
      throw new Error('db');
    });
    const res = await request(app)
      .get('/api/insights/previous-pulse')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/insights/weekly-pulse/generate', () => {
  it('returns insufficient_data when fewer than 3 expenses this week', async () => {
    await ExpenseModel.create([
      { owner: USER, type: 'expense', amount: 10, category: 'Food', date: new Date() },
      { owner: USER, type: 'expense', amount: 20, category: 'Food', date: new Date() },
    ]);
    const res = await request(app)
      .post('/api/insights/weekly-pulse/generate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pulse: null, generated: false, reason: 'insufficient_data' });
  });

  it('generates a pulse when 3+ expenses exist this week', async () => {
    const monday = thisMonday();
    await ExpenseModel.create([
      { owner: USER, type: 'expense', amount: 100, category: 'Food', date: monday, item: 'Lunch' },
      { owner: USER, type: 'expense', amount: 50, category: 'Transport', date: monday },
      { owner: USER, type: 'expense', amount: 200, category: 'Food', date: monday, item: 'Dinner' },
    ]);

    const res = await request(app)
      .post('/api/insights/weekly-pulse/generate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(true);
    expect(res.body.pulse.narrative).toBe('You spent thoughtfully this week.');
    expect(res.body.pulse.stats.totalSpend).toBe(350);
    expect(res.body.pulse.stats.topCategory).toBe('Food');
    expect(res.body.pulse.stats.largestTransaction.description).toBe('Dinner');
  });

  it('returns the existing pulse without regenerating when one exists', async () => {
    const monday = thisMonday();
    const weekStart = monday.toISOString().split('T')[0];
    await WeeklyPulseModel.create({
      userId: USER,
      weekStart,
      narrative: 'cached',
      stats: { totalSpend: 1, fourWeekAverage: 1, deltaPercent: 0, topCategory: 'X', highestSpendDay: weekStart, largestTransaction: null, transactionCount: 1 },
    });

    const res = await request(app)
      .post('/api/insights/weekly-pulse/generate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ generated: false });
    expect(res.body.pulse.narrative).toBe('cached');
  });

  it('regenerates when force=true even if a pulse already exists', async () => {
    const monday = thisMonday();
    const weekStart = monday.toISOString().split('T')[0];
    await WeeklyPulseModel.create({
      userId: USER,
      weekStart,
      narrative: 'stale',
      stats: { totalSpend: 1, fourWeekAverage: 1, deltaPercent: 0, topCategory: 'X', highestSpendDay: weekStart, largestTransaction: null, transactionCount: 1 },
    });
    await ExpenseModel.create([
      { owner: USER, type: 'expense', amount: 10, category: 'Food', date: monday },
      { owner: USER, type: 'expense', amount: 20, category: 'Food', date: monday },
      { owner: USER, type: 'expense', amount: 30, category: 'Food', date: monday },
    ]);

    const res = await request(app)
      .post('/api/insights/weekly-pulse/generate?force=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(true);
    expect(res.body.pulse.narrative).toBe('You spent thoughtfully this week.');
  });

  it('returns 500 when stat computation throws', async () => {
    const monday = thisMonday();
    await ExpenseModel.create([
      { owner: USER, type: 'expense', amount: 1, category: 'X', date: monday },
      { owner: USER, type: 'expense', amount: 1, category: 'X', date: monday },
      { owner: USER, type: 'expense', amount: 1, category: 'X', date: monday },
    ]);
    jest.spyOn(ExpenseModel, 'find').mockImplementationOnce(() => {
      throw new Error('db');
    });
    const res = await request(app)
      .post('/api/insights/weekly-pulse/generate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});
