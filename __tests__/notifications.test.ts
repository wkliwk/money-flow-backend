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
  const user = await UserModel.create({ email: 'notif@example.com', password: 'password123' });
  userId = (user._id as mongoose.Types.ObjectId).toString();
  authToken = jwt.sign({ userId }, 'test-secret');
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

const validToken = 'ExponentPushToken[abc123]';

describe('POST /api/notifications/register', () => {
  it('stores expo push token for authenticated user', async () => {
    const res = await request(app)
      .post('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: validToken });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await UserModel.findById(userId).lean();
    expect(user?.expoPushToken).toBe(validToken);
  });

  it('stores notification preferences alongside token', async () => {
    const prefs = { budgetAlerts: true, weeklySummary: false, unusualSpending: true };

    const res = await request(app)
      .post('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: validToken, prefs });

    expect(res.status).toBe(200);

    const user = await UserModel.findById(userId).lean();
    expect(user?.pushNotificationPrefs?.weeklySummary).toBe(false);
    expect(user?.pushNotificationPrefs?.budgetAlerts).toBe(true);
  });

  it('rejects invalid token format', async () => {
    const res = await request(app)
      .post('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: 'not-a-valid-expo-token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects missing token', async () => {
    const res = await request(app)
      .post('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .post('/api/notifications/register')
      .send({ token: validToken });

    expect(res.status).toBe(401);
  });

  it('accepts ExpoPushToken format as well', async () => {
    const res = await request(app)
      .post('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: 'ExpoPushToken[xyz456]' });

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/notifications/register', () => {
  it('removes push token from user', async () => {
    await UserModel.findByIdAndUpdate(userId, { expoPushToken: validToken });

    const res = await request(app)
      .delete('/api/notifications/register')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await UserModel.findById(userId).lean();
    expect(user?.expoPushToken).toBeUndefined();
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).delete('/api/notifications/register');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/notifications/prefs', () => {
  it('updates notification preferences', async () => {
    const res = await request(app)
      .put('/api/notifications/prefs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ budgetAlerts: false, weeklySummary: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await UserModel.findById(userId).lean();
    expect(user?.pushNotificationPrefs?.budgetAlerts).toBe(false);
    expect(user?.pushNotificationPrefs?.weeklySummary).toBe(true);
  });

  it('returns 400 when no valid preferences provided', async () => {
    const res = await request(app)
      .put('/api/notifications/prefs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).put('/api/notifications/prefs').send({ budgetAlerts: false });
    expect(res.status).toBe(401);
  });
});
