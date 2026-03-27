process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_123';
const OTHER_USER_ID = 'user_other_456';
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
});

const basePayload = {
  description: 'Test expense',
  amount: 100,
  type: 'expense',
  category: 'Food',
};

async function createExpense(overrides = {}) {
  const res = await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ ...basePayload, ...overrides });
  return res.body;
}

describe('GET /api/expenses', () => {
  it('returns paginated results', async () => {
    await createExpense({ description: 'Expense 1' });
    await createExpense({ description: 'Expense 2' });
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pages).toBeDefined();
  });

  it('supports pagination with page=2', async () => {
    for (let i = 0; i < 3; i++) {
      await createExpense({ description: `Expense ${i}` });
    }
    const res = await request(app)
      .get('/api/expenses?page=2&limit=2')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns pagination object in response', async () => {
    await createExpense();
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(50);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  it('caps limit at 200', async () => {
    await createExpense();
    const res = await request(app)
      .get('/api/expenses?limit=500')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.pagination.limit).toBe(200);
  });

  it('sorts by amount ascending', async () => {
    await createExpense({ amount: 300, description: 'Expensive' });
    await createExpense({ amount: 50, description: 'Cheap' });
    await createExpense({ amount: 150, description: 'Medium' });
    const res = await request(app)
      .get('/api/expenses?sort=amount&order=asc')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.data[0].amount).toBe(50);
    expect(res.body.data[1].amount).toBe(150);
    expect(res.body.data[2].amount).toBe(300);
  });

  it('sorts by amount descending', async () => {
    await createExpense({ amount: 300, description: 'Expensive' });
    await createExpense({ amount: 50, description: 'Cheap' });
    await createExpense({ amount: 150, description: 'Medium' });
    const res = await request(app)
      .get('/api/expenses?sort=amount&order=desc')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.data[0].amount).toBe(300);
    expect(res.body.data[2].amount).toBe(50);
  });

  it('ignores invalid sort fields', async () => {
    await createExpense();
    const res = await request(app)
      .get('/api/expenses?sort=invalid')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/expenses/:id', () => {
  it('returns specific expense', async () => {
    const created = await createExpense();
    const res = await request(app)
      .get(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created._id);
  });

  it('returns 404 for non-existent id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .get(`/api/expenses/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/expenses', () => {
  it('creates expense and forces owner to req.userId', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, owner: 'hacker_id' });
    expect(res.status).toBe(201);
    expect(res.body.owner).toBe(TEST_USER_ID);
  });

  it('detects exact duplicates (same amount, exact description)', async () => {
    await createExpense({ description: 'Coffee', amount: 5 });
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'Coffee', amount: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Potential duplicate detected');
  });

  it('detects similar duplicates (90%+ similarity)', async () => {
    await createExpense({ description: 'Starbucks Coffee', amount: 7.50 });
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'Starbucks Coffe', amount: 7.50 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Potential duplicate detected');
  });

  it('allows different amounts with same description', async () => {
    await createExpense({ description: 'Coffee', amount: 5 });
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'Coffee', amount: 6 });
    expect(res.status).toBe(201);
  });

  it('allows similar description with different amount', async () => {
    await createExpense({ description: 'Coffee', amount: 5 });
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'Coffe', amount: 10 });
    expect(res.status).toBe(201);
  });


  it('isolates duplicates per user', async () => {
    await createExpense({ description: 'Coffee', amount: 5 });
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...basePayload, description: 'Coffee', amount: 5 });
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/expenses/:id', () => {
  it('updates expense', async () => {
    const created = await createExpense();
    const res = await request(app)
      .put(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, description: 'Updated', amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated');
    expect(res.body.amount).toBe(200);
  });

  it('returns 404 for wrong owner', async () => {
    const created = await createExpense();
    const res = await request(app)
      .put(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...basePayload, description: 'Hacked' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/expenses/:id', () => {
  it('deletes expense', async () => {
    const created = await createExpense();
    const res = await request(app)
      .delete(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted');
  });

  it('returns 404 for wrong owner', async () => {
    const created = await createExpense();
    const res = await request(app)
      .delete(`/api/expenses/${created._id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});
