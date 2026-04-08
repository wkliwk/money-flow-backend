import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import jwt from 'jsonwebtoken';
import UserModel from '../models/User';
import notificationsRouter from './notifications';
import { protect } from '../middleware/auth';

const JWT_SECRET = 'test-secret-key';
let mongoServer: MongoMemoryServer;
let testApp: express.Application;
let testUserId: string;
let authToken: string;

const validToken = 'ExponentPushToken[abc123]';

describe('Notifications API', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;

    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    await mongoose.connect(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
    });

    testApp = express();
    testApp.use(express.json());
    testApp.use('/api/notifications', notificationsRouter);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    const user = await UserModel.create({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });
    testUserId = (user._id as mongoose.Types.ObjectId).toString();
    authToken = jwt.sign({ userId: testUserId }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await UserModel.deleteMany({});
  });

  describe('POST /api/notifications/register', () => {
    it('stores expo push token', async () => {
      const res = await request(testApp)
        .post('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ token: validToken });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const user = await UserModel.findById(testUserId).lean();
      expect(user?.expoPushToken).toBe(validToken);
    });

    it('stores notification preferences', async () => {
      const prefs = { budgetAlerts: true, weeklySummary: false, unusualSpending: true };

      const res = await request(testApp)
        .post('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ token: validToken, prefs });

      expect(res.status).toBe(200);

      const user = await UserModel.findById(testUserId).lean();
      expect(user?.pushNotificationPrefs?.weeklySummary).toBe(false);
      expect(user?.pushNotificationPrefs?.budgetAlerts).toBe(true);
    });

    it('rejects invalid token format', async () => {
      const res = await request(testApp)
        .post('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ token: 'not-a-valid-expo-token' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('rejects missing token', async () => {
      const res = await request(testApp)
        .post('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated request with 401', async () => {
      const res = await request(testApp)
        .post('/api/notifications/register')
        .send({ token: validToken });

      expect(res.status).toBe(401);
    });

    it('accepts ExpoPushToken format', async () => {
      const res = await request(testApp)
        .post('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ token: 'ExpoPushToken[xyz456]' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/notifications/register', () => {
    it('removes push token from user', async () => {
      await UserModel.findByIdAndUpdate(testUserId, { expoPushToken: validToken });

      const res = await request(testApp)
        .delete('/api/notifications/register')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const user = await UserModel.findById(testUserId).lean();
      expect(user?.expoPushToken).toBeUndefined();
    });

    it('rejects unauthenticated request', async () => {
      const res = await request(testApp).delete('/api/notifications/register');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/notifications/prefs', () => {
    it('updates notification preferences', async () => {
      const res = await request(testApp)
        .put('/api/notifications/prefs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ budgetAlerts: false, weeklySummary: true });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const user = await UserModel.findById(testUserId).lean();
      expect(user?.pushNotificationPrefs?.budgetAlerts).toBe(false);
      expect(user?.pushNotificationPrefs?.weeklySummary).toBe(true);
    });

    it('returns 400 when no valid preferences provided', async () => {
      const res = await request(testApp)
        .put('/api/notifications/prefs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated request', async () => {
      const res = await request(testApp)
        .put('/api/notifications/prefs')
        .send({ budgetAlerts: false });

      expect(res.status).toBe(401);
    });
  });
});
