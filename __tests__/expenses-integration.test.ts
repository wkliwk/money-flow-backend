process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;

const USER_A_ID = new mongoose.Types.ObjectId().toString();
const USER_B_ID = new mongoose.Types.ObjectId().toString();
const tokenA = jwt.sign({ userId: USER_A_ID }, 'test-secret');
const tokenB = jwt.sign({ userId: USER_B_ID }, 'test-secret');

const validExpense = {
  description: 'Lunch',
  amount: 85,
  type: 'expense',
  category: 'Food',
};

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

async function createExpense(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...validExpense, ...overrides });
  return res;
}

// --- POST /api/expenses ---

describe('POST /api/expenses', () => {
  it('creates an expense with valid data', async () => {
    const res = await createExpense(tokenA);
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Lunch');
    expect(res.body.amount).toBe(85);
    expect(res.body.owner).toBe(USER_A_ID);
  });

  it('rejects missing amount with 400', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ description: 'No amount', type: 'expense', category: 'Food' });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric amount with 400', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, amount: 'abc' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send(validExpense);
    expect(res.status).toBe(401);
  });

  it('creates expense with optional fields', async () => {
    const res = await createExpense(tokenA, {
      paymentMethod: 'octopus',
      currency: 'HKD',
      participants: ['Alice', 'Bob'],
      splitBill: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.paymentMethod).toBe('octopus');
    expect(res.body.currency).toBe('HKD');
    expect(res.body.participants).toEqual(['Alice', 'Bob']);
    expect(res.body.splitBill).toBe(true);
  });

  it('rejects invalid paymentMethod with 400', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, paymentMethod: 'bitcoin' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid currency with 400', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, currency: 'BTC' });
    expect(res.status).toBe(400);
  });

  it('sets owner to authenticated user regardless of body', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, owner: USER_B_ID });
    expect(res.status).toBe(201);
    expect(res.body.owner).toBe(USER_A_ID);
  });
});

// --- GET /api/expenses ---

describe('GET /api/expenses', () => {
  it('returns only the authenticated user expenses', async () => {
    await createExpense(tokenA, { description: 'User A expense' });
    await createExpense(tokenB, { description: 'User B expense' });

    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].description).toBe('User A expense');
  });

  it('returns empty data for user with no expenses', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('paginates correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await createExpense(tokenA, { description: `Expense ${i}`, amount: (i + 1) * 10 });
    }

    const page1 = await request(app)
      .get('/api/expenses?page=1&limit=2')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.total).toBe(5);
    expect(page1.body.pagination.totalPages).toBe(3);

    const page3 = await request(app)
      .get('/api/expenses?page=3&limit=2')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(page3.body.data).toHaveLength(1);
  });

  it('filters by paymentMethod', async () => {
    await createExpense(tokenA, { description: 'Cash lunch', paymentMethod: 'cash' });
    await createExpense(tokenA, { description: 'Card dinner', paymentMethod: 'credit_card', amount: 200 });

    const res = await request(app)
      .get('/api/expenses?paymentMethod=cash')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].paymentMethod).toBe('cash');
  });

  it('rejects invalid paymentMethod filter with 400', async () => {
    const res = await request(app)
      .get('/api/expenses?paymentMethod=bitcoin')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/expenses');
    expect(res.status).toBe(401);
  });

  it('sorts by date ascending', async () => {
    await createExpense(tokenA, { description: 'Old', date: '2026-01-01', amount: 10 });
    await createExpense(tokenA, { description: 'New', date: '2026-03-01', amount: 20 });

    const res = await request(app)
      .get('/api/expenses?sort=date&order=asc')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.data[0].description).toBe('Old');
    expect(res.body.data[1].description).toBe('New');
  });
});

// --- PUT /api/expenses/:id ---

describe('PUT /api/expenses/:id', () => {
  it('updates own expense successfully', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .put(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, description: 'Updated lunch', amount: 120 });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated lunch');
    expect(res.body.amount).toBe(120);
  });

  it('returns 404 when updating another user expense', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .put(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ ...validExpense, description: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent expense id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/expenses/${fakeId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validExpense);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request with 401', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .put(`/api/expenses/${created.body._id}`)
      .send(validExpense);
    expect(res.status).toBe(401);
  });

  it('rejects non-numeric amount on update with 400', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .put(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validExpense, amount: 'not-a-number' });
    expect(res.status).toBe(400);
  });
});

// --- DELETE /api/expenses/:id ---

describe('DELETE /api/expenses/:id', () => {
  it('deletes own expense successfully', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .delete(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted');

    const verify = await request(app)
      .get(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(verify.status).toBe(404);
  });

  it('returns 404 when deleting another user expense', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .delete(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);

    // Verify expense still exists for owner
    const verify = await request(app)
      .get(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(verify.status).toBe(200);
  });

  it('returns 404 for non-existent expense id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/expenses/${fakeId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request with 401', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .delete(`/api/expenses/${created.body._id}`);
    expect(res.status).toBe(401);
  });
});

// --- GET /api/expenses/:id ---

describe('GET /api/expenses/:id', () => {
  it('returns a single expense by id', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .get(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created.body._id);
    expect(res.body.description).toBe('Lunch');
  });

  it('returns 404 for another user expense', async () => {
    const created = await createExpense(tokenA);
    const res = await request(app)
      .get(`/api/expenses/${created.body._id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
