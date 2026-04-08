process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import UserModel from '../src/models/User';
import {
  aggregateWeeklyData,
  formatDigestMessage,
  getWeekBoundaries,
} from '../src/utils/weeklyDigest';

let mongod: MongoMemoryServer;
const TEST_USER_ID = new mongoose.Types.ObjectId().toString();
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');

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

function thisWeekDate(dayOffset = 0): Date {
  const now = new Date();
  const day = now.getDay();
  const d = new Date(now);
  d.setDate(now.getDate() - day + dayOffset);
  d.setHours(12, 0, 0, 0);
  return d;
}

function lastWeekDate(dayOffset = 0): Date {
  const d = thisWeekDate(dayOffset);
  d.setDate(d.getDate() - 7);
  return d;
}

describe('getWeekBoundaries', () => {
  it('returns correct week boundaries', () => {
    const wednesday = new Date('2026-03-25T12:00:00Z'); // Wednesday
    const { thisWeekStart, lastWeekStart, lastWeekEnd } = getWeekBoundaries(wednesday);
    expect(thisWeekStart.getDay()).toBe(0); // Sunday
    expect(lastWeekStart.getDay()).toBe(0);
    expect(lastWeekEnd.getTime()).toBeLessThan(thisWeekStart.getTime());
  });
});

describe('aggregateWeeklyData', () => {
  it('returns zeros for user with no expenses', async () => {
    const data = await aggregateWeeklyData(TEST_USER_ID, new Date());
    expect(data.totalSpent).toBe(0);
    expect(data.transactionCount).toBe(0);
    expect(data.changePercent).toBeNull();
    expect(data.topCategories).toEqual([]);
  });

  it('aggregates this week expenses', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Food', date: thisWeekDate(1) },
      { owner: TEST_USER_ID, amount: 30, type: 'expense', category: 'Transport', date: thisWeekDate(2) },
      { owner: TEST_USER_ID, amount: 100, type: 'income', category: 'Salary', date: thisWeekDate(1) },
    ]);
    const data = await aggregateWeeklyData(TEST_USER_ID, new Date());
    expect(data.totalSpent).toBe(80);
    expect(data.transactionCount).toBe(2);
  });

  it('calculates change percent vs last week', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Food', date: thisWeekDate(1) },
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Food', date: lastWeekDate(1) },
    ]);
    const data = await aggregateWeeklyData(TEST_USER_ID, new Date());
    expect(data.changePercent).toBe(100); // doubled
  });

  it('returns top 3 categories sorted by total', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 100, type: 'expense', category: 'Rent', date: thisWeekDate(1) },
      { owner: TEST_USER_ID, amount: 80, type: 'expense', category: 'Food', date: thisWeekDate(2) },
      { owner: TEST_USER_ID, amount: 60, type: 'expense', category: 'Transport', date: thisWeekDate(3) },
      { owner: TEST_USER_ID, amount: 40, type: 'expense', category: 'Entertainment', date: thisWeekDate(4) },
    ]);
    const data = await aggregateWeeklyData(TEST_USER_ID, new Date());
    expect(data.topCategories).toHaveLength(3);
    expect(data.topCategories[0].category).toBe('Rent');
    expect(data.topCategories[1].category).toBe('Food');
    expect(data.topCategories[2].category).toBe('Transport');
  });

  it('labels null category as Uncategorized', async () => {
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 50, type: 'expense', date: thisWeekDate(1) },
    ]);
    const data = await aggregateWeeklyData(TEST_USER_ID, new Date());
    expect(data.topCategories[0].category).toBe('Uncategorized');
  });
});

describe('formatDigestMessage', () => {
  it('formats message with all data', () => {
    const msg = formatDigestMessage({
      totalSpent: 250,
      lastWeekTotal: 200,
      changePercent: 25,
      transactionCount: 10,
      topCategories: [
        { category: 'Food', total: 100 },
        { category: 'Transport', total: 80 },
      ],
    });
    expect(msg).toContain('$250.00');
    expect(msg).toContain('10');
    expect(msg).toContain('25%');
    expect(msg).toContain('Food');
    expect(msg).toContain('Transport');
  });

  it('shows down arrow for decreased spending', () => {
    const msg = formatDigestMessage({
      totalSpent: 100,
      lastWeekTotal: 200,
      changePercent: -50,
      transactionCount: 5,
      topCategories: [],
    });
    expect(msg).toContain('↓');
    expect(msg).toContain('50%');
  });

  it('shows No data when no previous week', () => {
    const msg = formatDigestMessage({
      totalSpent: 100,
      lastWeekTotal: 0,
      changePercent: null,
      transactionCount: 5,
      topCategories: [],
    });
    expect(msg).toContain('No data');
  });
});

describe('POST /api/reports/weekly-digest', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/reports/weekly-digest');
    expect(res.status).toBe(401);
  });

  it('returns digest data for authenticated user', async () => {
    await UserModel.create({
      _id: TEST_USER_ID,
      email: 'test@example.com',
      password: 'password123',
    });
    await ExpenseModel.create([
      { owner: TEST_USER_ID, amount: 50, type: 'expense', category: 'Food', date: thisWeekDate(1) },
    ]);

    const res = await request(app)
      .post('/api/reports/weekly-digest')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.digest).toBeDefined();
    expect(res.body.digest.totalSpent).toBe(50);
    expect(res.body.digest.transactionCount).toBe(1);
    expect(res.body.message).toContain('$50.00');
    expect(res.body.sent).toBe(false); // no telegramChatId
  });

  it('returns sent=false when user has no telegram configured', async () => {
    await UserModel.create({
      _id: TEST_USER_ID,
      email: 'test2@example.com',
      password: 'password123',
    });

    const res = await request(app)
      .post('/api/reports/weekly-digest')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
  });
});

describe('User model weekly digest fields', () => {
  it('defaults weeklyDigestEnabled to false', async () => {
    const user = await UserModel.create({
      email: 'digest@example.com',
      password: 'password123',
    });
    expect(user.weeklyDigestEnabled).toBe(false);
    expect(user.telegramChatId).toBeUndefined();
  });

  it('stores telegramChatId and weeklyDigestEnabled', async () => {
    const user = await UserModel.create({
      email: 'digest2@example.com',
      password: 'password123',
      telegramChatId: '12345',
      weeklyDigestEnabled: true,
    });
    expect(user.telegramChatId).toBe('12345');
    expect(user.weeklyDigestEnabled).toBe(true);
  });
});
