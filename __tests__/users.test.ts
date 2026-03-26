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
  const user = await UserModel.create({ email: 'user@example.com', password: 'password123' });
  userId = (user._id as mongoose.Types.ObjectId).toString();
  authToken = jwt.sign({ userId }, 'test-secret');
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

describe('GET /api/users/me', () => {
  it('returns user profile without password', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user@example.com');
    expect(res.body.user.password).toBeUndefined();
  });

  it('includes themePreference with default value system', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.themePreference).toBe('system');
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/preferences', () => {
  it('updates themePreference to light', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'light' });
    expect(res.status).toBe(200);
    expect(res.body.user.themePreference).toBe('light');
  });

  it('updates themePreference to dark', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.user.themePreference).toBe('dark');
  });

  it('updates themePreference to system', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'system' });
    expect(res.status).toBe(200);
    expect(res.body.user.themePreference).toBe('system');
  });

  it('persists themePreference — visible on GET /me after update', async () => {
    await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'dark' });

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.themePreference).toBe('dark');
  });

  it('rejects invalid themePreference value with 400', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'purple' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/themePreference/);
  });

  it('rejects missing themePreference with 400', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('does not return password in response', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ themePreference: 'light' });
    expect(res.status).toBe(200);
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .patch('/api/users/preferences')
      .send({ themePreference: 'light' });
    expect(res.status).toBe(401);
  });
});
