process.env.NODE_ENV = 'test';

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import expenseRoutes from './expenses';
import ExpenseModel from '../models/Expense';

let mongoServer: MongoMemoryServer;
const JWT_SECRET = 'test-secret-key';
let app: express.Application;

const TEST_USER_ID = 'test-user-search';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.JWT_SECRET = JWT_SECRET;
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use(cors());
  app.use('/api/expenses', expenseRoutes);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await ExpenseModel.deleteMany({});
});

const generateToken = (userId: string) => jwt.sign({ userId }, JWT_SECRET);

const basePayload = {
  description: 'Test expense',
  amount: 100,
  type: 'expense',
  category: 'Food',
  owner: TEST_USER_ID,
};

async function createExpense(overrides: Record<string, unknown> = {}) {
  const token = generateToken(TEST_USER_ID);
  const res = await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...basePayload, ...overrides });
  return res.body;
}

async function getExpenses(query: string) {
  const token = generateToken(TEST_USER_ID);
  return request(app)
    .get(`/api/expenses?${query}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('GET /api/expenses — pagination', () => {
  beforeEach(async () => {
    await ExpenseModel.deleteMany({});
  });

  test('returns paginated results with data array', async () => {
    await createExpense({ description: 'Expense 1' });
    await createExpense({ description: 'Expense 2' });
    const res = await getExpenses('');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.page).toBe(1);
  });

  test('supports page and limit', async () => {
    for (let i = 0; i < 5; i++) {
      await createExpense({ description: `Expense ${i}` });
    }
    const res = await getExpenses('page=2&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  test('caps limit at 200', async () => {
    await createExpense();
    const res = await getExpenses('limit=500');
    expect(res.body.pagination.limit).toBe(200);
  });
});

describe('GET /api/expenses — text search (q parameter)', () => {
  beforeEach(async () => {
    await createExpense({ description: 'Lunch at restaurant', amount: 80, category: 'Food' });
    await createExpense({ description: 'Coffee at Starbucks', amount: 45, category: 'Drinks' });
    await createExpense({ description: 'Taxi to airport', amount: 200, category: 'Transport', item: 'Uber' });
    await createExpense({ description: 'Dinner with John', amount: 300, category: 'Food', participants: ['John', 'Alice'] });
  });

  test('searches description (case-insensitive)', async () => {
    const res = await getExpenses('q=restaurant');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].description).toBe('Lunch at restaurant');
  });

  test('searches category', async () => {
    const res = await getExpenses('q=Drinks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].category).toBe('Drinks');
  });

  test('searches item field', async () => {
    const res = await getExpenses('q=uber');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].item).toBe('Uber');
  });

  test('searches participants', async () => {
    const res = await getExpenses('q=John');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].participants).toContain('John');
  });

  test('is case-insensitive', async () => {
    const res = await getExpenses('q=RESTAURANT');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('returns all when q is empty', async () => {
    const res = await getExpenses('q=');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });

  test('returns empty array when no matches', async () => {
    const res = await getExpenses('q=nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('handles regex special characters safely', async () => {
    const res = await getExpenses('q=(test)');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/expenses — category filter', () => {
  beforeEach(async () => {
    await createExpense({ description: 'Lunch', category: 'Food' });
    await createExpense({ description: 'Bus', category: 'Transport' });
    await createExpense({ description: 'Dinner', category: 'Food' });
  });

  test('filters by exact category', async () => {
    const res = await getExpenses('category=Food');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const expense of res.body.data) {
      expect(expense.category).toBe('Food');
    }
  });

  test('returns empty for non-existent category', async () => {
    const res = await getExpenses('category=Entertainment');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/expenses — amount range filter', () => {
  beforeEach(async () => {
    await createExpense({ description: 'Small', amount: 50 });
    await createExpense({ description: 'Medium', amount: 200 });
    await createExpense({ description: 'Large', amount: 500 });
    await createExpense({ description: 'Extra large', amount: 1000 });
  });

  test('filters with minAmount only', async () => {
    const res = await getExpenses('minAmount=200');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    for (const expense of res.body.data) {
      expect(expense.amount).toBeGreaterThanOrEqual(200);
    }
  });

  test('filters with maxAmount only', async () => {
    const res = await getExpenses('maxAmount=200');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const expense of res.body.data) {
      expect(expense.amount).toBeLessThanOrEqual(200);
    }
  });

  test('filters with both minAmount and maxAmount', async () => {
    const res = await getExpenses('minAmount=100&maxAmount=500');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const expense of res.body.data) {
      expect(expense.amount).toBeGreaterThanOrEqual(100);
      expect(expense.amount).toBeLessThanOrEqual(500);
    }
  });

  test('returns empty when range matches nothing', async () => {
    const res = await getExpenses('minAmount=2000&maxAmount=3000');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/expenses — combined filters (AND logic)', () => {
  beforeEach(async () => {
    await createExpense({ description: 'Lunch at restaurant', amount: 80, category: 'Food' });
    await createExpense({ description: 'Dinner at restaurant', amount: 300, category: 'Food' });
    await createExpense({ description: 'Bus ride', amount: 10, category: 'Transport' });
    await createExpense({ description: 'Coffee', amount: 45, category: 'Food' });
  });

  test('combines q and category', async () => {
    const res = await getExpenses('q=restaurant&category=Food');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('combines q and amount range', async () => {
    const res = await getExpenses('q=restaurant&minAmount=100');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].description).toBe('Dinner at restaurant');
  });

  test('combines category and amount range', async () => {
    const res = await getExpenses('category=Food&maxAmount=100');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('combines all filters', async () => {
    const res = await getExpenses('q=restaurant&category=Food&minAmount=50&maxAmount=100');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].description).toBe('Lunch at restaurant');
  });

  test('returns empty when combined filters exclude everything', async () => {
    const res = await getExpenses('q=restaurant&category=Transport');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/expenses — filters with pagination', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) {
      await createExpense({ description: `Food item ${i}`, category: 'Food', amount: 100 + i });
    }
    await createExpense({ description: 'Transport', category: 'Transport', amount: 50 });
  });

  test('returns correct total count with filters', async () => {
    const res = await getExpenses('category=Food');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination.total).toBe(5);
  });

  test('paginates filtered results', async () => {
    const res = await getExpenses('category=Food&limit=2&page=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.page).toBe(2);
  });
});

describe('GET /api/expenses — sorting with filters', () => {
  beforeEach(async () => {
    await createExpense({ description: 'Cheap food', amount: 30, category: 'Food' });
    await createExpense({ description: 'Expensive food', amount: 500, category: 'Food' });
    await createExpense({ description: 'Medium food', amount: 150, category: 'Food' });
  });

  test('sorts filtered results by amount ascending', async () => {
    const res = await getExpenses('category=Food&sort=amount&order=asc');
    expect(res.status).toBe(200);
    expect(res.body.data[0].amount).toBe(30);
    expect(res.body.data[1].amount).toBe(150);
    expect(res.body.data[2].amount).toBe(500);
  });
});
