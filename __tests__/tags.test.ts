process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import tagRoutes from '../src/routes/tags';
import expenseRoutes from '../src/routes/expenses';
import TagModel from '../src/models/Tag';
import ExpenseModel from '../src/models/Expense';

const JWT_SECRET = 'test-secret';

const generateToken = (userId: string) => jwt.sign({ userId }, JWT_SECRET);

let mongoServer: MongoMemoryServer;
let app: express.Application;

const USER_A = new mongoose.Types.ObjectId().toString();
const USER_B = new mongoose.Types.ObjectId().toString();
const TOKEN_A = generateToken(USER_A);
const TOKEN_B = generateToken(USER_B);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use('/api/tags', tagRoutes);
  app.use('/api/expenses', expenseRoutes);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await TagModel.deleteMany({});
  await ExpenseModel.deleteMany({});
});

// ─── POST /api/tags ───────────────────────────────────────────────────────────

describe('POST /api/tags', () => {
  it('creates a tag with name and default color', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Food' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Food');
    expect(res.body.color).toBe('#6366f1');
    expect(res.body.owner).toBe(USER_A);
  });

  it('creates a tag with custom color', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Transport', color: '#ff5733' });

    expect(res.status).toBe(201);
    expect(res.body.color).toBe('#ff5733');
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ color: '#ff0000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects invalid color format', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Health', color: 'red' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hex/i);
  });

  it('rejects duplicate tag name (case-insensitive) for same user', async () => {
    await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Food' });

    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'food' });

    expect(res.status).toBe(409);
  });

  it('allows same tag name for different users', async () => {
    await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Food' });

    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_B}`)
      .send({ name: 'Food' });

    expect(res.status).toBe(201);
  });

  it('enforces max 50 tags per user', async () => {
    const insertOps = Array.from({ length: 50 }, (_, i) => ({
      name: `Tag${i}`,
      color: '#aabbcc',
      owner: USER_A,
    }));
    await TagModel.insertMany(insertOps);

    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Overflow' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50/);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).post('/api/tags').send({ name: 'Food' });
    expect(res.status).toBe(401);
  });

  it('rejects name longer than 50 characters', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'A'.repeat(51) });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/tags ────────────────────────────────────────────────────────────

describe('GET /api/tags', () => {
  it('returns tags for the authenticated user only', async () => {
    await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    await TagModel.create({ name: 'Other', color: '#00ff00', owner: USER_B });

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Food');
  });

  it('returns empty array when user has no tags', async () => {
    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns tags sorted alphabetically', async () => {
    await TagModel.insertMany([
      { name: 'Zebra', color: '#aaaaaa', owner: USER_A },
      { name: 'Apple', color: '#bbbbbb', owner: USER_A },
      { name: 'Mango', color: '#cccccc', owner: USER_A },
    ]);

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/tags/:id ────────────────────────────────────────────────────────

describe('PUT /api/tags/:id', () => {
  it('updates tag name and color', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });

    const res = await request(app)
      .put(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Groceries', color: '#00ff00' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Groceries');
    expect(res.body.color).toBe('#00ff00');
  });

  it('returns 404 for non-existent tag', async () => {
    const res = await request(app)
      .put(`/api/tags/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(404);
  });

  it('returns 404 for invalid ObjectId', async () => {
    const res = await request(app)
      .put('/api/tags/not-an-id')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(404);
  });

  it('prevents updating to a duplicate name (case-insensitive)', async () => {
    const tag1 = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    await TagModel.create({ name: 'Transport', color: '#00ff00', owner: USER_A });

    const res = await request(app)
      .put(`/api/tags/${tag1._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'transport' });

    expect(res.status).toBe(409);
  });

  it('allows updating name to same name (no conflict with self)', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });

    const res = await request(app)
      .put(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Food', color: '#123456' });

    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#123456');
  });

  it('cannot update another user\'s tag', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_B });

    const res = await request(app)
      .put(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    const res = await request(app).put(`/api/tags/${tag._id}`).send({ name: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/tags/:id ─────────────────────────────────────────────────────

describe('DELETE /api/tags/:id', () => {
  it('deletes a tag', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });

    const res = await request(app)
      .delete(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Tag deleted');

    const deleted = await TagModel.findById(tag._id);
    expect(deleted).toBeNull();
  });

  it('removes tag from associated expenses', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    const expense = await ExpenseModel.create({
      owner: USER_A,
      amount: 50,
      tags: [tag._id],
    });

    await request(app)
      .delete(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    const updatedExpense = await ExpenseModel.findById(expense._id).lean();
    expect(updatedExpense?.tags).toHaveLength(0);
  });

  it('returns 404 for non-existent tag', async () => {
    const res = await request(app)
      .delete(`/api/tags/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for invalid ObjectId', async () => {
    const res = await request(app)
      .delete('/api/tags/not-an-id')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });

  it('cannot delete another user\'s tag', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_B });

    const res = await request(app)
      .delete(`/api/tags/${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);

    const stillExists = await TagModel.findById(tag._id);
    expect(stillExists).not.toBeNull();
  });

  it('rejects unauthenticated request', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    const res = await request(app).delete(`/api/tags/${tag._id}`);
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/expenses/:id — tag support ──────────────────────────────────────

describe('PUT /api/expenses/:id — tag support', () => {
  it('adds tags to a transaction', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    const expense = await ExpenseModel.create({ owner: USER_A, amount: 100 });

    const res = await request(app)
      .put(`/api/expenses/${expense._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ amount: 100, tags: [tag._id.toString()] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(1);
    expect(res.body.tags[0].toString()).toBe(tag._id.toString());
  });

  it('clears tags when empty array is provided', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    const expense = await ExpenseModel.create({
      owner: USER_A,
      amount: 100,
      tags: [tag._id],
    });

    const res = await request(app)
      .put(`/api/expenses/${expense._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ amount: 100, tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(0);
  });

  it('rejects more than 10 tags', async () => {
    const expense = await ExpenseModel.create({ owner: USER_A, amount: 50 });
    const fakeIds = Array.from({ length: 11 }, () => new mongoose.Types.ObjectId().toString());

    const res = await request(app)
      .put(`/api/expenses/${expense._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ amount: 50, tags: fakeIds });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10/);
  });

  it('rejects tag IDs that belong to a different user', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_B });
    const expense = await ExpenseModel.create({ owner: USER_A, amount: 50 });

    const res = await request(app)
      .put(`/api/expenses/${expense._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ amount: 50, tags: [tag._id.toString()] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|do not belong/i);
  });

  it('rejects invalid tag ID format', async () => {
    const expense = await ExpenseModel.create({ owner: USER_A, amount: 50 });

    const res = await request(app)
      .put(`/api/expenses/${expense._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ amount: 50, tags: ['not-an-id'] });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/expenses?tag=tagId ──────────────────────────────────────────────

describe('GET /api/expenses?tag=tagId', () => {
  it('filters expenses by tag', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    await ExpenseModel.create({ owner: USER_A, amount: 100, tags: [tag._id] });
    await ExpenseModel.create({ owner: USER_A, amount: 200 });

    const res = await request(app)
      .get(`/api/expenses?tag=${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount).toBe(100);
  });

  it('returns empty array when no expenses match the tag', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    await ExpenseModel.create({ owner: USER_A, amount: 200 });

    const res = await request(app)
      .get(`/api/expenses?tag=${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 400 for invalid tag ID format', async () => {
    const res = await request(app)
      .get('/api/expenses?tag=not-an-id')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tag ID/);
  });

  it('does not return expenses tagged by other users with same tag ID shape', async () => {
    const tag = await TagModel.create({ name: 'Food', color: '#ff0000', owner: USER_A });
    // B's expense also has the tag (shouldn't happen in practice, but test the owner filter)
    await ExpenseModel.create({ owner: USER_B, amount: 999, tags: [tag._id] });

    const res = await request(app)
      .get(`/api/expenses?tag=${tag._id}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
