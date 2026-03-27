process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_export';
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
  jest.restoreAllMocks();
});

const basePayload = {
  description: 'Test expense',
  amount: 15,
  type: 'expense',
  category: 'Food',
};

async function createExpense(overrides: Record<string, unknown> = {}) {
  await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ ...basePayload, ...overrides });
}

describe('GET /api/export/csv', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/export/csv');
    expect(res.status).toBe(401);
  });

  it('returns CSV content-type', async () => {
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="money-flow-/);
  });

  it('includes expense rows in output', async () => {
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Lunch', amount: 15, type: 'expense', category: 'Food' });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Lunch');
    expect(res.text).toContain('Food');
  });

  it('escapes commas, quotes, and newlines in CSV cells', async () => {
    await createExpense({
      description: 'He said "hi", ok\nline2',
      participants: ['Alice', 'Bob'],
    });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"He said ""hi"", ok\nline2"/);
    expect(res.text).toContain('Alice;Bob');
  });

  it('respects type filter', async () => {
    await createExpense({ description: 'Salary', type: 'income', amount: 1000, category: 'Work' });
    await createExpense({ description: 'Groceries', type: 'expense', amount: 50, category: 'Food' });

    const res = await request(app)
      .get('/api/export/csv?type=income')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Salary');
    expect(res.text).not.toContain('Groceries');
  });

  it('respects from/to date filters', async () => {
    await createExpense({
      description: 'Old',
      date: '2025-12-01T00:00:00.000Z',
    });
    await createExpense({
      description: 'New',
      date: '2026-01-20T00:00:00.000Z',
    });
    await createExpense({
      description: 'TooNew',
      date: '2026-02-05T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/export/csv?from=2026-01-01&to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('New');
    expect(res.text).not.toContain('Old');
    expect(res.text).not.toContain('TooNew');
  });

  it('respects from filter only (no to filter)', async () => {
    await createExpense({
      description: 'Before',
      date: '2025-12-01T00:00:00.000Z',
    });
    await createExpense({
      description: 'After',
      date: '2026-01-20T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/export/csv?from=2026-01-01')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Before');
    expect(res.text).toContain('After');
  });

  it('respects to filter only (no from filter)', async () => {
    await createExpense({
      description: 'Old',
      date: '2025-12-01T00:00:00.000Z',
    });
    await createExpense({
      description: 'New',
      date: '2026-02-05T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/export/csv?to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Old');
    expect(res.text).not.toContain('New');
  });

  it('combines type filter with date filters', async () => {
    await createExpense({
      description: 'Old Expense',
      type: 'expense',
      date: '2025-12-01T00:00:00.000Z',
    });
    await createExpense({
      description: 'Jan Salary',
      type: 'income',
      amount: 5000,
      date: '2026-01-20T00:00:00.000Z',
    });
    await createExpense({
      description: 'Jan Expense',
      type: 'expense',
      date: '2026-01-25T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/export/csv?type=expense&from=2026-01-01&to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Old Expense');
    expect(res.text).not.toContain('Jan Salary');
    expect(res.text).toContain('Jan Expense');
  });

  it('returns 500 when ExpenseModel.find throws', async () => {
    const spy = jest.spyOn(ExpenseModel, 'find').mockImplementationOnce(() => {
      throw new Error('db fail');
    });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to export CSV' });
    spy.mockRestore();
  });

  it('returns only header row when no transactions', async () => {
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Date');
  });
});
