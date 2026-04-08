process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.APPLE_CLIENT_ID = 'test-apple-client-id';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import UserModel from '../src/models/User';

jest.mock('apple-signin-auth', () => ({
  verifyIdToken: jest.fn(),
}));

import appleSignin from 'apple-signin-auth';
const mockVerify = appleSignin.verifyIdToken as jest.Mock;

let mongod: MongoMemoryServer;

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
  mockVerify.mockReset();
});

describe('POST /auth/apple', () => {
  it('creates new user and returns token for new Apple user', async () => {
    mockVerify.mockResolvedValue({
      email: 'apple@example.com',
      sub: 'apple-uid-123',
    });

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'valid-apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const user = await UserModel.findOne({ email: 'apple@example.com' });
    expect(user).toBeTruthy();
    expect(user!.appleId).toBe('apple-uid-123');
    expect(user!.password).toBeUndefined();
  });

  it('returns token for existing Apple user', async () => {
    await UserModel.create({
      email: 'existing@example.com',
      appleId: 'apple-uid-456',
    });
    mockVerify.mockResolvedValue({
      email: 'existing@example.com',
      sub: 'apple-uid-456',
    });

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'valid-apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('links Apple account to existing email/password user', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'linkme@example.com', password: 'password123' });

    mockVerify.mockResolvedValue({
      email: 'linkme@example.com',
      sub: 'apple-uid-789',
    });

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'valid-apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const user = await UserModel.findOne({ email: 'linkme@example.com' });
    expect(user!.appleId).toBe('apple-uid-789');
    expect(user!.password).toBeDefined();
  });

  it('handles Apple relay email addresses', async () => {
    mockVerify.mockResolvedValue({
      email: 'abcdef@privaterelay.appleid.com',
      sub: 'apple-uid-relay',
    });

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'valid-apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const user = await UserModel.findOne({ email: 'abcdef@privaterelay.appleid.com' });
    expect(user).toBeTruthy();
    expect(user!.appleId).toBe('apple-uid-relay');
  });

  it('rejects missing idToken with 400', async () => {
    const res = await request(app).post('/auth/apple').send({});
    expect(res.status).toBe(400);
  });

  it('rejects invalid Apple token with 401', async () => {
    mockVerify.mockRejectedValue(new Error('Invalid token'));

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'invalid-token' });

    expect(res.status).toBe(401);
  });

  it('rejects token with no email with 401', async () => {
    mockVerify.mockResolvedValue({ sub: 'no-email-user' });

    const res = await request(app)
      .post('/auth/apple')
      .send({ idToken: 'token-no-email' });

    expect(res.status).toBe(401);
  });
});
