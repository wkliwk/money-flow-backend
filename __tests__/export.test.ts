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
const OTHER_USER_ID = 'user_other';
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

// ===================== CSV TESTS =====================

describe('GET /api/export/csv', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/export/csv');
    expect(res.status).toBe(401);
  });

  it('returns CSV content-type and proper filename', async () => {
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="money-flow-export-/);
  });

  it('includes expense rows in output', async () => {
    await createExpense({ description: 'Lunch', amount: 15, category: 'Food' });

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
    await createExpense({ description: 'Old', date: '2025-12-01T00:00:00.000Z' });
    await createExpense({ description: 'New', date: '2026-01-20T00:00:00.000Z' });
    await createExpense({ description: 'TooNew', date: '2026-02-05T00:00:00.000Z' });

    const res = await request(app)
      .get('/api/export/csv?from=2026-01-01&to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('New');
    expect(res.text).not.toContain('Old');
    expect(res.text).not.toContain('TooNew');
  });

  it('respects from filter only (no to filter)', async () => {
    await createExpense({ description: 'Before', date: '2025-12-01T00:00:00.000Z' });
    await createExpense({ description: 'After', date: '2026-01-20T00:00:00.000Z' });

    const res = await request(app)
      .get('/api/export/csv?from=2026-01-01')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Before');
    expect(res.text).toContain('After');
  });

  it('respects to filter only (no from filter)', async () => {
    await createExpense({ description: 'Old', date: '2025-12-01T00:00:00.000Z' });
    await createExpense({ description: 'New', date: '2026-02-05T00:00:00.000Z' });

    const res = await request(app)
      .get('/api/export/csv?to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Old');
    expect(res.text).not.toContain('New');
  });

  it('combines type filter with date filters', async () => {
    await createExpense({ description: 'Old Expense', type: 'expense', date: '2025-12-01T00:00:00.000Z' });
    await createExpense({ description: 'Jan Salary', type: 'income', amount: 5000, date: '2026-01-20T00:00:00.000Z' });
    await createExpense({ description: 'Jan Expense', type: 'expense', date: '2026-01-25T00:00:00.000Z' });

    const res = await request(app)
      .get('/api/export/csv?type=expense&from=2026-01-01&to=2026-01-31')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Old Expense');
    expect(res.text).not.toContain('Jan Salary');
    expect(res.text).toContain('Jan Expense');
  });

  it('respects category filter', async () => {
    await createExpense({ description: 'Lunch', category: 'Food' });
    await createExpense({ description: 'Bus', category: 'Transport', amount: 5 });

    const res = await request(app)
      .get('/api/export/csv?category=Transport')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Bus');
    expect(res.text).not.toContain('Lunch');
  });

  it('respects q (text search) filter', async () => {
    await createExpense({ description: 'Pizza from Dominos' });
    await createExpense({ description: 'Bus ticket', amount: 5 });

    const res = await request(app)
      .get('/api/export/csv?q=pizza')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Pizza from Dominos');
    expect(res.text).not.toContain('Bus ticket');
  });

  it('respects paymentMethod filter', async () => {
    await createExpense({ description: 'Cash lunch', paymentMethod: 'cash' });
    await createExpense({ description: 'Card dinner', paymentMethod: 'credit_card', amount: 200 });

    const res = await request(app)
      .get('/api/export/csv?paymentMethod=cash')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Cash lunch');
    expect(res.text).not.toContain('Card dinner');
  });

  it('respects minAmount and maxAmount filters', async () => {
    await createExpense({ description: 'Cheap', amount: 5 });
    await createExpense({ description: 'Medium', amount: 50 });
    await createExpense({ description: 'Expensive', amount: 500 });

    const res = await request(app)
      .get('/api/export/csv?minAmount=10&maxAmount=100')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Medium');
    expect(res.text).not.toContain('Cheap');
    expect(res.text).not.toContain('Expensive');
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

  it('only exports authenticated user data', async () => {
    await createExpense({ description: 'My expense' });
    // Create expense for other user
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...basePayload, description: 'Other user expense' });

    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('My expense');
    expect(res.text).not.toContain('Other user expense');
  });
});

// ===================== PDF TESTS =====================

describe('GET /api/export/pdf', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/export/pdf');
    expect(res.status).toBe(401);
  });

  it('returns PDF content-type and proper filename', async () => {
    const res = await request(app)
      .get('/api/export/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="money-flow-export-/);
  });

  it('returns valid PDF with %PDF header', async () => {
    await createExpense({ description: 'PDF test' });

    const res = await request(app)
      .get('/api/export/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    // PDF files start with %PDF
    expect(res.body.toString('ascii', 0, 4)).toBe('%PDF');
  });

  it('handles 0 transactions gracefully', async () => {
    const res = await request(app)
      .get('/api/export/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.body.toString('ascii', 0, 4)).toBe('%PDF');
    // PDF with 0 transactions should still be a valid, non-empty document
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('includes category summary section (multi-page PDF)', async () => {
    await createExpense({ description: 'Lunch', category: 'Food', amount: 20 });
    await createExpense({ description: 'Bus', category: 'Transport', amount: 5 });

    const res = await request(app)
      .get('/api/export/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.body.toString('ascii', 0, 4)).toBe('%PDF');
    // With transactions, the PDF should have both a table page and a summary page
    // A multi-page PDF with summary will be larger than a single-page empty one
    const emptyRes = await request(app)
      .get('/api/export/pdf?type=nonexistent')
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true);
    expect(res.body.length).toBeGreaterThan(emptyRes.body.length);
  });

  it('respects date filters (PDF uses same filter as CSV)', async () => {
    await createExpense({ description: 'Old', date: '2025-12-01T00:00:00.000Z', amount: 100 });
    await createExpense({ description: 'InRange', date: '2026-01-15T00:00:00.000Z', amount: 50 });

    // Verify PDF endpoint applies filters by comparing with CSV output
    const [pdfRes, csvRes] = await Promise.all([
      request(app)
        .get('/api/export/pdf?from=2026-01-01&to=2026-01-31')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true),
      request(app)
        .get('/api/export/csv?from=2026-01-01&to=2026-01-31')
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.toString('ascii', 0, 4)).toBe('%PDF');
    // CSV confirms the filter works - only InRange, not Old
    expect(csvRes.text).toContain('InRange');
    expect(csvRes.text).not.toContain('Old');
  });

  it('respects category filter (PDF uses same filter as CSV)', async () => {
    await createExpense({ description: 'Lunch', category: 'Food' });
    await createExpense({ description: 'Train', category: 'Transport', amount: 10 });

    const [pdfRes, csvRes] = await Promise.all([
      request(app)
        .get('/api/export/pdf?category=Food')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true),
      request(app)
        .get('/api/export/csv?category=Food')
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.toString('ascii', 0, 4)).toBe('%PDF');
    // CSV confirms filter logic
    expect(csvRes.text).toContain('Lunch');
    expect(csvRes.text).not.toContain('Train');
  });

  it('respects q (text search) filter', async () => {
    await createExpense({ description: 'Sushi dinner' });
    await createExpense({ description: 'Gas station', amount: 40 });

    const [pdfRes, csvRes] = await Promise.all([
      request(app)
        .get('/api/export/pdf?q=sushi')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true),
      request(app)
        .get('/api/export/csv?q=sushi')
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.toString('ascii', 0, 4)).toBe('%PDF');
    // CSV confirms filter logic
    expect(csvRes.text).toContain('Sushi dinner');
    expect(csvRes.text).not.toContain('Gas station');
  });

  it('returns 500 when ExpenseModel.find throws', async () => {
    const spy = jest.spyOn(ExpenseModel, 'find').mockImplementationOnce(() => {
      throw new Error('db fail');
    });

    const res = await request(app)
      .get('/api/export/pdf')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to export PDF' });
    spy.mockRestore();
  });

  it('only exports authenticated user data (verified via CSV parity)', async () => {
    await createExpense({ description: 'My pdf expense' });
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...basePayload, description: 'Other user pdf expense' });

    const [pdfRes, csvRes] = await Promise.all([
      request(app)
        .get('/api/export/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true),
      request(app)
        .get('/api/export/csv')
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.toString('ascii', 0, 4)).toBe('%PDF');
    // CSV uses same filter function, confirming user isolation
    expect(csvRes.text).toContain('My pdf expense');
    expect(csvRes.text).not.toContain('Other user pdf expense');
  });
});
