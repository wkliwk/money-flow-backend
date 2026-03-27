process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import UserModel from '../src/models/User';

jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
    })),
    __mockVerifyIdToken: mockVerifyIdToken,
  };
});

const { __mockVerifyIdToken: mockVerifyIdToken } =
  jest.requireMock('google-auth-library') as { __mockVerifyIdToken: jest.Mock };

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
  mockVerifyIdToken.mockReset();
});

const mockGooglePayload = (email: string, sub: string) => {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ email, sub }),
  });
};

describe('POST /auth/google', () => {
  it('creates new user and returns token for new Google user', async () => {
    mockGooglePayload('google@example.com', 'google-uid-123');

    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'valid-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const user = await UserModel.findOne({ email: 'google@example.com' });
    expect(user).toBeTruthy();
    expect(user!.googleId).toBe('google-uid-123');
    expect(user!.password).toBeUndefined();
  });

  it('returns token for existing Google user', async () => {
    await UserModel.create({
      email: 'existing@example.com',
      googleId: 'google-uid-456',
    });
    mockGooglePayload('existing@example.com', 'google-uid-456');

    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'valid-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('links Google account to existing email/password user', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'linkme@example.com', password: 'password123' });

    mockGooglePayload('linkme@example.com', 'google-uid-789');

    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'valid-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const user = await UserModel.findOne({ email: 'linkme@example.com' });
    expect(user!.googleId).toBe('google-uid-789');
    expect(user!.password).toBeDefined();
  });

  it('rejects missing idToken with 400', async () => {
    const res = await request(app).post('/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('rejects invalid Google token with 401', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'invalid-token' });

    expect(res.status).toBe(401);
  });

  it('rejects token with no email with 401', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'no-email-user' }),
    });

    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'token-no-email' });

    expect(res.status).toBe(401);
  });
});
