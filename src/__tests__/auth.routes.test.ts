import request from 'supertest';
import app from '../app';
import { connectTestDB, closeTestDB, clearTestDB } from './setup';

process.env.JWT_SECRET = 'test-secret';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await closeTestDB(); });
afterEach(async () => { await clearTestDB(); });

describe('POST /auth/register', () => {
  it('creates a user and returns a token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'user@test.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });

  it('returns 409 for duplicate email', async () => {
    await request(app).post('/auth/register').send({ email: 'dup@test.com', password: 'password123' });
    const res = await request(app).post('/auth/register').send({ email: 'dup@test.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'notanemail', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for short password', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'user@test.com', password: '123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/auth/register').send({ email: 'login@test.com', password: 'password123' });
  });

  it('returns a token for valid credentials', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'login@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'login@test.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});
