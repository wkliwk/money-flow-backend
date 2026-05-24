process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import AccountModel from '../src/models/Account';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_accounts';
const OTHER_USER_ID = 'user_other_accounts';
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');
const otherToken = jwt.sign({ userId: OTHER_USER_ID }, 'test-secret');

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

describe('GET /api/accounts', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });

  it('returns empty array initially', async () => {
    const res = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [] });
  });

  it('returns only the user own accounts, newest first', async () => {
    await AccountModel.create({ userId: OTHER_USER_ID, name: 'Other', type: 'checking', startingBalance: 100 });
    await AccountModel.create({ userId: TEST_USER_ID, name: 'Old', type: 'savings', startingBalance: 50 });
    // Force createdAt ordering
    await new Promise((r) => setTimeout(r, 10));
    await AccountModel.create({ userId: TEST_USER_ID, name: 'New', type: 'cash', startingBalance: 25 });

    const res = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(2);
    expect(res.body.accounts[0].name).toBe('New');
    expect(res.body.accounts[1].name).toBe('Old');
  });

  it('returns 500 with message when fetch throws', async () => {
    jest.spyOn(AccountModel, 'find').mockImplementationOnce(() => {
      throw new Error('db down');
    });
    const res = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/accounts', () => {
  it('creates an account with defaults', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Wallet', type: 'cash' });

    expect(res.status).toBe(201);
    expect(res.body.account.name).toBe('Wallet');
    expect(res.body.account.type).toBe('cash');
    expect(res.body.account.startingBalance).toBe(0);
    expect(res.body.account.userId).toBe(TEST_USER_ID);
  });

  it('accepts a custom startingBalance', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Chase', type: 'checking', startingBalance: 1234.56 });

    expect(res.status).toBe(201);
    expect(res.body.account.startingBalance).toBe(1234.56);
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'cash' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rejects invalid type', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'X', type: 'crypto' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be one of/);
  });

  it('rejects non-numeric startingBalance', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'X', type: 'cash', startingBalance: 'lots' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startingBalance/);
  });

  it('returns 500 when create throws', async () => {
    jest.spyOn(AccountModel, 'create').mockRejectedValueOnce(new Error('db fail'));
    const res = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'X', type: 'cash' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('PUT /api/accounts/:id', () => {
  it('updates an existing account', async () => {
    const created = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'Old',
      type: 'cash',
      startingBalance: 0,
    });
    const res = await request(app)
      .put(`/api/accounts/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'New name', startingBalance: 999 });
    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('New name');
    expect(res.body.account.startingBalance).toBe(999);
  });

  it('returns 404 when account does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/accounts/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('does not allow updating someone else account', async () => {
    const created = await AccountModel.create({
      userId: OTHER_USER_ID,
      name: 'Mine',
      type: 'cash',
      startingBalance: 0,
    });
    const res = await request(app)
      .put(`/api/accounts/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('rejects invalid type on update', async () => {
    const created = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });
    const res = await request(app)
      .put(`/api/accounts/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'not-a-type' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when update throws', async () => {
    const created = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });
    jest.spyOn(AccountModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .put(`/api/accounts/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/accounts/:id', () => {
  it('deletes the account and reports unlinkedTransactions (always 0 — see open bug)', async () => {
    // Route counts Expense.accountId matches but the Expense schema does not
    // define accountId, so Mongoose strips it on write and the count is always 0.
    // Documented behavior here; bug tracked separately.
    const acc = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });

    const res = await request(app)
      .delete(`/api/accounts/${acc._id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, unlinkedTransactions: 0 });
    const found = await AccountModel.findById(acc._id);
    expect(found).toBeNull();
  });

  it('returns 404 when account does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/accounts/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when account belongs to another user', async () => {
    const acc = await AccountModel.create({
      userId: OTHER_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });
    const res = await request(app)
      .delete(`/api/accounts/${acc._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when delete throws', async () => {
    const acc = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });
    jest.spyOn(ExpenseModel, 'countDocuments').mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .delete(`/api/accounts/${acc._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(500);
  });

  it('reports 0 unlinked when no transactions link to the account', async () => {
    const acc = await AccountModel.create({
      userId: TEST_USER_ID,
      name: 'A',
      type: 'cash',
      startingBalance: 0,
    });
    const res = await request(app)
      .delete(`/api/accounts/${acc._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.unlinkedTransactions).toBe(0);
  });
});

  // unused export to keep otherToken referenced for future cross-user tests
  void otherToken;
