process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_payment_method';
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
});

const basePayload = {
  description: 'Test expense',
  amount: 100,
  type: 'expense',
  category: 'Food',
};

async function createExpense(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ ...basePayload, ...overrides });
  return res.body;
}

describe('paymentMethod field', () => {
  it('creates expense without paymentMethod (defaults to null)', async () => {
    const created = await createExpense();
    expect(created.paymentMethod).toBeNull();
  });

  it('creates expense with valid paymentMethod', async () => {
    const created = await createExpense({ paymentMethod: 'octopus' });
    expect(created.paymentMethod).toBe('octopus');
  });

  it('rejects invalid paymentMethod on create', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, paymentMethod: 'bitcoin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('paymentMethod must be one of');
  });

  it('updates expense with paymentMethod', async () => {
    const created = await createExpense({ description: 'For update' });
    const res = await request(app)
      .put(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'For update', paymentMethod: 'fps' });
    expect(res.status).toBe(200);
    expect(res.body.paymentMethod).toBe('fps');
  });

  it('rejects invalid paymentMethod on update', async () => {
    const created = await createExpense({ paymentMethod: 'cash' });
    const res = await request(app)
      .put(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, paymentMethod: 'venmo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('paymentMethod must be one of');
  });

  it('clears paymentMethod by setting to null', async () => {
    const created = await createExpense({ paymentMethod: 'payme' });
    expect(created.paymentMethod).toBe('payme');
    const res = await request(app)
      .put(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, paymentMethod: null });
    expect(res.status).toBe(200);
    expect(res.body.paymentMethod).toBeNull();
  });

  it('returns paymentMethod in GET /api/expenses', async () => {
    await createExpense({ paymentMethod: 'credit_card' });
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].paymentMethod).toBe('credit_card');
  });

  it('returns paymentMethod in GET /api/expenses/:id', async () => {
    const created = await createExpense({ paymentMethod: 'debit_card' });
    const res = await request(app)
      .get(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.paymentMethod).toBe('debit_card');
  });
});

describe('GET /api/expenses?paymentMethod filter', () => {
  it('filters by paymentMethod', async () => {
    await createExpense({ description: 'Bus', paymentMethod: 'octopus' });
    await createExpense({ description: 'Lunch', paymentMethod: 'credit_card' });
    await createExpense({ description: 'Groceries', paymentMethod: 'octopus' });

    const res = await request(app)
      .get('/api/expenses?paymentMethod=octopus')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
    for (const expense of res.body.data) {
      expect(expense.paymentMethod).toBe('octopus');
    }
  });

  it('rejects invalid paymentMethod filter', async () => {
    const res = await request(app)
      .get('/api/expenses?paymentMethod=bitcoin')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid paymentMethod filter');
  });

  it('returns empty when no expenses match filter', async () => {
    await createExpense({ description: 'Bus', paymentMethod: 'octopus' });
    const res = await request(app)
      .get('/api/expenses?paymentMethod=fps')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

describe('CSV export includes paymentMethod', () => {
  it('includes Payment Method column header', async () => {
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Payment Method');
  });

  it('includes paymentMethod value in CSV rows', async () => {
    await createExpense({ description: 'Train', paymentMethod: 'octopus' });
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('octopus');
  });

  it('handles null paymentMethod in CSV', async () => {
    await createExpense({ description: 'Cash purchase' });
    const res = await request(app)
      .get('/api/export/csv')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Payment Method');
  });
});
