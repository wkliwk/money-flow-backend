process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
});

// --- POST /auth/register ---

describe('POST /auth/register', () => {
  it('returns a valid JWT on successful registration', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'new@example.com', password: 'securePass1' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();

    const decoded = jwt.verify(res.body.token, 'test-secret') as { userId: string };
    expect(decoded.userId).toBeDefined();
  });

  it('normalises email to lowercase', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'UPPER@Example.COM', password: 'password123' });
    expect(res.status).toBe(201);

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'upper@example.com', password: 'password123' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects missing password with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid email format with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects empty body with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects password with exactly 5 characters (boundary)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', password: '12345' });
    expect(res.status).toBe(400);
  });

  it('accepts password with exactly 6 characters (boundary)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'sixchar@example.com', password: '123456' });
    expect(res.status).toBe(201);
  });
});

// --- POST /auth/login ---

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'password123' });
  });

  it('returns a valid JWT on successful login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    const decoded = jwt.verify(res.body.token, 'test-secret') as { userId: string };
    expect(decoded.userId).toBeDefined();
  });

  it('rejects missing email with 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects missing password with 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects empty body with 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({});
    expect(res.status).toBe(400);
  });
});

// --- Token validation ---

describe('Token validation', () => {
  it('rejects expired token with 401', async () => {
    const expiredToken = jwt.sign(
      { userId: 'user123' },
      'test-secret',
      { expiresIn: '0s' }
    );
    // Small delay to ensure token is expired
    await new Promise((resolve) => setTimeout(resolve, 10));
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects malformed token with 401', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', 'Bearer not.a.valid.jwt.token');
    expect(res.status).toBe(401);
  });

  it('rejects empty Bearer value with 401', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('rejects non-Bearer scheme with 401', async () => {
    const token = jwt.sign({ userId: 'user123' }, 'test-secret');
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Basic ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects token signed with wrong secret with 401', async () => {
    const token = jwt.sign({ userId: 'user123' }, 'wrong-secret');
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
