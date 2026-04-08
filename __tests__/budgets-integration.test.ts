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
let userId: string;
let authToken: string;

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
    email: `budgettest-${Date.now()}@example.com`,
    password: 'password123',
    budgets: [],
  });
  authToken = jwt.sign({ userId }, 'test-secret');
});

// --- GET /api/budgets ---

describe('GET /api/budgets', () => {
  it('returns empty budgets array for new user', async () => {
    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.budgets).toEqual([]);
  });

  it('returns budgets after they are set', async () => {
    await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 500 }] });

    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].category).toBe('Food');
    expect(res.body.budgets[0].limit).toBe(500);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/budgets');
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent user', async () => {
    const fakeToken = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString() },
      'test-secret'
    );
    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(404);
  });
});

// --- PUT /api/budgets ---

describe('PUT /api/budgets', () => {
  it('saves multiple budgets', async () => {
    const budgets = [
      { category: 'Food', limit: 500 },
      { category: 'Transport', limit: 200 },
      { category: 'Entertainment', limit: 300 },
    ];
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets });
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(3);
  });

  it('replaces existing budgets on update', async () => {
    await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 500 }, { category: 'Transport', limit: 200 }] });

    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 800 }] });
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].limit).toBe(800);
  });

  it('filters out zero-limit budgets', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        budgets: [
          { category: 'Food', limit: 500 },
          { category: 'Removed', limit: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].category).toBe('Food');
  });

  it('rejects non-array budgets with 400', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('rejects missing category with 400', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ limit: 100 }] });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric limit with 400', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgets: [{ category: 'Food', limit: 'abc' }] });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .send({ budgets: [{ category: 'Food', limit: 500 }] });
    expect(res.status).toBe(401);
  });

  it('saves budgets with alert_threshold and enable_alerts', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        budgets: [
          { category: 'Food', limit: 500, alert_threshold: 0.75, enable_alerts: true },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.budgets[0].alert_threshold).toBe(0.75);
    expect(res.body.budgets[0].enable_alerts).toBe(true);
  });
});

// --- GET /api/budgets/summary ---

describe('GET /api/budgets/summary', () => {
  it('returns empty summary for user with no budgets', async () => {
    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual([]);
  });

  it('returns budget summary structure with correct fields', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [
          { category: 'Food', limit: 500, alert_threshold: 0.9, enable_alerts: true },
        ],
      },
    });

    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveLength(1);

    const food = res.body.summary[0];
    expect(food.category).toBe('Food');
    expect(food.limit).toBe(500);
    expect(typeof food.spend).toBe('number');
    expect(typeof food.remaining).toBe('number');
    expect(typeof food.percentUsed).toBe('number');
    expect(typeof food.exceeds).toBe('boolean');
    expect(typeof food.alertTriggered).toBe('boolean');
    expect(food.thresholdPercentage).toBe(90);
  });

  it('returns 404 for non-existent user', async () => {
    const fakeToken = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString() },
      'test-secret'
    );
    const res = await request(app)
      .get('/api/budgets/summary')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/budgets/summary');
    expect(res.status).toBe(401);
  });
});

// --- POST /api/budgets/:category/alerts ---

describe('POST /api/budgets/:category/alerts', () => {
  beforeEach(async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [
          { category: 'Food', limit: 500, enable_alerts: false },
        ],
      },
    });
  });

  it('enables alerts for an existing budget category', async () => {
    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: true });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('enabled');

    const user = await UserModel.findById(userId).lean();
    const foodBudget = user!.budgets.find((b) => b.category === 'Food');
    expect(foodBudget!.enable_alerts).toBe(true);
  });

  it('disables alerts for an existing budget category', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        budgets: [
          { category: 'Food', limit: 500, enable_alerts: true },
        ],
      },
    });

    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: false });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('disabled');
  });

  it('returns 404 for non-existent budget category', async () => {
    const res = await request(app)
      .post('/api/budgets/Shopping/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: true });
    expect(res.status).toBe(404);
  });

  it('rejects invalid enable_alerts value with 400', async () => {
    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enable_alerts: 'yes' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .post('/api/budgets/Food/alerts')
      .send({ enable_alerts: true });
    expect(res.status).toBe(401);
  });
});

// --- User isolation ---

describe('Budget user isolation', () => {
  it('does not return budgets from other users', async () => {
    await UserModel.findByIdAndUpdate(userId, {
      $set: { budgets: [{ category: 'Food', limit: 500 }] },
    });

    const otherOid = new mongoose.Types.ObjectId();
    await UserModel.create({
      _id: otherOid,
      email: `other-${Date.now()}@example.com`,
      password: 'password123',
      budgets: [{ category: 'Transport', limit: 999 }],
    });
    const otherToken = jwt.sign({ userId: otherOid.toString() }, 'test-secret');

    const resA = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`);
    expect(resA.body.budgets).toHaveLength(1);
    expect(resA.body.budgets[0].category).toBe('Food');

    const resB = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(resB.body.budgets).toHaveLength(1);
    expect(resB.body.budgets[0].category).toBe('Transport');
  });
});
