process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_import';
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
});

const validCsv = `date,description,amount,category,type
2024-01-15,Coffee,5.50,Food,expense
2024-01-16,Salary,3000,Income,income`;

const csvWithInvalidRows = `date,description,amount,category,type
2024-01-15,Coffee,5.50,Food,expense
,Missing Date,50,Food,expense
2024-01-17,Bad Amount,N/A,Food,expense`;

describe('POST /api/import/expenses', () => {
  it('imports valid CSV file', async () => {
    const res = await request(app)
      .post('/api/import/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from(validCsv), { filename: 'test.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(0);
    expect(res.body.errors).toHaveLength(0);
  });

  it('skips duplicates', async () => {
    await request(app)
      .post('/api/import/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from(validCsv), { filename: 'test.csv', contentType: 'text/csv' });

    const res = await request(app)
      .post('/api/import/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from(validCsv), { filename: 'test.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(2);
  });

  it('returns error list for invalid rows', async () => {
    const res = await request(app)
      .post('/api/import/expenses')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from(csvWithInvalidRows), { filename: 'test.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('returns 400 when no file uploaded', async () => {
    const res = await request(app)
      .post('/api/import/expenses')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
  });
});
