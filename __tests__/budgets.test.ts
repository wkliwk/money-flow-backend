process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';

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
  const user = await UserModel.create({ email: 'budget@example.com', password: 'password123' });
  userId = (user._id as mongoose.Types.ObjectId).toString();
  authToken = jwt.sign({ userId }, 'test-secret');
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

describe('GET /api/budgets', () => {
  it('returns empty array for new user', async () => {
    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.budgets).toEqual([]);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/budgets');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/budgets', () => {
  it('saves budget array', async () => {
    const budgets = [{ category: 'Food', limit: 500 }, { category: 'Transport', limit: 200 }];
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets });
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(2);
    expect(res.body.budgets[0].category).toBe('Food');
  });

  it('updates existing budgets (upsert)', async () => {
    await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 500 }] });

    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 800 }] });
    expect(res.status).toBe(200);
    expect(res.body.budgets[0].limit).toBe(800);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .send({ budgets: [{ category: 'Food', limit: 500 }] });
    expect(res.status).toBe(401);
  });

  it('rejects non-array budgets with 400', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: 'invalid' });
    expect(res.status).toBe(400);
  });
});
