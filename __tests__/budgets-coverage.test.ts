process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
let authToken: string;
let userId: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  const oid = new mongoose.Types.ObjectId();
  userId = oid.toString();
  await UserModel.create({
    _id: oid,
    email: `budget-cov-${Date.now()}@example.com`,
    password: 'password123',
    budgets: [],
  });
  authToken = jwt.sign({ userId }, 'test-secret');
}, 15000);

describe('GET /api/budgets/summary', () => {
  it('returns empty summary when user has no budgets', async () => {
    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual([]);
  });

  it('returns budget summary with budgets defined', async () => {
    // Set up budgets
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [
          { category: 'Food', limit: 500, alert_threshold: 0.9, enable_alerts: true },
          { category: 'Transport', limit: 200, alert_threshold: 0.8, enable_alerts: false },
        ],
      },
    });

    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveLength(2);

    const food = res.body.summary.find((s: { category: string }) => s.category === 'Food');
    expect(food).toBeDefined();
    expect(food.limit).toBe(500);
    expect(food.category).toBe('Food');
    expect(typeof food.spend).toBe('number');
    expect(typeof food.remaining).toBe('number');
    expect(typeof food.percentUsed).toBe('number');
    expect(typeof food.exceeds).toBe('boolean');
    expect(food.thresholdPercentage).toBe(90);

    const transport = res.body.summary.find((s: { category: string }) => s.category === 'Transport');
    expect(transport).toBeDefined();
    expect(transport.limit).toBe(200);
    expect(transport.thresholdPercentage).toBe(80);
  });

  it('returns correct structure for budget with no matching expenses', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [
          { category: 'Food', limit: 100, alert_threshold: 0.9, enable_alerts: true },
        ],
      },
    });

    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    const food = res.body.summary[0];
    // No expenses, so spend should be 0
    expect(food.spend).toBe(0);
    expect(food.remaining).toBe(100);
    expect(food.exceeds).toBe(false);
    expect(food.alertTriggered).toBe(false);
    expect(food.percentUsed).toBe(0);
  });

  it('handles zero-limit budget gracefully', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [{ category: 'Test', limit: 0, enable_alerts: false }],
      },
    });

    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary[0].percentUsed).toBe(0);
  });

  it('returns 404 for invalid user', async () => {
    const fakeToken = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, 'test-secret');
    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(404);
  });

  it('handles budget with enable_alerts false', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [{ category: 'Uncategorized', limit: 100, enable_alerts: false }],
      },
    });

    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    // alertTriggered should be false when enable_alerts is false even if exceeds
    expect(res.body.summary[0].alertTriggered).toBe(false);
  });
});

describe('GET /api/budgets - user not found', () => {
  it('returns 404 when user does not exist', async () => {
    const fakeToken = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, 'test-secret');
    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/budgets/:category/alerts', () => {
  it('returns 400 for invalid enable_alerts value', async () => {
    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: 'not-a-bool' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when budget not found for category', async () => {
    const res = await request(app)
      .post('/api/budgets/Nonexistent/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: true });
    expect(res.status).toBe(404);
  });

  it('returns 404 when user not found', async () => {
    const fakeToken = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, 'test-secret');
    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ enable_alerts: true });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/budgets - validation', () => {
  it('filters out budgets with zero limit', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        budgets: [
          { category: 'Food', limit: 500 },
          { category: 'Zero', limit: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].category).toBe('Food');
  });

  it('rejects missing category', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ limit: 100 }] });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric limit', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 'abc' }] });
    expect(res.status).toBe(400);
  });

  it('saves budgets with alert_threshold and enable_alerts', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        budgets: [
          { category: 'Food', limit: 500, alert_threshold: 0.8, enable_alerts: true },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.budgets[0].alert_threshold).toBe(0.8);
  });
});
