import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectTestDB, closeTestDB, clearTestDB } from './setup';

process.env.JWT_SECRET = 'test-secret';

function makeToken(userId: string) {
  return jwt.sign({ userId }, 'test-secret');
}

let token: string;
let userId: string;

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await closeTestDB(); });
beforeEach(async () => {
  await clearTestDB();
  // Register and get token
  const res = await request(app).post('/auth/register').send({ email: 'e@test.com', password: 'password123' });
  token = res.body.token;
  // Decode userId from token
  const decoded = jwt.verify(token, 'test-secret') as { userId: string };
  userId = decoded.userId;
});

describe('GET /api/expenses', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/expenses');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no expenses', async () => {
    const res = await request(app).get('/api/expenses').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/expenses', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/expenses').send({ amount: 100, type: 'expense' });
    expect(res.status).toBe(401);
  });

  it('creates an expense and returns it', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150, type: 'expense', description: 'lunch', date: '2026-03-01' });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(150);
    expect(res.body.owner).toBe(userId);
  });

  it('returns 400 for missing amount', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'expense', description: 'test' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/expenses/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/expenses/507f1f77bcf86cd799439011').send({ amount: 200 });
    expect(res.status).toBe(401);
  });

  it('updates an expense', async () => {
    const create = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, type: 'expense', description: 'coffee' });
    const id = create.body._id;

    const res = await request(app)
      .put(`/api/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 200, description: 'fancy coffee' });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(200);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .put('/api/expenses/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 200 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/expenses/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/expenses/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('deletes an expense', async () => {
    const create = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, type: 'expense', description: 'tea' });
    const id = create.body._id;

    const res = await request(app)
      .delete(`/api/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    // Verify it's gone
    const check = await request(app).get('/api/expenses').set('Authorization', `Bearer ${token}`);
    expect(check.body).toHaveLength(0);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .delete('/api/expenses/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
