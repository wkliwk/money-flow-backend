process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';
import GoalModel from '../src/models/Goal';

let mongod: MongoMemoryServer;
let authToken: string;
let userId: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const user = await UserModel.create({ email: 'goals@example.com', password: 'password123' });
  userId = (user._id as mongoose.Types.ObjectId).toString();
  authToken = jwt.sign({ userId }, 'test-secret');
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

describe('GET /api/goals', () => {
  it('returns empty array for new user', async () => {
    const res = await request(app)
      .get('/api/goals')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.goals).toEqual([]);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/goals');
    expect(res.status).toBe(401);
  });

  it('returns only goals belonging to the authenticated user', async () => {
    await GoalModel.create({ userId, name: 'My Goal', targetAmount: 1000 });
    await GoalModel.create({ userId: 'other-user-id', name: 'Other Goal', targetAmount: 500 });

    const res = await request(app)
      .get('/api/goals')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.goals).toHaveLength(1);
    expect(res.body.goals[0].name).toBe('My Goal');
  });
});

describe('POST /api/goals', () => {
  it('creates a goal with required fields', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Emergency Fund', targetAmount: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.goal.name).toBe('Emergency Fund');
    expect(res.body.goal.targetAmount).toBe(5000);
    expect(res.body.goal.currentAmount).toBe(0);
  });

  it('creates a goal with all fields', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Vacation',
        targetAmount: 3000,
        currentAmount: 500,
        deadline: '2026-12-31T00:00:00.000Z',
        category: 'Travel',
      });
    expect(res.status).toBe(201);
    expect(res.body.goal.currentAmount).toBe(500);
    expect(res.body.goal.category).toBe('Travel');
    expect(res.body.goal.deadline).toBeDefined();
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ targetAmount: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('name is required');
  });

  it('rejects missing targetAmount', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('targetAmount must be a number');
  });

  it('rejects invalid deadline', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test', targetAmount: 1000, deadline: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('deadline must be a valid ISO date');
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/goals')
      .send({ name: 'Test', targetAmount: 1000 });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/goals/:id', () => {
  it('updates a goal', async () => {
    const goal = await GoalModel.create({ userId, name: 'Old Name', targetAmount: 1000 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'New Name', currentAmount: 250 });
    expect(res.status).toBe(200);
    expect(res.body.goal.name).toBe('New Name');
    expect(res.body.goal.currentAmount).toBe(250);
  });

  it('returns 404 for non-existent goal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/goals/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('prevents updating another user goal', async () => {
    const goal = await GoalModel.create({ userId: 'other-user-id', name: 'Other', targetAmount: 500 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('rejects invalid targetAmount', async () => {
    const goal = await GoalModel.create({ userId, name: 'Test', targetAmount: 1000 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ targetAmount: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/goals/:id', () => {
  it('deletes a goal', async () => {
    const goal = await GoalModel.create({ userId, name: 'Delete Me', targetAmount: 1000 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .delete(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const found = await GoalModel.findById(goalId);
    expect(found).toBeNull();
  });

  it('returns 404 for non-existent goal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/goals/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('prevents deleting another user goal', async () => {
    const goal = await GoalModel.create({ userId: 'other-user-id', name: 'Not Mine', targetAmount: 500 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .delete(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const goal = await GoalModel.create({ userId, name: 'Test', targetAmount: 1000 });
    const goalId = (goal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app).delete(`/api/goals/${goalId}`);
    expect(res.status).toBe(401);
  });
});
