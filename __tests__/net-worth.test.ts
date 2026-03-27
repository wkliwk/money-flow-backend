process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import NetWorthModel from '../src/models/NetWorth';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_networth';
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
  jest.restoreAllMocks();
});

describe('GET /api/net-worth', () => {
  it('returns empty array initially', async () => {
    const res = await request(app)
      .get('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('filters snapshots by months query (clamped to max 24)', async () => {
    const now = new Date();
    const olderThan24Months = new Date(now);
    olderThan24Months.setMonth(olderThan24Months.getMonth() - 25);

    const within24Months = new Date(now);
    within24Months.setMonth(within24Months.getMonth() - 2);

    await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: olderThan24Months,
      assets: { cash: 1 },
      liabilities: { loans: 1 },
    });
    await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: within24Months,
      assets: { cash: 999 },
      liabilities: { loans: 0 },
    });

    const res = await request(app)
      .get('/api/net-worth?months=100')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].assets.cash).toBe(999);
  });
});

describe('POST /api/net-worth', () => {
  it('creates a net worth entry', async () => {
    const res = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        assets: { cash: 10000, investments: 5000 },
        liabilities: { creditCardDebt: 2000 },
      });
    expect(res.status).toBe(201);
    expect(res.body.assets.cash).toBe(10000);
    expect(res.body.liabilities.creditCardDebt).toBe(2000);
  });

  it('returns 400 when assets is not an object', async () => {
    const res = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: 'not-an-object' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when liabilities is not an object', async () => {
    const res = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        assets: { cash: 1000 },
        liabilities: 'not-an-object'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 with message when saving fails', async () => {
    jest.spyOn(NetWorthModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db fail'));

    const res = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        assets: { cash: 123 },
        liabilities: { loans: 5 },
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Failed to save net worth snapshot' });
  });
});

describe('GET /api/net-worth/latest', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/net-worth/latest');
    expect(res.status).toBe(401);
  });

  it('returns null when no snapshots exist', async () => {
    const res = await request(app)
      .get('/api/net-worth/latest')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns the latest snapshot by date', async () => {
    await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-01-01T00:00:00.000Z'),
      assets: { cash: 1 },
      liabilities: { loans: 0 },
    });
    await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-02-01T00:00:00.000Z'),
      assets: { cash: 2 },
      liabilities: { loans: 0 },
    });

    const res = await request(app)
      .get('/api/net-worth/latest')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.assets.cash).toBe(2);
  });
});

describe('PUT /api/net-worth/:snapshotId', () => {
  it('updates a snapshot', async () => {
    const created = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 10 }, liabilities: {} });

    const snapshotId = created.body._id;

    const res = await request(app)
      .put(`/api/net-worth/${snapshotId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 77 }, liabilities: { loans: 3 } });

    expect(res.status).toBe(200);
    expect(res.body.assets.cash).toBe(77);
    expect(res.body.liabilities.loans).toBe(3);
  });

  it('returns 404 when snapshot does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .put(`/api/net-worth/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 1 }, liabilities: {} });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('does not reject when assets is not an object (PUT handler does not check validationResult)', async () => {
    const created = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 10 }, liabilities: {} });

    const snapshotId = created.body._id;

    const res = await request(app)
      .put(`/api/net-worth/${snapshotId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: 'nope' });

    expect(res.status).toBe(200);
    expect(res.body.assets).toBeDefined();
  });

  it('returns 400 when update throws', async () => {
    const created = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 10 }, liabilities: {} });

    const snapshotId = created.body._id;

    jest.spyOn(NetWorthModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db fail'));

    const res = await request(app)
      .put(`/api/net-worth/${snapshotId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 99 }, liabilities: {} });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Failed to update snapshot' });
  });
});

describe('DELETE /api/net-worth/:id', () => {
  it('deletes entry', async () => {
    const created = await request(app)
      .post('/api/net-worth')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ assets: { cash: 1000 }, liabilities: {} });
    const id = created.body._id;

    const res = await request(app)
      .delete(`/api/net-worth/${id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted');
  });

  it('returns 404 for non-existent id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/net-worth/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });
});
